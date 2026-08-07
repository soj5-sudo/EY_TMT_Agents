import { IR_PUBLISHED, IR_PUBLISHED_TAKEN, type PublishedQuarter } from "@/lib/data/ir-published";
import type { FactKey, FactLedger, FactSeries, FactValue } from "@/lib/research/facts";
import type { FxTable } from "@/lib/feeds/fx";

/**
 * The latest published quarter, in US dollars.
 *
 * Each record was read from the company's own results release or transcript
 * and checked against that document a second time before it was written here.
 * It fills the measures a file reader could not lift, and holds the quarter it
 * names; every other period keeps whatever the reader found.
 */

export function publishedFor(symbol: string): PublishedQuarter | null {
  return IR_PUBLISHED.find((p) => p.symbol === symbol) ?? null;
}

interface Built {
  key: FactKey;
  label: string;
  tag: string;
  value: number;
}

function conversion(entry: PublishedQuarter, fx: FxTable | null): { rate: number; note: string } | null {
  if (entry.currency === "USD") return { rate: 1, note: "stated by the company in US dollars" };
  const rate = fx?.rateFor(entry.currency) ?? null;
  if (rate === null || rate === 0) return null;
  return {
    rate,
    note: `converted from ${entry.currency} at ${rate.toFixed(2)} per US dollar as fixed ${fx?.asOf ?? "on the reading date"}`,
  };
}

function measures(entry: PublishedQuarter, rate: number): Built[] {
  const out: Built[] = [];
  const usd = (v: number) => v / rate;

  const revenue =
    entry.revenueUsdM !== null ? entry.revenueUsdM * 1e6 : entry.revenue !== null ? usd(entry.revenue) : null;

  if (revenue !== null) {
    out.push({
      key: "revenue",
      label: "Revenue",
      tag: `Revenue, ${entry.sourceKind}`,
      value: revenue,
    });

    if (entry.operatingMarginPct !== null) {
      out.push({
        key: "operatingIncome",
        label: "Operating income",
        tag: `Operating margin of ${entry.operatingMarginPct.toFixed(1)} percent as published, on published revenue`,
        value: revenue * (entry.operatingMarginPct / 100),
      });
    }
  }

  if (entry.netProfit !== null) {
    out.push({
      key: "netIncome",
      label: "Net income",
      tag: `Profit after tax, ${entry.sourceKind}`,
      value: usd(entry.netProfit),
    });
  }

  if (entry.headcount !== null) {
    out.push({
      key: "employees",
      label: "Employees",
      tag: `Closing headcount, ${entry.sourceKind}`,
      value: entry.headcount,
    });
  }

  if (entry.orderBookUsdM !== null) {
    out.push({
      key: "orderBook",
      label: "Order book",
      tag: `Deal wins for the quarter, ${entry.sourceKind}`,
      value: entry.orderBookUsdM * 1e6,
    });
  }

  return out;
}

function priorPoint(entry: PublishedQuarter, rate: number): FactValue | null {
  if (entry.revenuePriorYear === null) return null;
  const end = `${Number(entry.periodEnd.slice(0, 4)) - 1}${entry.periodEnd.slice(4)}`;
  return {
    start: null,
    end,
    value: entry.revenuePriorYear / rate,
    form: entry.sourceKind,
    filed: IR_PUBLISHED_TAKEN.slice(0, 10),
    label: entry.priorYearPeriodLabel || "Same quarter, prior year",
  };
}

/** Adds the published quarter to a ledger, keeping the reader's other periods. */
export function withPublished(
  ledger: FactLedger | null,
  symbol: string,
  name: string,
  fx: FxTable | null,
): FactLedger | null {
  const entry = publishedFor(symbol);
  if (!entry) return ledger;

  const conv = conversion(entry, fx);
  if (!conv) return ledger;

  const built = measures(entry, conv.rate);
  if (built.length === 0) return ledger;

  const filed = IR_PUBLISHED_TAKEN.slice(0, 10);
  const series: Partial<Record<FactKey, FactSeries>> = { ...(ledger?.series ?? {}) };
  const added: FactKey[] = [];

  for (const m of built) {
    const held = series[m.key];

    const point: FactValue = {
      start: null,
      end: entry.periodEnd,
      value: m.value,
      form: entry.sourceKind,
      filed,
      label: entry.periodLabel,
    };

    // The checked figure is the one for its own quarter. Anything the file
    // reader lifted for other periods is kept around it.
    const prior = m.key === "revenue" ? priorPoint(entry, conv.rate) : null;
    const quarterly = [
      ...(held?.quarterly ?? []).filter((p) => p.end !== point.end && p.end !== prior?.end),
      ...(prior ? [prior] : []),
      point,
    ].sort((a, b) => a.end.localeCompare(b.end));

    const annual = (held?.annual ?? []).filter((p) => p.end !== point.end);
    const newest = [...annual, ...quarterly].sort((a, b) => a.end.localeCompare(b.end)).at(-1);

    series[m.key] = {
      key: m.key,
      label: m.label,
      tag: m.tag,
      unit: m.key === "employees" ? "count" : "USD",
      annual,
      quarterly,
      latest: newest?.value ?? point.value,
      prior: held?.latest ?? null,
      instant: newest?.value ?? point.value,
    };
    added.push(m.key);
  }

  if (added.length === 0) return ledger;

  const note =
    `${added.length} measures for ${entry.periodLabel} read from ${entry.sourceTitle}, ${conv.note}. ` +
    `Each figure was checked against that document a second time before it was recorded.`;

  if (!ledger) {
    return {
      cik: "",
      entityName: name,
      conceptsTagged: added.length,
      conceptsResolved: added.length,
      conceptsRequested: added.length,
      taxonomies: ["published results release"],
      series,
      fiscalYearEnd: null,
      provenance: {
        kind: "filing",
        source: `${name} published results, ${entry.periodLabel}`,
        url: entry.sourceUrl,
        retrievedAt: IR_PUBLISHED_TAKEN,
        sourceDatedAt: entry.periodEnd,
        note,
      },
    };
  }

  return {
    ...ledger,
    conceptsResolved: ledger.conceptsResolved + added.length,
    series,
    provenance: {
      ...ledger.provenance,
      note: `${ledger.provenance.note} ${note}`,
    },
  };
}
