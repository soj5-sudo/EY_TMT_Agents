/**
 * Published metrics as a fact ledger.
 *
 * A company outside the SEC register publishes the same substance a registrant
 * files, but as labelled rows in its own workbook rather than as tagged
 * concepts. Every agent in a run reads the ledger, so without a bridge the
 * whole non-registrant cohort arrives at the financial workstreams with
 * nothing, and two thirds of the review reports that it is waiting for
 * documents that are in fact already downloaded.
 *
 * This maps the published rows onto the same concept keys, orders the periods
 * properly, and converts to US dollars at a live rate where the sheet states a
 * currency. Where the sheet does not state its units, the figure is left out
 * rather than assumed: a revenue line silently read in rupees as though it were
 * dollars is off by two orders of magnitude and looks entirely reasonable.
 */

import type { FactKey, FactLedger, FactSeries, FactValue } from "@/lib/research/facts";
import type { IrMetric, IrScrapeResult } from "@/lib/research/ir-scrape";
import type { FxTable } from "@/lib/feeds/fx";
import { nowIso } from "@/lib/core/types";

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface ParsedPeriod {
  /** Calendar year the period ends in. */
  year: number;
  /** 1 to 4 for a quarter, null for a full year. */
  quarter: number | null;
  /** Sortable key, ascending in time. */
  key: number;
  label: string;
}

function fullYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  // A two digit fiscal year in this dataset is always the current century.
  return 2000 + n;
}

/**
 * Reads the period a published column header names.
 *
 * Headers arrive in several shapes across publishers: "1Q26", "Q1 FY27",
 * "FY26", "Mar-26". They have to be comparable to each other because the
 * latest period is what every agent reads, and picking the wrong one silently
 * reports a figure from two years ago as current.
 */
export function parsePeriod(label: string): ParsedPeriod | null {
  const s = label.trim();

  let m = s.match(/^([1-4])Q\s?(?:FY)?\s?(\d{2,4})$/i);
  if (m) {
    const year = fullYear(m[2]);
    return { year, quarter: Number(m[1]), key: year * 10 + Number(m[1]), label: s };
  }

  m = s.match(/^Q([1-4])\s?(?:FY)?\s?(\d{2,4})$/i);
  if (m) {
    const year = fullYear(m[2]);
    return { year, quarter: Number(m[1]), key: year * 10 + Number(m[1]), label: s };
  }

  m = s.match(/^FY\s?(\d{2,4})$/i);
  if (m) {
    const year = fullYear(m[1]);
    // A full year sorts after every quarter of that year.
    return { year, quarter: null, key: year * 10 + 5, label: s };
  }

  m = s.match(/^([A-Za-z]{3})[-' ](\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) {
      const year = fullYear(m[2]);
      const q = Math.ceil(month / 3);
      return { year, quarter: q, key: year * 10 + q, label: s };
    }
  }

  m = s.match(/^(19|20)(\d{2})$/);
  if (m) {
    const year = Number(s);
    return { year, quarter: null, key: year * 10 + 5, label: s };
  }

  return null;
}

/** Approximate period end, needed because the ledger keys on end dates. */
function periodEnd(p: ParsedPeriod): string {
  const month = p.quarter === null ? 12 : p.quarter * 3;
  const day = [4, 6, 9, 11].includes(month) ? 30 : month === 2 ? 28 : 31;
  return `${p.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Label mapping
 * ------------------------------------------------------------------ */

/**
 * Published row labels that carry each concept, most specific first.
 *
 * Matching is deliberately tight. A loose pattern for revenue picks up
 * "Deferred revenue" and "Revenue per employee" and puts a balance or a ratio
 * where an income figure belongs, and nothing downstream can detect that.
 */
const LABEL_MAP: Array<[FactKey, RegExp[]]> = [
  ["revenue", [
    /^revenue$/i,
    /^total revenues?$/i,
    /^gross revenues?$/i,
    /^revenue from operations$/i,
    /^net revenues?$/i,
    /^total income from operations$/i,
    /^reported revenues?$/i,
    /^consolidated revenues?$/i,
  ]],
  ["operatingIncome", [
    /^operating (income|profit)$/i,
    /^ebit$/i,
    /^profit from operations$/i,
    /^operating profit \(ebit\)$/i,
  ]],
  ["netIncome", [
    /^net (profit|income)$/i,
    /^net profit after tax(es)?$/i,
    /^profit for the (period|year)$/i,
    /^pat$/i,
    /^net income attributable/i,
  ]],
  ["grossProfit", [/^gross profit$/i]],
  ["costOfRevenue", [/^cost of (revenue|sales|services)$/i, /^total cost of (revenue|sales|services)$/i]],
  ["depreciation", [/^depreciation( (and|&) amorti[sz]ation)?$/i, /^d ?& ?a$/i]],
  ["taxExpense", [/^(income )?tax expense$/i, /^income tax$/i, /^provision for tax(ation)?$/i, /^total tax$/i]],
  ["pretaxIncome", [/^profit before tax(es)?$/i, /^pbt$/i, /^income before (income )?tax(es)?$/i]],
  ["employees", [/^total headcount$/i, /^headcount$/i, /^total employees$/i, /^closing headcount$/i]],
  ["cash", [/^cash (and|&) (cash )?equivalents$/i, /^cash$/i, /^cash and bank balances$/i]],
  ["receivables", [/^(trade |accounts )?receivables$/i, /^trade receivables$/i, /^debtors$/i]],
  ["unbilled", [/^unbilled (revenue|receivables)/i, /^contract assets$/i]],
  ["payables", [/^(trade |accounts )?payables$/i, /^creditors$/i]],
  ["inventory", [/^inventor(y|ies)$/i, /^stock in trade$/i]],
  ["deferredRevenue", [/^(unearned|deferred) revenue$/i, /^contract liabilit(y|ies)$/i]],
  ["assets", [/^total assets$/i]],
  ["currentAssets", [/^(total )?current assets$/i]],
  ["currentLiabilities", [/^(total )?current liabilities$/i]],
  ["equity", [/^(total )?(shareholders.? )?(equity|funds)$/i, /^net worth$/i]],
  ["debt", [/^(total |long ?term )?(borrowings|debt)$/i]],
  ["goodwill", [/^goodwill$/i]],
  ["intangibles", [/^(other )?intangible assets$/i]],
  ["ppe", [/^(net )?(property,? plant and equipment|fixed assets)$/i]],
  ["cashFromOps", [
    /^(net )?cash (flow )?(generated |provided |used )?(from|by|in) operat(ing|ions)/i,
    /^operating cash flow$/i,
    /^cfo$/i,
  ]],
  ["capex", [/^(purchase of )?(property,? plant and equipment|fixed assets)$/i, /^capital expenditure$/i, /^capex$/i]],
  ["orderBook", [/^(order book|total contract value|tcv)$/i, /^order (intake|bookings?)$/i]],
  ["rnd", [/^research (and|&) development$/i, /^r ?& ?d( expense)?$/i]],
  ["shareComp", [/^(share|stock)[- ]based compensation$/i, /^esop cost$/i]],
  ["dividends", [/^dividends? paid$/i]],
  ["epsDiluted", [/^diluted (eps|earnings per share)$/i, /^eps \(diluted\)$/i]],
];

const CONCEPT_LABEL: Partial<Record<FactKey, string>> = {
  revenue: "Revenue",
  operatingIncome: "Operating income",
  netIncome: "Net income",
  grossProfit: "Gross profit",
  costOfRevenue: "Cost of revenue",
  depreciation: "Depreciation and amortisation",
  taxExpense: "Income tax expense",
  pretaxIncome: "Pre-tax income",
  cash: "Cash and equivalents",
  receivables: "Trade receivables",
  unbilled: "Unbilled receivables",
  payables: "Trade payables",
  inventory: "Inventory",
  deferredRevenue: "Deferred revenue",
  assets: "Total assets",
  currentAssets: "Current assets",
  currentLiabilities: "Current liabilities",
  equity: "Shareholders equity",
  debt: "Long term debt",
  goodwill: "Goodwill",
  intangibles: "Intangible assets",
  ppe: "Property and equipment",
  cashFromOps: "Cash from operations",
  capex: "Capital expenditure",
  orderBook: "Order book",
  rnd: "Research and development",
  shareComp: "Share-based compensation",
  dividends: "Dividends paid",
  epsDiluted: "Diluted earnings per share",
  employees: "Employees",
};

/**
 * Concepts that are a position at a moment rather than an amount accumulated
 * over a period. Balance sheet lines and headcount; everything else is a flow.
 */
const STOCK_KEYS = new Set<FactKey>([
  "cash", "receivables", "unbilled", "payables", "inventory", "deferredRevenue",
  "assets", "currentAssets", "currentLiabilities", "equity", "debt", "debtCurrent",
  "goodwill", "intangibles", "ppe", "leaseLiability", "minorityInterest",
  "orderBook", "employees", "unrecognisedTax", "lossContingency", "purchaseCommitments",
]);

/**
 * Rows whose values are already ratios and must not be scaled or converted.
 *
 * The word boundaries matter more than they look. Without them "ratio" matches
 * inside "Operations", so every row named "Revenue from Operations" is
 * classified as a ratio and silently dropped, and the issuer appears to publish
 * no revenue at all.
 */
const RATIO_ROW = /\bmargin\b|%|\bpercent\b|\bratio\b|\bper share\b|\battrition\b|\butilis|\butiliz|\brate\b/i;

function matchKey(label: string): FactKey | null {
  const clean = label
    // Published statements number their lines: "1 Gross Revenue", "(a) Cash".
    .replace(/^\s*\(?[0-9ivx]{1,4}\)?[.)]?\s+/i, "")
    .replace(/\*+$/, "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim();
  for (const [key, patterns] of LABEL_MAP) {
    for (const re of patterns) {
      if (re.test(clean)) return key;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

export interface IrLedgerResult {
  ledger: FactLedger;
  /** Currency the source figures were stated in, before conversion. */
  sourceCurrency: string | null;
  /** Rate applied, and the fixing date it came from. */
  rate: number | null;
  rateDate: string | null;
  /** Concepts that were mapped, for reporting what the bridge actually did. */
  mapped: FactKey[];
  /** Rows carrying figures whose units the sheet never stated. */
  droppedForUnknownUnits: number;
}

/**
 * Builds a ledger from published rows.
 *
 * `declaredCurrency` is the fallback when a sheet omits its caption: it comes
 * from the coverage universe, which records what each company reports in. It is
 * used only when the sheet itself is silent, because the sheet is the better
 * authority and several publishers issue both a dollar and a local sheet in one
 * workbook.
 */
export function buildLedgerFromIr(
  scrape: IrScrapeResult,
  fx: FxTable | null,
  declaredCurrency: string | null,
): IrLedgerResult | null {
  const series: Partial<Record<FactKey, FactSeries>> = {};
  const mapped: FactKey[] = [];
  let dropped = 0;
  let sourceCurrency: string | null = null;
  let rate: number | null = null;

  // One metric per concept: the first row whose label matches, since the
  // scraper already ordered files best first.
  const claimed = new Set<FactKey>();

  // A ledger has to be internally consistent before it is large. Publishers
  // issue a dollar sheet beside a rupee one, and rows picked freely across
  // both put a rupee numerator over a dollar denominator: Persistent's margin
  // came out at nought point nought percent from an EBIT in rupees divided by
  // a revenue in dollars, and both figures were individually correct. So one
  // currency is chosen, the one carrying revenue, and money rows stated in any
  // other are left out. Counts are exempt because they are not money.
  const currencyVotes = new Map<string, { count: number; hasRevenue: boolean }>();
  for (const m of scrape.metrics) {
    const k = matchKey(m.label);
    if (!k || k === "employees" || RATIO_ROW.test(m.label)) continue;
    const cur = m.unit?.currency ?? declaredCurrency;
    if (!cur) continue;
    const held = currencyVotes.get(cur) ?? { count: 0, hasRevenue: false };
    held.count += 1;
    if (k === "revenue") held.hasRevenue = true;
    currencyVotes.set(cur, held);
  }

  const chosenCurrency =
    [...currencyVotes.entries()]
      .sort((a, b) => {
        // Only a currency that carries revenue can anchor the ledger, since
        // every ratio is taken against it.
        if (a[1].hasRevenue !== b[1].hasRevenue) return a[1].hasRevenue ? -1 : 1;
        // Among those, the publisher's own dollar sheet is preferred: it needs
        // no conversion, so nothing rests on a rate fixed on a later date.
        const aUsd = a[0] === "USD";
        const bUsd = b[0] === "USD";
        if (aUsd !== bUsd) return aUsd ? -1 : 1;
        return b[1].count - a[1].count;
      })
      .at(0)?.[0] ?? null;

  // Rows outside the chosen currency are removed before anything claims a
  // concept. Filtering afterwards lets a row take the revenue slot and then be
  // dropped, which leaves the ledger with no revenue at all and every ratio
  // built on it silently absent.
  const eligible = scrape.metrics.filter((m) => {
    const k = matchKey(m.label);
    if (k === "employees") return true;
    const cur = m.unit?.currency ?? declaredCurrency;
    return chosenCurrency === null || cur === chosenCurrency;
  });

  for (const metric of eligible) {
    const key = matchKey(metric.label);
    if (!key || claimed.has(key)) continue;
    if (RATIO_ROW.test(metric.label)) continue;

    const currency = metric.unit?.currency ?? declaredCurrency;
    const scale = metric.unit?.scale ?? 1;

    // Without a currency the figure cannot be placed on a dollar ledger at all.
    if (!currency && key !== "employees") {
      dropped++;
      continue;
    }

    // A stated scale is not optional for an absolute figure. Results releases
    // laid out as prose often carry no caption, and defaulting to units turns
    // a number published in crore into one that reads as rupees: HCLTech's
    // revenue arrived as a hundred million dollars against an actual thirteen
    // billion, and nothing downstream can detect an error of that shape.
    // Ratios are unaffected because the scale cancels, so they are left to the
    // agents that compute them from two rows on the same basis.
    if (metric.unit && !metric.unit.scaleStated && key !== "employees") {
      dropped++;
      continue;
    }
    if (!metric.unit && key !== "employees") {
      dropped++;
      continue;
    }

    // A caption in a spreadsheet governs the table under it. In a results
    // release laid out as prose there is no table structure, so a caption seen
    // earlier in the document may belong to something else entirely, and the
    // row is only trusted when its own label carries the units.
    if (metric.structured === false && !metric.unitFromLabel && key !== "employees") {
      dropped++;
      continue;
    }

    // Headcount is a count of people. Scaling it by the sheet's money units and
    // dividing it by an exchange rate turns thirteen thousand employees into
    // one point three billion, which is obviously wrong on sight and would not
    // be obvious at all inside a ratio.
    const isCount = key === "employees";

    let factor = isCount ? 1 : scale;
    if (currency !== "USD" && !isCount) {
      const r = currency ? (fx?.rateFor(currency) ?? null) : null;
      if (r === null || r === 0) {
        dropped++;
        continue;
      }
      factor = scale / r;
      rate = r;
    }
    if (sourceCurrency === null) sourceCurrency = currency;

    const points: Array<{ p: ParsedPeriod; v: number }> = [];
    for (const v of metric.values) {
      const parsed = parsePeriod(v.period);
      if (!parsed) continue;
      points.push({ p: parsed, v: v.value * factor });
    }
    if (points.length === 0) continue;

    points.sort((a, b) => a.p.key - b.p.key);

    const toValue = (x: (typeof points)[number]): FactValue => ({
      start: null,
      end: periodEnd(x.p),
      value: x.v,
      form: "Published results file",
      filed: scrape.provenance.retrievedAt.slice(0, 10),
      label: x.p.quarter === null ? `FY${x.p.year}` : `Q${x.p.quarter} FY${x.p.year}`,
    });

    const annualPts = points.filter((x) => x.p.quarter === null).map(toValue);
    const quarterlyPts = points.filter((x) => x.p.quarter !== null).map(toValue);

    // Where only quarters are published, the trailing four are combined into a
    // year so the annual reads every agent makes have something to stand on.
    // How they combine depends on what the concept is: a flow accumulates over
    // the year, a stock is a position at a moment and the year end value is
    // simply the last one. Summing a headcount across four quarters reports an
    // organisation four times its actual size, and the figure looks ordinary.
    let annual = annualPts;
    if (annual.length === 0 && quarterlyPts.length >= 4) {
      const grouped = new Map<number, FactValue[]>();
      for (const q of quarterlyPts) {
        const y = Number(q.label.slice(-4));
        grouped.set(y, [...(grouped.get(y) ?? []), q]);
      }
      const isStock = STOCK_KEYS.has(key);
      annual = [...grouped.entries()]
        .filter(([, qs]) => qs.length === 4)
        .map(([y, qs]) => {
          const ordered = [...qs].sort((a, b) => a.end.localeCompare(b.end));
          return {
            start: null,
            end: `${y}-12-31`,
            value: isStock
              ? ordered[ordered.length - 1].value
              : ordered.reduce((sum, x) => sum + x.value, 0),
            form: isStock
              ? "Published results file, position at the year end"
              : "Published results file, four quarters summed",
            filed: scrape.provenance.retrievedAt.slice(0, 10),
            label: `FY${y}`,
          };
        })
        .sort((a, b) => a.end.localeCompare(b.end));
    }

    if (annual.length === 0 && quarterlyPts.length === 0) continue;

    claimed.add(key);
    mapped.push(key);

    series[key] = {
      key,
      label: CONCEPT_LABEL[key] ?? key,
      tag: `${metric.label}, published results file`,
      unit: key === "employees" ? "count" : "USD",
      annual,
      quarterly: quarterlyPts.slice(-16),
      latest: annual.at(-1)?.value ?? quarterlyPts.at(-1)?.value ?? null,
      prior: annual.length >= 2 ? annual[annual.length - 2].value : null,
      instant: annual.at(-1)?.value ?? quarterlyPts.at(-1)?.value ?? null,
    };
  }

  if (mapped.length === 0) return null;

  const ledger: FactLedger = {
    cik: "",
    entityName: scrape.name,
    conceptsTagged: scrape.metrics.length,
    conceptsResolved: mapped.length,
    conceptsRequested: LABEL_MAP.length,
    taxonomies: ["published results file"],
    series,
    fiscalYearEnd: series.revenue?.annual.at(-1)?.end.slice(5) ?? null,
    provenance: {
      kind: "filing",
      source: `${scrape.name} published results files, mapped onto the standard concept set`,
      url: scrape.indexUrl,
      retrievedAt: nowIso(),
      note:
        `${mapped.length} concepts mapped from ${scrape.metrics.length} published rows` +
        (sourceCurrency && sourceCurrency !== "USD" && fx
          ? `, converted from ${sourceCurrency} at ${rate?.toFixed(4)} per US dollar as fixed ${fx.asOf}`
          : sourceCurrency === "USD"
            ? ", stated by the publisher in US dollars"
            : "") +
        (dropped > 0
          ? `. ${dropped} rows were left out because the file did not state their currency or scale, and an absolute figure cannot rest on an assumed one.`
          : "."),
    },
  };

  return {
    ledger,
    sourceCurrency,
    rate,
    rateDate: fx?.asOf ?? null,
    mapped,
    droppedForUnknownUnits: dropped,
  };
}
