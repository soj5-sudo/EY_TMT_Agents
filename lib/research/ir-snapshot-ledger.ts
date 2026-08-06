import { IR_LEDGER_SNAPSHOT, IR_LEDGER_TAKEN } from "@/lib/data/ir-ledger-snapshot";
import type { FactKey, FactLedger, FactSeries } from "@/lib/research/facts";

export function snapshotLedger(symbol: string): FactLedger | null {
  const entry = IR_LEDGER_SNAPSHOT.find((e) => e.symbol === symbol);
  if (!entry || Object.keys(entry.series).length === 0) return null;

  const series: Partial<Record<FactKey, FactSeries>> = {};
  const filed = IR_LEDGER_TAKEN.slice(0, 10);

  for (const [key, line] of Object.entries(entry.series)) {
    if (!line) continue;
    const toValue = (p: { end: string; label: string; value: number }) => ({
      start: null,
      end: p.end,
      value: p.value,
      form: "Published results file, harvested",
      filed,
      label: p.label,
    });

    const annual = line.annual.map(toValue);
    const quarterly = line.quarterly.map(toValue);

    series[key as FactKey] = {
      key,
      label: line.tag.split(",")[0],
      tag: line.tag,
      unit: line.unit,
      annual,
      quarterly,
      latest: annual.at(-1)?.value ?? quarterly.at(-1)?.value ?? null,
      prior: annual.length >= 2 ? annual[annual.length - 2].value : null,
      instant: annual.at(-1)?.value ?? quarterly.at(-1)?.value ?? null,
    };
  }

  const converted =
    entry.sourceCurrency && entry.sourceCurrency !== "USD" && entry.rate
      ? `, converted from ${entry.sourceCurrency} at ${entry.rate.toFixed(2)} per US dollar as fixed ${entry.rateDate ?? "on the harvest date"}`
      : entry.sourceCurrency === "USD"
        ? ", stated by the publisher in US dollars"
        : "";

  return {
    cik: "",
    entityName: entry.name,
    conceptsTagged: Object.keys(entry.series).length,
    conceptsResolved: Object.keys(series).length,
    conceptsRequested: Object.keys(series).length,
    taxonomies: ["published results file, harvested"],
    series,
    fiscalYearEnd: series.revenue?.annual.at(-1)?.end.slice(5) ?? null,
    provenance: {
      kind: "baseline",
      source: `${entry.name} published results files, harvested ${filed}`,
      url: entry.indexUrl,
      retrievedAt: IR_LEDGER_TAKEN,
      sourceDatedAt: filed,
      note:
        `Read from ${entry.filesRead.join(" and ")}${converted}. ` +
        `The publisher refused the live request from this deployment, so the harvested copy is served and dated. ` +
        `The documents themselves are public and are linked above.`,
    },
  };
}

export function hasSnapshot(symbol: string): boolean {
  return IR_LEDGER_SNAPSHOT.some(
    (e) => e.symbol === symbol && Object.keys(e.series).length > 0,
  );
}
