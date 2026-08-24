import { ledgerFor } from "@/lib/brain/ledger";
import { publishedFor } from "@/lib/research/published-ledger";
import { callFor } from "@/lib/data/ir-calls";
import { TRACKER } from "@/lib/data/sector-tracker";
import { PEER_UNIVERSE } from "@/lib/data/peer-universe";
import type { Company } from "@/lib/data/universe";
import type { FactKey, FactLedger, FactValue } from "@/lib/research/facts";
import type { Provenance } from "@/lib/core/types";

export type Basis = "quarterly" | "annual";

export interface Period {
  label: string;
  end: string;
  values: Partial<Record<FactKey, number>>;
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "USD" | "percent" | "count" | "days" | "ratio";
  prior: number | null;
  priorLabel: string | null;
  basis: string;
  how: string;
}

export interface CompanyView {
  company: {
    symbol: string;
    name: string;
    short: string;
    sector: string;
    subsector: string;
    region: string;
    currency: string;
    filesWithSec: boolean;
  };
  basis: Basis;
  periodsPerYear: number;
  latest: Period | null;
  priorYear: Period | null;
  periods: Period[];
  annual: Period[];
  kpis: Kpi[];
  perEmployee: Kpi[];
  operating: Kpi[];
  call: ReturnType<typeof callFor>;
  sources: Array<{ title: string; url: string; kind: string }>;
  provenance: Provenance | null;
  unavailable: string | null;
}

const PNL: FactKey[] = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "rnd",
  "sga",
  "operatingIncome",
  "pretaxIncome",
  "taxExpense",
  "netIncome",
];

const CARRIED: FactKey[] = [
  ...PNL,
  "employees",
  "cash",
  "receivables",
  "unbilled",
  "assets",
  "equity",
  "debt",
  "cashFromOps",
  "capex",
  "orderBook",
  "depreciation",
  "epsDiluted",
];

function pointsOf(ledger: FactLedger, key: FactKey, basis: Basis): FactValue[] {
  const line = ledger.series[key];
  if (!line) return [];
  return basis === "annual" ? line.annual : line.quarterly;
}

function chooseBasis(ledger: FactLedger): Basis {
  const revenue = ledger.series.revenue;
  if (!revenue) return "annual";
  const q = revenue.quarterly;
  const a = revenue.annual;
  if (q.length === 0) return "annual";
  if (a.length === 0) return "quarterly";
  return (q.at(-1)?.end ?? "") >= (a.at(-1)?.end ?? "") ? "quarterly" : "annual";
}

function assemble(ledger: FactLedger, basis: Basis): Period[] {
  const ends = new Map<string, string>();
  for (const key of CARRIED) {
    for (const p of pointsOf(ledger, key, basis)) ends.set(p.end, p.label);
  }

  return [...ends.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([end, label]) => {
      const values: Partial<Record<FactKey, number>> = {};
      for (const key of CARRIED) {
        const hit = pointsOf(ledger, key, basis).find((p) => p.end === end);
        if (hit) values[key] = hit.value;
      }
      return { label, end, values };
    })
    .filter((p) => Object.keys(p.values).length > 0)
    .slice(-16);
}

function headcountAt(ledger: FactLedger, end: string): number | null {
  const line = ledger.series.employees;
  if (!line) return null;
  const all = [...line.annual, ...line.quarterly].sort((a, b) => a.end.localeCompare(b.end));
  const exact = all.find((p) => p.end === end);
  if (exact) return exact.value;
  const before = all.filter((p) => p.end <= end).at(-1);
  if (!before) return null;
  const gap = (Date.parse(end) - Date.parse(before.end)) / 86_400_000;
  return gap <= 130 ? before.value : null;
}

function trackerFor(name: string, short: string) {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = [k(name), k(short)];
  return (
    TRACKER.find((t) => want.some((w) => k(t.name) === w || k(t.name).startsWith(w) || w.startsWith(k(t.name)))) ??
    null
  );
}

function peerFor(name: string, short: string) {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = [k(name), k(short)];
  return PEER_UNIVERSE.find((p) => want.some((w) => k(p.name) === w)) ?? null;
}

function kpi(
  key: string,
  label: string,
  unit: Kpi["unit"],
  value: number | null,
  prior: number | null,
  priorLabel: string | null,
  basis: string,
  how: string,
): Kpi {
  return { key, label, unit, value, prior, priorLabel, basis, how };
}

const over = (n: number | null | undefined, d: number | null | undefined): number | null =>
  n === null || n === undefined || d === null || d === undefined || d === 0 ? null : n / d;

export async function companyView(company: Company): Promise<CompanyView> {
  const shell: CompanyView = {
    company: {
      symbol: company.symbol,
      name: company.name,
      short: company.short,
      sector: company.sector,
      subsector: company.subsector,
      region: company.region,
      currency: company.currency,
      filesWithSec: company.secFiler,
    },
    basis: "annual",
    periodsPerYear: 1,
    latest: null,
    priorYear: null,
    periods: [],
    annual: [],
    kpis: [],
    perEmployee: [],
    operating: [],
    call: callFor(company.short) ?? callFor(company.name),
    sources: [],
    provenance: null,
    unavailable: null,
  };

  const { ledger, provenance, unavailable } = await ledgerFor(company);
  if (!ledger) return { ...shell, provenance, unavailable };

  const basis = chooseBasis(ledger);
  const periodsPerYear = basis === "quarterly" ? 4 : 1;
  const periods = assemble(ledger, basis);
  const annual = basis === "annual" ? periods : assemble(ledger, "annual");
  const latest = periods.at(-1) ?? null;

  const step = basis === "quarterly" ? 4 : 1;
  const priorYear = periods.length > step ? periods[periods.length - 1 - step] : null;

  const published = publishedFor(company.symbol);
  const tracker = trackerFor(company.name, company.short);
  const peer = peerFor(company.name, company.short);

  const v = latest?.values ?? {};
  const p = priorYear?.values ?? {};
  const priorLabel = priorYear?.label ?? null;

  const filedHead = latest ? headcountAt(ledger, latest.end) : null;
  const priorHead = priorYear ? headcountAt(ledger, priorYear.end) : null;

  const trackedHead =
    tracker?.metrics.headcountK?.latest == null ? null : tracker.metrics.headcountK.latest * 1000;
  const head = filedHead ?? trackedHead;
  const headBasis =
    filedHead !== null
      ? `${filedHead.toLocaleString("en-US")} employees, ${latest?.label ?? ""}`
      : head !== null
        ? `${head.toLocaleString("en-US")} employees, as the quarterly tracker read it`
        : "Headcount not published";

  const annualRevenue = v.revenue === undefined ? null : v.revenue * periodsPerYear;
  const priorAnnualRevenue = p.revenue === undefined ? null : p.revenue * periodsPerYear;

  const held = tracker?.metrics.utilisationPct?.latest;
  const utilisation = held == null ? null : held * 100;

  const marginPct = (key: FactKey, from: Partial<Record<FactKey, number>>) => {
    const r = over(from[key], from.revenue);
    return r === null ? null : r * 100;
  };

  const kpis: Kpi[] = [
    kpi("revenue", "Revenue", "USD", v.revenue ?? null, p.revenue ?? null, priorLabel, latest?.label ?? "", "As reported for the period."),
    kpi(
      "revenueGrowth",
      "Revenue growth, year on year",
      "percent",
      over((v.revenue ?? 0) - (p.revenue ?? 0), p.revenue) === null ? null : over((v.revenue ?? 0) - (p.revenue ?? 0), p.revenue)! * 100,
      null,
      null,
      priorLabel ? `${latest?.label} against ${priorLabel}` : "",
      "The period against the same period a year earlier.",
    ),
    kpi("grossMargin", "Gross margin", "percent", marginPct("grossProfit", v), marginPct("grossProfit", p), priorLabel, latest?.label ?? "", "Gross profit over revenue."),
    kpi("operatingMargin", "Operating margin", "percent", marginPct("operatingIncome", v), marginPct("operatingIncome", p), priorLabel, latest?.label ?? "", "Operating income over revenue."),
    kpi("netMargin", "Net margin", "percent", marginPct("netIncome", v), marginPct("netIncome", p), priorLabel, latest?.label ?? "", "Net income over revenue."),
    kpi("operatingIncome", "Operating income", "USD", v.operatingIncome ?? null, p.operatingIncome ?? null, priorLabel, latest?.label ?? "", "As reported for the period."),
    kpi("netIncome", "Net income", "USD", v.netIncome ?? null, p.netIncome ?? null, priorLabel, latest?.label ?? "", "As reported for the period."),
    kpi(
      "receivableDays",
      "Receivable days",
      "days",
      over(v.receivables, annualRevenue) === null ? null : over(v.receivables, annualRevenue)! * 365,
      over(p.receivables, priorAnnualRevenue) === null ? null : over(p.receivables, priorAnnualRevenue)! * 365,
      priorLabel,
      latest?.label ?? "",
      "Receivables at the period end over revenue for the year, in days.",
    ),
    kpi(
      "cashConversion",
      "Cash conversion",
      "percent",
      over(v.cashFromOps, v.netIncome) === null ? null : over(v.cashFromOps, v.netIncome)! * 100,
      over(p.cashFromOps, p.netIncome) === null ? null : over(p.cashFromOps, p.netIncome)! * 100,
      priorLabel,
      latest?.label ?? "",
      "Cash from operations over net income.",
    ),
    kpi(
      "returnOnEquity",
      "Return on equity",
      "percent",
      over(v.netIncome === undefined ? null : v.netIncome * periodsPerYear, v.equity) === null
        ? null
        : over(v.netIncome! * periodsPerYear, v.equity)! * 100,
      null,
      null,
      latest?.label ?? "",
      "Net income for the year over shareholders equity at the period end.",
    ),
  ];

  const perEmployee: Kpi[] = [
    kpi(
      "revenuePerEmployee",
      "Revenue per employee",
      "USD",
      over(annualRevenue, head),
      over(priorAnnualRevenue, priorHead),
      priorLabel,
      headBasis,
      "Revenue for the year over closing headcount.",
    ),
    kpi(
      "costPerEmployee",
      "Cost of services per employee",
      "USD",
      over(v.costOfRevenue === undefined ? null : v.costOfRevenue * periodsPerYear, head),
      over(p.costOfRevenue === undefined ? null : p.costOfRevenue * periodsPerYear, priorHead),
      priorLabel,
      headBasis,
      "Cost of services for the year over closing headcount.",
    ),
    kpi(
      "sgaPerEmployee",
      "SG&A per employee",
      "USD",
      over(v.sga === undefined ? null : v.sga * periodsPerYear, head),
      over(p.sga === undefined ? null : p.sga * periodsPerYear, priorHead),
      priorLabel,
      headBasis,
      "Selling, general and administrative expense for the year over closing headcount.",
    ),
    kpi(
      "revenuePerBillable",
      "Revenue per billable employee",
      "USD",
      utilisation === null ? null : over(annualRevenue, head === null ? null : head * (utilisation / 100)),
      null,
      null,
      utilisation === null ? "" : `${utilisation.toFixed(1)} percent utilised`,
      "Revenue for the year over headcount multiplied by the utilisation the company published. Absent where a company does not publish utilisation.",
    ),
    kpi(
      "profitPerEmployee",
      "Operating profit per employee",
      "USD",
      over(v.operatingIncome === undefined ? null : v.operatingIncome * periodsPerYear, head),
      over(p.operatingIncome === undefined ? null : p.operatingIncome * periodsPerYear, priorHead),
      priorLabel,
      headBasis,
      "Operating income for the year over closing headcount.",
    ),
    kpi(
      "headcount",
      "Closing headcount",
      "count",
      head,
      priorHead,
      priorLabel,
      headBasis,
      filedHead !== null
        ? "As the company published it for the period."
        : "This company tags no employee count in the register and publishes it only in a fact sheet the reader cannot open, so the quarterly tracker's reading is used and dated here.",
    ),
  ];

  const operating: Kpi[] = [
    kpi(
      "utilisation",
      "Utilisation",
      "percent",
      utilisation,
      tracker?.metrics.utilisationPct?.prior == null ? null : tracker.metrics.utilisationPct.prior * 100,
      tracker ? "prior quarter" : null,
      tracker ? "Quarterly tracker" : "",
      "As published. Companies that do not disclose utilisation carry nothing here.",
    ),
    kpi(
      "attrition",
      "Attrition, trailing twelve months",
      "percent",
      published?.attritionPct ?? (tracker?.metrics.attritionPct?.latest == null ? null : tracker.metrics.attritionPct.latest * 100),
      tracker?.metrics.attritionPct?.prior == null ? null : tracker.metrics.attritionPct.prior * 100,
      tracker ? "prior quarter" : null,
      published ? published.periodLabel : tracker ? "Quarterly tracker" : "",
      "On the company's own definition, which is usually trailing twelve months.",
    ),
    kpi(
      "orderBook",
      "Deal wins for the period",
      "USD",
      published?.orderBookUsdM == null ? (v.orderBook ?? null) : published.orderBookUsdM * 1e6,
      null,
      null,
      published?.periodLabel ?? latest?.label ?? "",
      "Total contract value the company reported winning in the period.",
    ),
    kpi(
      "ebitdaMargin",
      "EBITDA margin",
      "percent",
      published?.ebitdaMarginPct ?? peer?.ebitdaPct ?? null,
      null,
      null,
      published?.periodLabel ?? peer?.lastReported ?? "",
      "As the company published it. EBITDA is not a filed concept, so it is taken rather than computed.",
    ),
  ];

  const sources: CompanyView["sources"] = [];
  if (published?.sourceUrl) {
    sources.push({ title: published.sourceTitle, url: published.sourceUrl, kind: published.sourceKind });
  }
  const call = shell.call;
  if (call) {
    sources.push({ title: call.transcriptTitle, url: call.transcriptUrl, kind: "earnings call transcript" });
  }
  if (provenance?.url) {
    sources.push({ title: provenance.source, url: provenance.url, kind: "the record the figures were read from" });
  }

  return {
    ...shell,
    basis,
    periodsPerYear,
    latest,
    priorYear,
    periods,
    annual,
    kpis,
    perEmployee,
    operating,
    sources,
    provenance,
    unavailable: null,
  };
}
