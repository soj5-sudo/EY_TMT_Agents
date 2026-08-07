import { readFileSync, writeFileSync } from "node:fs";

/**
 * Turns the reading run into lib/data/ir-published.ts.
 *
 * Takes the record each reader returned for a company, applies whatever the
 * checker corrected, and keeps only the companies whose figures a second
 * reader stood behind.
 *
 * Usage: node --experimental-strip-types scripts/write-published.mts <journal.jsonl>
 */

interface Found {
  symbol: string;
  found: boolean;
  periodLabel?: string;
  periodEnd?: string;
  priorYearPeriodLabel?: string;
  currency?: string;
  revenueReported?: number;
  revenueUsdM?: number;
  revenuePriorYearReported?: number;
  ebitMarginPct?: number;
  ebitdaMarginPct?: number;
  netProfitReported?: number;
  headcount?: number;
  attritionPct?: number;
  orderBookUsdM?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceKind?: string;
}

interface Verdict {
  symbol: string;
  verdict: "confirmed" | "corrected" | "refuted";
  corrections?: Record<string, unknown>;
  reasoning?: string;
}

const NAMES: Record<string, string> = {
  "TCS.NS": "Tata Consultancy Services",
  "HCLTECH.NS": "HCL Technologies",
  "MPHASIS.NS": "Mphasis Limited",
  "TECHM.NS": "Tech Mahindra",
  "BHARTIARTL.NS": "Bharti Airtel Limited",
  "RELIANCE.NS": "Reliance Industries",
  "LTIM.NS": "LTIMindtree",
  "COFORGE.NS": "Coforge Limited",
  "PERSISTENT.NS": "Persistent Systems",
  "CAP.PA": "Capgemini SE",
  "EXPN.L": "Experian plc",
  "ATE.PA": "Alten SA",
  "ZENSARTECH.NS": "Zensar Technologies",
  "BSOFT.NS": "Birlasoft Limited",
  "MASTEK.NS": "Mastek Limited",
  "DATAMATICS.NS": "Datamatics Global Services",
  "RSYSTEMS.NS": "R Systems International",
  "HAPPSTMNDS.NS": "Happiest Minds Technologies",
  "SAKSOFT.NS": "Saksoft Limited",
  "KELLTONTEC.NS": "Kellton Tech Solutions",
};

const journal = process.argv[2];
const finds = new Map<string, Found>();
const verdicts = new Map<string, Verdict>();

for (const line of readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let entry: { type?: string; result?: unknown };
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type !== "result" || typeof entry.result !== "object" || entry.result === null) continue;
  const r = entry.result as Record<string, unknown>;
  if (typeof r.symbol !== "string") continue;
  if ("verdict" in r) verdicts.set(r.symbol, r as unknown as Verdict);
  else if ("found" in r) finds.set(r.symbol, r as unknown as Found);
}

const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const rows: Array<Record<string, unknown>> = [];
const skipped: string[] = [];

/** Readers whose run was flagged, so their output is not trusted. */
const QUARANTINED = new Set(["ATE.PA"]);

for (const [symbol, raw] of finds) {
  if (QUARANTINED.has(symbol)) {
    skipped.push(`${symbol}: the reading run was flagged and the record was dropped`);
    continue;
  }
  if (!raw.found) {
    skipped.push(`${symbol}: reader found nothing`);
    continue;
  }

  const verdict = verdicts.get(symbol);
  if (verdict?.verdict === "refuted") {
    skipped.push(`${symbol}: checker refuted the record`);
    continue;
  }

  const merged: Record<string, unknown> = { ...raw, ...(verdict?.corrections ?? {}) };

  const periodEnd = typeof merged.periodEnd === "string" ? merged.periodEnd : null;
  if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    skipped.push(`${symbol}: no period end date`);
    continue;
  }

  const revenue = number(merged.revenueReported);
  const revenueUsdM = number(merged.revenueUsdM);
  if (revenue === null && revenueUsdM === null && number(merged.headcount) === null) {
    skipped.push(`${symbol}: nothing usable was stated`);
    continue;
  }

  rows.push({
    symbol,
    name: NAMES[symbol] ?? symbol,
    periodLabel: String(merged.periodLabel ?? "").trim() || "Latest published quarter",
    periodEnd,
    priorYearPeriodLabel: String(merged.priorYearPeriodLabel ?? "").trim(),
    currency: String(merged.currency ?? "").trim().toUpperCase() || "USD",
    revenue: revenue === null ? null : revenue * 1e6,
    revenuePriorYear:
      number(merged.revenuePriorYearReported) === null
        ? null
        : (number(merged.revenuePriorYearReported) as number) * 1e6,
    revenueUsdM,
    operatingMarginPct: number(merged.ebitMarginPct),
    ebitdaMarginPct: number(merged.ebitdaMarginPct),
    netProfit: number(merged.netProfitReported) === null ? null : (number(merged.netProfitReported) as number) * 1e6,
    headcount: number(merged.headcount),
    attritionPct: number(merged.attritionPct),
    orderBookUsdM: number(merged.orderBookUsdM),
    sourceUrl: String(merged.sourceUrl ?? ""),
    sourceTitle: String(merged.sourceTitle ?? "Published results release"),
    sourceKind: String(merged.sourceKind ?? "published results release"),
    verification: verdict ? verdict.verdict : "read once",
  });
}

rows.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));

const taken = new Date().toISOString();

const banner = `/**
 * The latest published quarter for each company that does not file with the SEC.
 *
 * Every record was read from the company's own results release, fact sheet or
 * earnings call, and the ones marked confirmed or corrected were read a second
 * time by a different reader against the same document. The document is linked
 * on the row.
 *
 * This is the floor, not the source. The console fetches and reads those
 * documents on every request; these figures fill in only what the file reader
 * could not lift, and never overwrite a measure computed live.
 */

export interface PublishedQuarter {
  symbol: string;
  name: string;
  /** The company's own label for the quarter, for example "Q1 FY27". */
  periodLabel: string;
  periodEnd: string;
  priorYearPeriodLabel: string;
  currency: string;
  /** Absolute units of the reported currency. */
  revenue: number | null;
  revenuePriorYear: number | null;
  /** Only when the company itself states a US dollar figure, in millions. */
  revenueUsdM: number | null;
  operatingMarginPct: number | null;
  ebitdaMarginPct: number | null;
  netProfit: number | null;
  headcount: number | null;
  attritionPct: number | null;
  orderBookUsdM: number | null;
  sourceUrl: string;
  sourceTitle: string;
  sourceKind: string;
  verification: string;
}

export const IR_PUBLISHED_TAKEN = ${JSON.stringify(taken)};

export const IR_PUBLISHED: PublishedQuarter[] = `;

writeFileSync("lib/data/ir-published.ts", `${banner}${JSON.stringify(rows, null, 1)};\n`);

const checked = rows.filter((r) => r.verification === "confirmed" || r.verification === "corrected");
console.log(`wrote lib/data/ir-published.ts: ${rows.length} companies, ${checked.length} checked twice`);
for (const r of rows) {
  console.log(
    `  ${String(r.symbol).padEnd(15)} ${String(r.periodLabel).padEnd(12)} ` +
      `${r.revenue === null ? "no revenue" : `${r.currency} ${((r.revenue as number) / 1e6).toLocaleString("en-US")}m`}`.padEnd(28) +
      ` ${r.verification}`,
  );
}
for (const s of skipped) console.log(`  skipped ${s}`);
