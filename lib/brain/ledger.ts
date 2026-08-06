/**
 * One measure, from whichever record the company actually publishes.
 *
 * A registrant tags concepts with the regulator. A company outside the register
 * publishes the same substance as labelled rows in its own results file. Both
 * are reduced to the same ledger upstream, so every measure in the console can
 * be computed the same way for both, and a question about TCS gets the same
 * treatment as a question about Accenture rather than a shorter answer.
 *
 * The alternative, which this replaces, was a small hardcoded set of measures
 * for companies outside the register. It meant a question the console could
 * answer for one company was declined for another purely because of where the
 * company happens to be listed, which is not a real distinction to a reader.
 */

import { getFactLedger, type FactKey, type FactLedger } from "@/lib/research/facts";
import { scrapeIr } from "@/lib/research/ir-scrape";
import { buildLedgerFromIr } from "@/lib/research/ir-facts";
import { getFxTable } from "@/lib/feeds/fx";
import { snapshotLedger } from "@/lib/research/ir-snapshot-ledger";
import { resolveCik } from "@/lib/feeds/sec";
import type { Company } from "@/lib/data/universe";
import type { MetricKey } from "@/lib/brain/intent";
import type { Provenance } from "@/lib/core/types";

export interface CompanyLedger {
  ledger: FactLedger | null;
  provenance: Provenance | null;
  /** Present when no record could be assembled, phrased for the reader. */
  unavailable: string | null;
}

/** Assembles the ledger for a company from whichever source it publishes to. */
export async function ledgerFor(company: Company): Promise<CompanyLedger> {
  if (company.secFiler) {
    const sec = await resolveCik(company.symbol).catch(() => null);
    if (!sec) {
      return {
        ledger: null,
        provenance: null,
        unavailable: `${company.short} is not in the SEC register.`,
      };
    }
    const ledger = await getFactLedger(sec.cik);
    return { ledger, provenance: ledger.provenance, unavailable: null };
  }

  // Live first. Several publishers refuse a request originating from a hosting
  // provider while serving the identical URL to an ordinary connection, so the
  // deployed console reaches fewer of these documents than a laptop does. The
  // harvested copy is the fallback rather than the source, and it is dated.
  const scraped = await scrapeIr(company.symbol, 3).catch(() => null);

  if (scraped && scraped.metrics.length > 0) {
    const fx = await getFxTable().catch(() => null);
    const bridged = buildLedgerFromIr(scraped, fx, company.currency);
    if (bridged) {
      return {
        ledger: bridged.ledger,
        provenance: bridged.ledger.provenance,
        unavailable: null,
      };
    }
  }

  const harvested = snapshotLedger(company.symbol);
  if (harvested) {
    return { ledger: harvested, provenance: harvested.provenance, unavailable: null };
  }

  return {
    ledger: null,
    provenance: scraped?.provenance ?? null,
    unavailable: scraped
      ? `${company.short} publishes results files, but none of the rows could be mapped onto a standard measure.`
      : `No published results file could be read for ${company.short}.`,
  };
}

/* ------------------------------------------------------------------ *
 * Measures
 * ------------------------------------------------------------------ */

interface Basis {
  /** Values keyed by period end, on whichever basis has the longer run. */
  points: Array<{ label: string; end: string }>;
  read: (key: FactKey, end: string) => number | null;
  /**
   * Reporting periods in a year: one for an annual basis, four for a quarterly
   * one. Any measure that divides a balance by a flow has to annualise the
   * flow, or a quarter of the revenue is compared against a full balance and
   * the answer comes out four times too large. Receivables of six billion
   * against a quarter of revenue reads as two hundred and ninety four days
   * outstanding, which is arithmetically correct and completely wrong.
   */
  periodsPerYear: number;
}

/**
 * Picks the periods to report on.
 *
 * Registrants file years. A company publishing its own results usually issues
 * quarters with at most one full year alongside, so insisting on an annual
 * basis would leave most of them with a single point and no trend at all.
 */
function basisOf(ledger: FactLedger): Basis | null {
  const revenue = ledger.series.revenue;
  if (!revenue) return null;

  const useAnnual = revenue.annual.length >= 2;
  const points = (useAnnual ? revenue.annual : revenue.quarterly).map((p) => ({
    label: p.label,
    end: p.end,
  }));
  if (points.length === 0) return null;

  const read = (key: FactKey, end: string): number | null => {
    const line = ledger.series[key];
    if (!line) return null;
    const from = useAnnual ? line.annual : line.quarterly;
    const hit = from.find((p) => p.end === end);
    if (hit) return hit.value;
    // Balance sheet concepts are reported at an instant that may not line up
    // with a duration end date, so the nearest earlier instant is used.
    // A balance is only a stand in for the period end when it is close to it.
    // Without the bound, an equity figure from two years earlier is divided
    // into current year profit and reports a return on equity of two hundred
    // and seventy nine percent, which reads as a finding rather than an error.
    const instants = [...line.annual, ...line.quarterly]
      .filter((p) => p.start === null && p.end <= end)
      .sort((a, b) => a.end.localeCompare(b.end));
    const nearest = instants.at(-1);
    if (!nearest) return null;
    const gap = (Date.parse(end) - Date.parse(nearest.end)) / 86_400_000;
    return gap <= 120 ? nearest.value : null;
  };

  return { points, read, periodsPerYear: useAnnual ? 1 : 4 };
}

/**
 * Reporting periods in a year for this ledger: one where the company files
 * years, four where it publishes quarters. A caller comparing one company
 * against another has to know, because a quarter of revenue set beside a full
 * year of it is not a comparison, and the two look identical once the label is
 * dropped.
 */
export function ledgerPeriodsPerYear(ledger: FactLedger): number {
  return basisOf(ledger)?.periodsPerYear ?? 1;
}

/**
 * Puts a measure on an annual footing.
 *
 * A flow accumulates, so a quarter of it is multiplied up. A growth rate
 * compounds, so it is raised rather than multiplied. A ratio, a day count and
 * a headcount are already basis neutral and are returned untouched.
 */
export function annualise(
  key: MetricKey,
  value: number,
  periodsPerYear: number,
): number {
  if (periodsPerYear === 1) return value;
  if (key === "revenue") return value * periodsPerYear;
  if (key === "revenueGrowth") return (Math.pow(1 + value / 100, periodsPerYear) - 1) * 100;
  return value;
}

/**
 * Computes one measure across every reported period.
 *
 * Returns the series rather than a single value, because the level and the
 * trend are then guaranteed to agree: the headline figure is the last point of
 * the same series the chart is drawn from.
 */
export function seriesFor(
  ledger: FactLedger,
  key: MetricKey,
): Array<{ label: string; value: number }> {
  const basis = basisOf(ledger);
  if (!basis) return [];

  const out: Array<{ label: string; value: number }> = [];

  for (let i = 0; i < basis.points.length; i++) {
    const { label, end } = basis.points[i];
    const revenue = basis.read("revenue", end);
    if (revenue === null) continue;

    // Growth is only meaningful between adjacent periods. A published archive
    // can leave a seven year hole in a series, and treating the two ends of it
    // as consecutive reports a one year growth rate of a hundred and fifty
    // percent that is really seven years of compounding.
    const priorPoint = i > 0 ? basis.points[i - 1] : null;
    const expected = 365 / basis.periodsPerYear;
    const gapDays = priorPoint
      ? (Date.parse(end) - Date.parse(priorPoint.end)) / 86_400_000
      : null;
    const adjacent = gapDays !== null && gapDays > expected * 0.6 && gapDays < expected * 1.7;
    const priorRevenue = adjacent ? basis.read("revenue", priorPoint!.end) : null;

    // A denominator near zero divides correctly and means nothing.
    const usable = (d: number | null) =>
      d !== null && Number.isFinite(d) && d !== 0 && Math.abs(d) >= Math.abs(revenue) * 0.02;

    const over = (n: number | null, d: number | null, scale: number) =>
      n !== null && usable(d) ? (n / d!) * scale : null;

    let v: number | null = null;

    switch (key) {
      case "revenue":
        v = revenue;
        break;
      case "revenueGrowth":
        v =
          priorRevenue !== null && priorRevenue > 0
            ? ((revenue - priorRevenue) / priorRevenue) * 100
            : null;
        break;
      case "grossMargin": {
        const cost = basis.read("costOfRevenue", end);
        const gross = basis.read("grossProfit", end) ?? (cost !== null ? revenue - cost : null);
        v = over(gross, revenue, 100);
        break;
      }
      case "operatingMargin":
        v = over(basis.read("operatingIncome", end), revenue, 100);
        break;
      case "netMargin":
        v = over(basis.read("netIncome", end), revenue, 100);
        break;
      case "rndIntensity":
        v = over(basis.read("rnd", end), revenue, 100);
        break;
      case "shareBasedComp":
        v = over(basis.read("shareComp", end), revenue, 100);
        break;
      case "cashConversion":
        v = over(basis.read("cashFromOps", end), basis.read("netIncome", end), 100);
        break;
      case "freeCashMargin": {
        const ocf = basis.read("cashFromOps", end);
        const capex = basis.read("capex", end);
        v = ocf === null ? null : over(ocf - Math.abs(capex ?? 0), revenue, 100);
        break;
      }
      case "receivableDays":
        v = over(basis.read("receivables", end), revenue * basis.periodsPerYear, 365);
        break;
      case "returnOnEquity": {
        const ni = basis.read("netIncome", end);
        v = over(ni === null ? null : ni * basis.periodsPerYear, basis.read("equity", end), 100);
        break;
      }
      case "headcount": {
        const n = basis.read("employees", end);
        v = n !== null && n >= 1 ? n : null;
        break;
      }
      case "attrition":
        // Not a tagged concept anywhere. Published by some companies as a row
        // in their own results file, and read from there by the caller.
        v = null;
        break;
    }

    if (v !== null && Number.isFinite(v)) out.push({ label, value: v });
  }

  return out;
}
