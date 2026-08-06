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
  label: string;
  start: string | null;
  end: string;
  value: number;
  form: string;
  filed: string;
  derived?: boolean;
}

export interface Line {
  key: string;
  label: string;
  tags: string[];
  annual: Period[];
  quarterly: Period[];
}

export interface Statements {
  cik: string;
  entityName: string;
  lines: Record<string, Line>;
  currency: "USD";
  latestFy: string | null;
}

interface LineSpec {
  key: string;
  label: string;
  tags: string[];
  ifrs?: string[];
  instant?: boolean;
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

const ANNUAL_FORMS = /^(10-K|20-F|40-F)/;

function days(a: string | null | undefined, b: string): number | null {
  if (!a) return null;
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

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

function fiscalLabel(end: string): string {
  return `FY${new Date(`${end}T00:00:00Z`).getUTCFullYear()}`;
}

function quarterLabel(end: string, fyEndMonth: number): string {
  const d = new Date(`${end}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();

  const since = (month - fyEndMonth - 1 + 12) % 12;
  const quarter = Math.floor(since / 3) + 1;

  const fiscalYear = month > fyEndMonth ? year + 1 : year;

  return `Q${quarter} FY${fiscalYear}`;
}

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
        label: fiscalLabel(f.end),
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
      annual: points.slice(-40),
      quarterly: points.slice(-16),
    };
  }

  const annual = collapse(
    collected.filter((f) => {
      const d = days(f.start, f.end);
      return d !== null && d > 300 && d < 400 && ANNUAL_FORMS.test(f.form ?? "");
    }),
    (f) => `${f.start}|${f.end}`,
  )
    .sort((a, b) => a.end.localeCompare(b.end))
    .map<Period>((f) => ({
      label: fiscalLabel(f.end),
      start: f.start ?? null,
      end: f.end,
      value: f.val,
      form: f.form ?? "",
      filed: f.filed ?? "",
    }));

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

export interface Ratio {
  label: string;
  value: number | null;
  unit: "%" | "x" | "days" | "USD";
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
