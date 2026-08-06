import { cached } from "@/lib/core/cache";
import { fetchJson } from "@/lib/core/fetcher";
import type { Envelope, Provenance } from "@/lib/core/types";

const TICKER_TTL_MS = 24 * 60 * 60 * 1000;
const FILING_TTL_MS = 60 * 60 * 1000;
const FACT_TTL_MS = 6 * 60 * 60 * 1000;

const SEC_UA =
  process.env.SEC_USER_AGENT ?? "EY TMT Intelligence Console (contact: analyst@example.com)";

const HEADERS = { "User-Agent": SEC_UA, Accept: "application/json" };

export interface SecCompany {
  cik: string;
  ticker: string;
  title: string;
}

export interface SecFiling {
  form: string;
  filingDate: string;
  reportDate: string | null;
  accession: string;
  primaryDocument: string;
  description: string | null;
  url: string;
}

export interface SecProfile {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  filings: SecFiling[];
}

const MATERIAL_FORMS = new Set([
  "10-K", "10-Q", "8-K", "20-F", "6-K", "40-F",
  "DEF 14A", "S-1", "S-4", "424B4", "SC 13D", "11-K",
  "10-K/A", "10-Q/A", "8-K/A",
]);

async function tickerMap(): Promise<Map<string, SecCompany>> {
  const res = await cached("sec:tickers", TICKER_TTL_MS, async () => {
    const raw = await fetchJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: HEADERS, timeoutMs: 20000 },
    );

    const map = new Map<string, SecCompany>();
    for (const entry of Object.values(raw)) {
      if (!entry?.ticker) continue;
      map.set(entry.ticker.toUpperCase(), {
        cik: String(entry.cik_str).padStart(10, "0"),
        ticker: entry.ticker.toUpperCase(),
        title: entry.title,
      });
    }
    return map;
  });
  return res.value;
}

export async function resolveCik(ticker: string): Promise<SecCompany | null> {
  const base = ticker.split(".")[0].toUpperCase();
  const map = await tickerMap();
  return map.get(base) ?? null;
}

export async function searchCompanies(query: string, limit = 8): Promise<SecCompany[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const map = await tickerMap();
  const all = [...map.values()];

  const exact = all.filter((c) => c.ticker.toLowerCase() === q);
  const startsWith = all.filter(
    (c) => c.title.toLowerCase().startsWith(q) && !exact.includes(c),
  );
  const contains = all.filter(
    (c) =>
      c.title.toLowerCase().includes(q) &&
      !exact.includes(c) &&
      !startsWith.includes(c),
  );

  return [...exact, ...startsWith, ...contains].slice(0, limit);
}

export async function getProfile(cik: string): Promise<Envelope<SecProfile>> {
  const padded = cik.padStart(10, "0");

  const res = await cached(`sec:profile:${padded}`, FILING_TTL_MS, async () => {
    const raw = await fetchJson<{
      cik: string;
      name: string;
      tickers?: string[];
      exchanges?: string[];
      sic?: string;
      sicDescription?: string;
      fiscalYearEnd?: string;
      filings: {
        recent: {
          form: string[];
          filingDate: string[];
          reportDate: string[];
          accessionNumber: string[];
          primaryDocument: string[];
          primaryDocDescription: string[];
        };
      };
    }>(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      headers: HEADERS,
      timeoutMs: 20000,
      maxBytes: 30 * 1024 * 1024,
    });

    const r = raw.filings.recent;
    const filings: SecFiling[] = [];

    for (let i = 0; i < r.form.length && filings.length < 40; i++) {
      if (!MATERIAL_FORMS.has(r.form[i])) continue;
      const accession = r.accessionNumber[i].replace(/-/g, "");
      filings.push({
        form: r.form[i],
        filingDate: r.filingDate[i],
        reportDate: r.reportDate[i] || null,
        accession: r.accessionNumber[i],
        primaryDocument: r.primaryDocument[i],
        description: r.primaryDocDescription[i] || null,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${accession}/${r.primaryDocument[i]}`,
      });
    }

    return {
      cik: padded,
      name: raw.name,
      tickers: raw.tickers ?? [],
      exchanges: raw.exchanges ?? [],
      sic: raw.sic ?? null,
      sicDescription: raw.sicDescription ?? null,
      fiscalYearEnd: raw.fiscalYearEnd ?? null,
      filings,
    } satisfies SecProfile;
  });

  return {
    data: res.value,
    provenance: {
      kind: res.fresh ? "live" : "cached",
      source: "SEC EDGAR submissions",
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}`,
      retrievedAt: new Date(res.storedAt).toISOString(),
    },
  };
}

export interface FactPoint {
  start: string | null;
  end: string;
  value: number;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame: string | null;
}

export async function getConcept(
  cik: string,
  candidates: string[],
): Promise<{ tag: string; points: FactPoint[] } | null> {
  const padded = cik.padStart(10, "0");
  const merged = new Map<string, FactPoint>();
  const tagsUsed: string[] = [];

  for (const tag of candidates) {
    try {
      const res = await cached(`sec:concept:${padded}:${tag}`, FACT_TTL_MS, () =>
        fetchJson<{
          tag: string;
          units: Record<string, Array<Record<string, unknown>>>;
        }>(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/us-gaap/${tag}.json`,
          { headers: HEADERS, timeoutMs: 20000, retries: 0 },
        ),
      );

      const usd = res.value.units?.USD;
      if (!usd?.length) continue;
      tagsUsed.push(tag);

      for (const p of usd) {
        if (typeof p.val !== "number" || typeof p.end !== "string") continue;

        const point: FactPoint = {
          start: (p.start as string) ?? null,
          end: p.end as string,
          value: p.val as number,
          fy: (p.fy as number) ?? 0,
          fp: (p.fp as string) ?? "",
          form: (p.form as string) ?? "",
          filed: (p.filed as string) ?? "",
          frame: (p.frame as string) ?? null,
        };

        const key = `${point.start ?? ""}|${point.end}|${point.form}`;
        const held = merged.get(key);
        if (!held || Date.parse(point.filed) > Date.parse(held.filed)) {
          merged.set(key, point);
        }
      }
    } catch {
    }
  }

  if (merged.size === 0) return null;

  return {
    tag: tagsUsed.join(" + "),
    points: [...merged.values()].sort((a, b) => a.end.localeCompare(b.end)),
  };
}

export const CONCEPTS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
  ],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  operatingIncome: ["OperatingIncomeLoss"],
  grossProfit: ["GrossProfit"],
  rnd: ["ResearchAndDevelopmentExpense"],
  assets: ["Assets"],
  cashFromOps: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  employees: ["EntityNumberOfEmployees"],
} as const;

export function annualSeries(points: FactPoint[]): FactPoint[] {
  const annual = points.filter((p) => {
    if (!p.start || !p.end) return false;
    if (!/^10-K|^20-F|^40-F/.test(p.form)) return false;
    const days =
      (Date.parse(p.end) - Date.parse(p.start)) / (1000 * 60 * 60 * 24);
    return days > 300 && days < 400;
  });

  const byYear = new Map<string, FactPoint>();
  for (const p of annual) {
    const key = p.end.slice(0, 4);
    const held = byYear.get(key);
    if (!held || Date.parse(p.filed) > Date.parse(held.filed)) {
      byYear.set(key, p);
    }
  }

  return [...byYear.values()].sort((a, b) => a.end.localeCompare(b.end));
}

export function quarterlySeries(points: FactPoint[]): FactPoint[] {
  const quarters = points.filter((p) => {
    if (!p.start || !p.end) return false;
    const days =
      (Date.parse(p.end) - Date.parse(p.start)) / (1000 * 60 * 60 * 24);
    return days > 80 && days < 100;
  });

  const byPeriod = new Map<string, FactPoint>();
  for (const p of quarters) {
    const held = byPeriod.get(p.end);
    if (!held || Date.parse(p.filed) > Date.parse(held.filed)) {
      byPeriod.set(p.end, p);
    }
  }

  return [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end));
}

export function secProvenance(cik: string, label: string): Provenance {
  return {
    kind: "filing",
    source: `SEC EDGAR, ${label}`,
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`,
    retrievedAt: new Date().toISOString(),
  };
}
