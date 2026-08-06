import { UNIVERSE, type Company } from "@/lib/data/universe";
import { CONFIDENCE_FLOOR, classifyIntent } from "@/lib/brain/classifier";

export type Intent =
  | "metric"      // what is X's operating margin
  | "compare"     // X versus Y
  | "rank"        // who has the best margin
  | "trend"       // how has X's revenue moved
  | "explain"     // why did the margin fall
  | "product"     // what does this dashboard do
  | "unknown";

export type MetricKey =
  | "revenue"
  | "grossMargin"
  | "operatingMargin"
  | "netMargin"
  | "rndIntensity"
  | "cashConversion"
  | "freeCashMargin"
  | "receivableDays"
  | "returnOnEquity"
  | "shareBasedComp"
  | "revenueGrowth"
  | "headcount"
  | "attrition";

export interface MetricDef {
  key: MetricKey;
  label: string;
  terms: string[];
  unit: "%" | "USD" | "days" | "count";
  betterHigh: boolean | null;
}

export const METRICS: MetricDef[] = [
  { key: "operatingMargin", label: "Operating margin", terms: ["operating margin", "operating profitability", "ebit margin", "op margin"], unit: "%", betterHigh: true },
  { key: "grossMargin", label: "Gross margin", terms: ["gross margin", "gross profitability"], unit: "%", betterHigh: true },
  { key: "netMargin", label: "Net margin", terms: ["net margin", "net profitability", "bottom line margin"], unit: "%", betterHigh: true },
  { key: "rndIntensity", label: "Research intensity", terms: ["research intensity", "r and d", "r&d", "rnd", "research spend", "research and development"], unit: "%", betterHigh: null },
  { key: "cashConversion", label: "Cash conversion", terms: ["cash conversion", "cash generation", "converts to cash", "earnings quality"], unit: "%", betterHigh: true },
  { key: "freeCashMargin", label: "Free cash margin", terms: ["free cash margin", "free cash flow margin", "free cash"], unit: "%", betterHigh: true },
  { key: "receivableDays", label: "Receivable days", terms: ["receivable days", "receivables", "dso", "days sales outstanding", "collection"], unit: "days", betterHigh: false },
  { key: "returnOnEquity", label: "Return on equity", terms: ["return on equity", "roe"], unit: "%", betterHigh: true },
  { key: "shareBasedComp", label: "Share-based comp", terms: ["share based comp", "stock compensation", "sbc", "equity compensation"], unit: "%", betterHigh: null },
  { key: "revenueGrowth", label: "Revenue growth", terms: ["revenue growth", "growth rate", "top line growth", "cagr", "how fast"], unit: "%", betterHigh: true },
  { key: "revenue", label: "Revenue", terms: ["revenue", "turnover", "top line", "sales"], unit: "USD", betterHigh: true },
  { key: "headcount", label: "Headcount", terms: ["headcount", "employees", "workforce size", "staff"], unit: "count", betterHigh: null },
  { key: "attrition", label: "Attrition", terms: ["attrition", "churn of staff", "staff turnover"], unit: "%", betterHigh: false },
];

export interface ParsedQuestion {
  raw: string;
  intent: Intent;
  companies: Company[];
  metrics: MetricDef[];
  subsector: string | null;
  superlative: "best" | "worst" | null;
}

const AMBIGUOUS = new Set(["arm", "meta", "dell", "sap"]);

interface Alias {
  needle: string;
  company: Company;
  weight: number;
}

const ALIASES: Alias[] = (() => {
  const out: Alias[] = [];
  for (const c of UNIVERSE) {
    const base = c.name
      .replace(/\b(Inc|Corp|Corporation|Limited|Ltd|plc|SE|NV|Group|Holdings|Technologies|Company|Platforms|Systems)\b\.?/gi, "")
      .replace(/[.,]/g, "")
      .trim()
      .toLowerCase();
    const short = c.short.toLowerCase();
    const ticker = c.symbol.split(".")[0].toLowerCase();

    for (const n of new Set([base, short, ticker])) {
      if (!n || n.length < 3) continue;
      out.push({ needle: n, company: c, weight: n.length + (AMBIGUOUS.has(n) ? -50 : 0) });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
})();

function resolveCompanies(q: string, original: string): Company[] {
  const found: Company[] = [];
  let remaining = q;

  for (const a of ALIASES) {
    if (found.some((c) => c.symbol === a.company.symbol)) continue;
    const re = new RegExp(`\\b${a.needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(remaining)) continue;

    if (AMBIGUOUS.has(a.needle)) {
      const capital = new RegExp(`\\b${a.needle[0].toUpperCase()}${a.needle.slice(1)}\\b`);
      if (!capital.test(original)) continue;
    }

    found.push(a.company);
    remaining = remaining.replace(re, " ");
    if (found.length >= 4) break;
  }
  return found;
}

const COMPARE_RE = /\b(versus|vs\.?|compared? (?:to|with|against)|against|between|and)\b/i;
const RANK_RE = /\b(best|worst|highest|lowest|top|bottom|leader|strongest|weakest|which (?:company|one|name)|who has)\b/i;
const TREND_RE = /\b(trend\w*|over time|histor\w+|movement|moved|trajectory|growth over|last \w+ (?:years|quarters)|by year|by quarter|each year|each quarter|since \d{4})\b/i;
const EXPLAIN_RE = /\b(why|what (?:does|do) .* mean|explain|cause|reason|driven by|because)\b/i;
const PRODUCT_RE = /\b(dashboard|console|this (?:tool|site|app)|how (?:do|does) (?:it|this)|what (?:is|does) this|provenance|source|agents?|workstream|security|supabase|stack)\b/i;

export function parseQuestion(raw: string): ParsedQuestion {
  const q = raw.toLowerCase();

  const companies = resolveCompanies(q, raw);

  const metrics: MetricDef[] = [];
  const sortedMetrics = [...METRICS].sort(
    (a, b) => Math.max(...b.terms.map((t) => t.length)) - Math.max(...a.terms.map((t) => t.length)),
  );
  for (const m of sortedMetrics) {
    if (metrics.some((x) => x.key === m.key)) continue;
    if (m.terms.some((t) => q.includes(t))) metrics.push(m);
  }

  const subsector =
    UNIVERSE.map((c) => c.subsector).find((s) => q.includes(s.toLowerCase())) ?? null;

  const superlative = /\b(best|highest|top|strongest|leader)\b/i.test(raw)
    ? ("best" as const)
    : /\b(worst|lowest|bottom|weakest)\b/i.test(raw)
      ? ("worst" as const)
      : null;

  let intent: Intent = "unknown";
  if (PRODUCT_RE.test(raw) && companies.length === 0) intent = "product";
  else if (RANK_RE.test(raw) && metrics.length > 0) intent = "rank";
  else if (companies.length >= 2 && COMPARE_RE.test(raw)) intent = "compare";
  else if (TREND_RE.test(raw) && (companies.length > 0 || metrics.length > 0)) intent = "trend";
  else if (metrics.length > 0 && companies.length > 0) intent = "metric";
  else if (EXPLAIN_RE.test(raw)) intent = "explain";
  else if (metrics.length > 0 || companies.length > 0) intent = "metric";

  const prediction = classifyIntent(placeholderForm(q, companies, metrics), {
    companies: companies.length,
    metrics: metrics.length,
  });

  if (prediction && prediction.confidence >= CONFIDENCE_FLOOR) {
    intent = prediction.intent as Intent;
  }

  return { raw, intent, companies, metrics, subsector, superlative };
}

function placeholderForm(q: string, companies: Company[], metrics: MetricDef[]): string {
  let out = q;

  for (const m of metrics) {
    for (const term of [...m.terms].sort((a, b) => b.length - a.length)) {
      out = out.split(term).join(" <metric> ");
    }
  }

  for (const c of companies) {
    const names = [
      c.short.toLowerCase(),
      c.name.toLowerCase(),
      c.symbol.split(".")[0].toLowerCase(),
    ].sort((a, b) => b.length - a.length);
    for (const n of names) {
      if (n.length < 3) continue;
      out = out.split(n).join(" <co> ");
    }
  }

  for (const s of new Set(UNIVERSE.map((c) => c.subsector.toLowerCase()))) {
    out = out.split(s).join(" <sub> ");
  }

  return out.replace(/\b\d+\b/g, " <num> ").replace(/\s+/g, " ").trim();
}
