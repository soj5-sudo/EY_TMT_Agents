/**
 * Company financial model, built from SEC XBRL company facts.
 *
 * One request per company returns every tagged concept, so a full statement
 * costs a single call rather than fifteen.
 *
 * Three details decide whether the output is trustworthy:
 *
 *   Tag fallbacks. Filers use different concepts for the same line and migrate
 *   between them mid-history. Every line is resolved against an ordered
 *   candidate list and merged, so a series is never silently truncated.
 *
 *   Restatements. The same period appears repeatedly across filings with
 *   different values. The most recently filed value wins.
 *
 *   Fourth quarter. Most filers never report Q4 on its own; it sits inside the
 *   annual figure. Q4 is derived as full year less the three reported quarters,
 *   and flagged as derived so nobody mistakes it for a filed number.
 */

import { cached } from "@/lib/core/cache";
import { fetchJson } from "@/lib/core/fetcher";
import type { Envelope, Provenance } from "@/lib/core/types";

const FACTS_TTL_MS = 6 * 60 * 60 * 1000;

const SEC_UA =
  process.env.SEC_USER_AGENT ??
  "EY TMT Intelligence (contact: analyst@jewellabs.io)";

interface RawFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, { units: Record<string, RawFact[]> }>;
    "ifrs-full"?: Record<string, { units: Record<string, RawFact[]> }>;
    dei?: Record<string, { units: Record<string, RawFact[]> }>;
  };
}

export interface Period {
  /** Label such as "FY2025" or "Q3 FY2025". */
  label: string;
  start: string | null;
  end: string;
  value: number;
  form: string;
  filed: string;
  /** True when the value was computed rather than filed directly. */
  derived?: boolean;
}

export interface Line {
  key: string;
  label: string;
  /** Concept tags that actually resolved, for audit. */
  tags: string[];
  annual: Period[];
  quarterly: Period[];
}

export interface Statements {
  cik: string;
  entityName: string;
  lines: Record<string, Line>;
  currency: "USD";
  /** Most recent complete fiscal year label. */
  latestFy: string | null;
}

/* ---------------------------------------------------------------- *
 * Concept map
 * ---------------------------------------------------------------- */

interface LineSpec {
  key: string;
  label: string;
  /** us-gaap concept candidates, in preference order. */
  tags: string[];
  /** ifrs-full candidates. Foreign private issuers file on Form 20-F under IFRS. */
  ifrs?: string[];
  /** Balance-sheet items are point-in-time, not durations. */
  instant?: boolean;
  /**
   * Ratios using this line as a denominator are suppressed when it falls below
   * this share of revenue. A near-zero denominator produces a technically
   * correct number that is analytically meaningless, such as a cash conversion
   * of 6,933 percent on a company that barely broke even.
   */
  minShareOfRevenue?: number;
}

export const LINE_SPECS: LineSpec[] = [
  {
    key: "revenue",
    label: "Revenue",
    tags: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "SalesRevenueServicesNet",
    ],
    ifrs: ["Revenue", "RevenueFromContractsWithCustomers"],
  },
  {
    key: "costOfRevenue",
    label: "Cost of revenue",
    tags: [
      "CostOfRevenue",
      "CostOfGoodsAndServicesSold",
      "CostOfServices",
      "CostOfGoodsSold",
    ],
  },
  { key: "grossProfit", label: "Gross profit", tags: ["GrossProfit"], ifrs: ["GrossProfit"] },
  {
    key: "rnd",
    label: "Research and development",
    tags: ["ResearchAndDevelopmentExpense"],
    ifrs: ["ResearchAndDevelopmentExpense"],
  },
  {
    key: "sga",
    label: "Selling, general and administrative",
    tags: [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
    ],
  },
  {
    key: "operatingExpenses",
    label: "Total operating expenses",
    tags: ["OperatingExpenses", "CostsAndExpenses"],
  },
  {
    key: "operatingIncome",
    label: "Operating income",
    tags: ["OperatingIncomeLoss"],
    ifrs: ["ProfitLossFromOperatingActivities"],
  },
  {
    key: "pretaxIncome",
    label: "Income before tax",
    tags: [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
  },
  {
    key: "tax",
    label: "Income tax expense",
    tags: ["IncomeTaxExpenseBenefit"],
    ifrs: ["IncomeTaxExpenseContinuingOperations"],
  },
  {
    key: "netIncome",
    label: "Net income",
    tags: ["NetIncomeLoss", "ProfitLoss"],
    ifrs: ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
    // Below two percent of revenue the profit line stops being a usable base.
    minShareOfRevenue: 0.02,
  },
  {
    key: "eps",
    label: "Diluted earnings per share",
    tags: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
  },
  {
    key: "operatingCashFlow",
    label: "Cash from operations",
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    ifrs: ["CashFlowsFromUsedInOperatingActivities"],
  },
  {
    key: "capex",
    label: "Capital expenditure",
    tags: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
    ],
    ifrs: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
  },
  {
    key: "shareBasedComp",
    label: "Share-based compensation",
    tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  },
  { key: "assets", label: "Total assets", tags: ["Assets"], ifrs: ["Assets"], instant: true },
  {
    key: "equity",
    label: "Shareholders equity",
    tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    ifrs: ["Equity", "EquityAttributableToOwnersOfParent"],
    instant: true,
    minShareOfRevenue: 0.05,
  },
  {
    key: "cash",
    label: "Cash and equivalents",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    instant: true,
  },
  {
    key: "receivables",
    label: "Accounts receivable",
    tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
    ifrs: ["CurrentTradeReceivables"],
    instant: true,
  },
];

/* ---------------------------------------------------------------- *
 * Extraction
 * ---------------------------------------------------------------- */

const ANNUAL_FORMS = /^(10-K|20-F|40-F)/;

function days(a: string | null | undefined, b: string): number | null {
  if (!a) return null;
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** Newest filing wins for a given period. */
function collapse(facts: RawFact[], keyOf: (f: RawFact) => string): RawFact[] {
  const map = new Map<string, RawFact>();
  for (const f of facts) {
    const k = keyOf(f);
    const held = map.get(k);
    if (!held || Date.parse(f.filed ?? "") > Date.parse(held.filed ?? "")) {
      map.set(k, f);
    }
  }
  return [...map.values()];
}

function fiscalLabel(end: string, fy?: number): string {
  return `FY${fy ?? Number(end.slice(0, 4))}`;
}

/**
 * Labels a quarter from its own period end and the company's fiscal year end.
 *
 * The fy and fp fields on a fact describe the filing that reported it, not the
 * period it covers, so two different quarters routinely carry the same pair.
 * Deriving the label from the dates is the only way to get a series that reads
 * in order and does not repeat itself.
 */
function quarterLabel(end: string, fyEndMonth: number): string {
  const d = new Date(`${end}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();

  // Months elapsed since the fiscal year began.
  const since = (month - fyEndMonth - 1 + 12) % 12;
  const quarter = Math.floor(since / 3) + 1;

  // A fiscal year is named for the calendar year it ends in.
  const fiscalYear = month > fyEndMonth ? year + 1 : year;

  return `Q${quarter} FY${fiscalYear}`;
}

/** Month (1-12) the fiscal year ends in, taken from the annual series. */
function fiscalYearEndMonth(annual: Period[]): number {
  const last = annual.at(-1);
  if (!last) return 12;
  return new Date(`${last.end}T00:00:00Z`).getUTCMonth() + 1;
}

function buildLine(
  spec: LineSpec,
  gaap: Record<string, { units: Record<string, RawFact[]> }>,
  ifrs: Record<string, { units: Record<string, RawFact[]> }>,
): Line | null {
  const collected: RawFact[] = [];
  const tagsUsed: string[] = [];

  // us-gaap first. Foreign private issuers file under IFRS on Form 20-F and
  // carry no us-gaap facts at all, so the second pass is what makes them work.
  const sources: Array<[string, Record<string, { units: Record<string, RawFact[]> }>]> = [
    ...spec.tags.map((t) => [t, gaap] as [string, typeof gaap]),
    ...(spec.ifrs ?? []).map((t) => [t, ifrs] as [string, typeof ifrs]),
  ];

  for (const [tag, book] of sources) {
    const entry = book[tag];
    if (!entry) continue;
    const unit =
      entry.units.USD ??
      entry.units["USD/shares"] ??
      Object.values(entry.units)[0];
    if (!unit?.length) continue;
    tagsUsed.push(tag);
    collected.push(...unit.filter((f) => typeof f.val === "number" && f.end));
  }

  if (collected.length === 0) return null;

  if (spec.instant) {
    const points = collapse(
      collected.filter((f) => !f.start),
      (f) => f.end,
    )
      .sort((a, b) => a.end.localeCompare(b.end))
      .map<Period>((f) => ({
        label: fiscalLabel(f.end, f.fy),
        start: null,
        end: f.end,
        value: f.val,
        form: f.form ?? "",
        filed: f.filed ?? "",
      }));

    return {
      key: spec.key,
      label: spec.label,
      tags: tagsUsed,
      // Balance-sheet dates come from every form, so keep them all and let the
      // caller match on the year end rather than filtering by form here.
      annual: points.slice(-40),
      quarterly: points.slice(-16),
    };
  }

  // Annual: full-year durations on an annual form.
  const annual = collapse(
    collected.filter((f) => {
      const d = days(f.start, f.end);
      return d !== null && d > 300 && d < 400 && ANNUAL_FORMS.test(f.form ?? "");
    }),
    (f) => `${f.start}|${f.end}`,
  )
    .sort((a, b) => a.end.localeCompare(b.end))
    .map<Period>((f) => ({
      label: fiscalLabel(f.end, f.fy),
      start: f.start ?? null,
      end: f.end,
      value: f.val,
      form: f.form ?? "",
      filed: f.filed ?? "",
    }));

  // Quarterly: roughly 90-day durations, from any form.
  const quarterly = collapse(
    collected.filter((f) => {
      const d = days(f.start, f.end);
      return d !== null && d > 80 && d < 100;
    }),
    (f) => `${f.start}|${f.end}`,
  )
    .sort((a, b) => a.end.localeCompare(b.end))
    .map<Period>((f) => ({
      label: "",
      start: f.start ?? null,
      end: f.end,
      value: f.val,
      form: f.form ?? "",
      filed: f.filed ?? "",
    }));

  const fyEnd = fiscalYearEndMonth(annual);
  for (const q of quarterly) q.label = quarterLabel(q.end, fyEnd);

  return {
    key: spec.key,
    label: spec.label,
    tags: tagsUsed,
    annual: annual.slice(-10),
    quarterly: quarterly.slice(-16),
  };
}

/**
 * Fills the missing fourth quarter.
 *
 * Filers report Q1 to Q3 on Form 10-Q and fold Q4 into the annual report, so a
 * raw quarterly series has a hole every fourth period. Where the three reported
 * quarters and the full year are all present, Q4 is the remainder. It is marked
 * derived, because it is arithmetic rather than a filed figure.
 */
function deriveFourthQuarters(line: Line): Line {
  if (line.annual.length === 0 || line.quarterly.length === 0) return line;

  const filled = [...line.quarterly];

  for (const year of line.annual) {
    if (!year.start) continue;

    const within = line.quarterly.filter(
      (q) =>
        q.start &&
        Date.parse(q.start) >= Date.parse(year.start!) - 86_400_000 &&
        Date.parse(q.end) <= Date.parse(year.end) + 86_400_000,
    );

    if (within.length !== 3) continue;
    if (filled.some((q) => q.end === year.end)) continue;

    const sum = within.reduce((s, q) => s + q.value, 0);
    const lastQuarterEnd = within
      .map((q) => q.end)
      .sort()
      .at(-1)!;

    filled.push({
      label: quarterLabel(year.end, fiscalYearEndMonth(line.annual)),
      start: lastQuarterEnd,
      end: year.end,
      value: year.value - sum,
      form: year.form,
      filed: year.filed,
      derived: true,
    });
  }

  filled.sort((a, b) => a.end.localeCompare(b.end));
  return { ...line, quarterly: filled.slice(-16) };
}

/* ---------------------------------------------------------------- *
 * Entry point
 * ---------------------------------------------------------------- */

export async function getStatements(cik: string): Promise<Envelope<Statements>> {
  const padded = cik.padStart(10, "0");

  const res = await cached(`sec:facts:${padded}`, FACTS_TTL_MS, async () => {
    const raw = await fetchJson<CompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
      {
        headers: { "User-Agent": SEC_UA, Accept: "application/json" },
        timeoutMs: 30000,
        maxBytes: 60 * 1024 * 1024,
      },
    );

    const gaap = raw.facts["us-gaap"] ?? {};
    const ifrs = raw.facts["ifrs-full"] ?? {};
    const lines: Record<string, Line> = {};

    for (const spec of LINE_SPECS) {
      const line = buildLine(spec, gaap, ifrs);
      if (line) lines[spec.key] = spec.instant ? line : deriveFourthQuarters(line);
    }

    const latestFy = lines.revenue?.annual.at(-1)?.label ?? null;

    return {
      cik: padded,
      entityName: raw.entityName,
      lines,
      currency: "USD" as const,
      latestFy,
    } satisfies Statements;
  });

  return {
    data: res.value,
    provenance: {
      kind: "filing",
      source: `SEC EDGAR XBRL company facts, ${res.value.entityName}`,
      url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
      retrievedAt: new Date(res.storedAt).toISOString(),
    },
  };
}

/* ---------------------------------------------------------------- *
 * Derived measures
 * ---------------------------------------------------------------- */

export interface Ratio {
  label: string;
  /** Null where the periods do not align. Never computed across mismatched periods. */
  value: number | null;
  unit: "%" | "x" | "days" | "USD";
  /** Plain reading of what the number indicates. */
  reading: string;
}

function at(line: Line | undefined, end: string): number | null {
  return line?.annual.find((p) => p.end === end)?.value ?? null;
}

export function annualRatios(s: Statements): {
  period: string | null;
  ratios: Ratio[];
} {
  const rev = s.lines.revenue?.annual.at(-1);
  if (!rev) return { period: null, ratios: [] };

  const end = rev.end;
  const revenue = rev.value;

  /** Computes only when both sides are present and the denominator is usable. */
  const ratio = (
    label: string,
    numerator: number | null,
    denominator: number | null,
    unit: Ratio["unit"],
    reading: (v: number) => string,
  ): Ratio => {
    const ok =
      numerator !== null &&
      denominator !== null &&
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0 &&
      // A denominator close to zero yields a correct number that means nothing.
      Math.abs(denominator) >= Math.abs(revenue) * 0.02;

    const scale = unit === "%" ? 100 : unit === "days" ? 365 : 1;
    const value = ok ? (numerator / denominator) * scale : null;

    return {
      label,
      value,
      unit,
      reading:
        value !== null
          ? reading(value)
          : numerator === null || denominator === null
            ? "Not reported for this period"
            : "The base is too close to zero for this ratio to carry meaning",
    };
  };

  const netIncome = at(s.lines.netIncome, end);
  const ocf = at(s.lines.operatingCashFlow, end);
  const capex = at(s.lines.capex, end);
  const receivables = at(s.lines.receivables, end);
  const equity = at(s.lines.equity, end);

  // Gross profit is often untagged. Derive it from cost of revenue instead of
  // dropping the line, and only when cost of revenue covers the same year.
  const grossTagged = at(s.lines.grossProfit, end);
  const cost = at(s.lines.costOfRevenue, end);
  const grossFallback = grossTagged ?? (cost !== null ? revenue - cost : null);

  return {
    period: rev.label,
    ratios: [
      ratio("Gross margin", grossFallback, revenue, "%", (v) =>
        v >= 60
          ? "Software-like. Cost of delivery is small against price."
          : v >= 30
            ? "Mixed model. Delivery cost is material but not dominant."
            : "Delivery-heavy. Margin is set by utilisation, not price.",
      ),
      ratio("Operating margin", at(s.lines.operatingIncome, end), revenue, "%", (v) =>
        v >= 25
          ? "Strong. Pricing power or scale is absorbing the cost base."
          : v >= 10
            ? "Workable. Leaves room for execution error but not much."
            : "Thin. Small cost movements swing the result.",
      ),
      ratio("Net margin", netIncome, revenue, "%", (v) =>
        v >= 20
          ? "High conversion to the bottom line."
          : v >= 5
            ? "Normal for the sector."
            : "Low. Check tax and interest drag.",
      ),
      ratio("Research intensity", at(s.lines.rnd, end), revenue, "%", (v) =>
        v >= 15
          ? "Product-led. Buying the next cycle."
          : v >= 6
            ? "Balanced between product and delivery."
            : "Delivery-led. Harvesting the current position.",
      ),
      ratio("Cash conversion", ocf, netIncome, "%", (v) =>
        v >= 100
          ? "Above one hundred percent. Earnings are backed by cash."
          : v >= 85
            ? "Adequate. Within the normal band."
            : "Below the floor. Check receivables ageing.",
      ),
      ratio(
        "Free cash margin",
        ocf !== null && capex !== null ? ocf - capex : null,
        revenue,
        "%",
        (v) =>
          v >= 20
            ? "Highly cash generative after investment."
            : v >= 5
              ? "Positive after investment."
              : "Investment is consuming most of operating cash.",
      ),
      ratio("Receivable days", receivables, revenue, "days", (v) =>
        v <= 60
          ? "Collecting promptly."
          : v <= 90
            ? "Normal for enterprise contracting."
            : "Extended. Working capital is funding customers.",
      ),
      ratio("Return on equity", netIncome, equity, "%", (v) =>
        v >= 20
          ? "High return on capital employed."
          : v >= 8
            ? "Adequate return."
            : "Low return on the equity base.",
      ),
      ratio(
        "Share-based comp",
        at(s.lines.shareBasedComp, end),
        revenue,
        "%",
        (v) =>
          v >= 12
            ? "Heavy. A material part of pay does not appear in cash."
            : v >= 4
              ? "Normal for technology."
              : "Modest against revenue.",
      ),
    ],
  };
}

/** Aligns a set of lines onto the periods revenue actually covers. */
export function alignedQuarters(
  s: Statements,
  keys: string[],
  limit = 8,
): Array<{ label: string; end: string; derived: boolean; values: Record<string, number | null> }> {
  const base = s.lines.revenue?.quarterly ?? [];
  return base.slice(-limit).map((q) => ({
    label: q.label,
    end: q.end,
    derived: Boolean(q.derived),
    values: Object.fromEntries(
      keys.map((k) => [
        k,
        s.lines[k]?.quarterly.find((p) => p.end === q.end)?.value ?? null,
      ]),
    ),
  }));
}

export function alignedYears(
  s: Statements,
  keys: string[],
  limit = 8,
): Array<{ label: string; end: string; values: Record<string, number | null> }> {
  const base = s.lines.revenue?.annual ?? [];
  return base.slice(-limit).map((y) => ({
    label: y.label,
    end: y.end,
    values: Object.fromEntries(
      keys.map((k) => [k, s.lines[k]?.annual.find((p) => p.end === y.end)?.value ?? null]),
    ),
  }));
}

export function provenanceFor(s: Statements): Provenance {
  return {
    kind: "filing",
    source: `SEC EDGAR XBRL, ${s.entityName}`,
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${s.cik}&type=10-K`,
    retrievedAt: new Date().toISOString(),
  };
}
