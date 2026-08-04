/**
 * Investor relations harvester.
 *
 * Covers the companies that do not file with the SEC. Indian IT majors publish
 * a quarterly fact sheet on a predictable content path, so a series can be
 * assembled by fetching several quarters and parsing each one. Without this the
 * whole Indian cohort has no reported financials at all and every seat in a
 * review blocks on evidence that is, in fact, public.
 *
 * Documents are fetched with a full browser header set because these hosts
 * refuse a bare client, and several arrive AES-256 encrypted with an empty user
 * password, which lib/pdf/extract handles.
 */

import { cached } from "@/lib/core/cache";
import { fetchBuffer, safeFetch } from "@/lib/core/fetcher";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import type { Envelope, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const DOC_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

export interface IrDocRef {
  label: string;
  fiscalYear: string;
  quarter: 1 | 2 | 3 | 4;
  url: string;
}

export interface IrQuarter {
  label: string;
  url: string;
  revenueInrMn: number | null;
  revenueUsdMn: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  headcount: number | null;
  attritionLtmPct: number | null;
  orderBookUsdBn: number | null;
  ccGrowthYoyPct: number | null;
  inrGrowthYoyPct: number | null;
  /** Fraction of expected fields recovered. */
  confidence: number;
}

export interface IrProfile {
  symbol: string;
  name: string;
  /** Where the documents live, for the source link. */
  irUrl: string;
  quarters: IrQuarter[];
}

/* ---------------------------------------------------------------- *
 * Document paths
 * ---------------------------------------------------------------- */

/**
 * Indian fiscal years run April to March. A quarter's fact sheet lands roughly
 * three to four weeks after the quarter closes.
 */
function indianQuarters(now: Date, count: number): Array<{ fy: string; q: 1 | 2 | 3 | 4; label: string }> {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();

  let fyStart = month >= 3 ? year : year - 1;
  let q: 1 | 2 | 3 | 4;
  if (month >= 6 && month <= 8) q = 1;
  else if (month >= 9 && month <= 11) q = 2;
  else if (month >= 0 && month <= 2) q = 3;
  else q = 4;

  if (q === 4) fyStart -= 1;

  const out: Array<{ fy: string; q: 1 | 2 | 3 | 4; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    out.push({ fy, q, label: `Q${q} FY${String((fyStart + 1) % 100).padStart(2, "0")}` });
    if (q === 1) {
      q = 4;
      fyStart -= 1;
    } else {
      q = (q - 1) as 1 | 2 | 3;
    }
  }
  return out;
}

interface IrSource {
  symbol: string;
  name: string;
  irUrl: string;
  build(now: Date, count: number): IrDocRef[];
}

export const IR_SOURCES: IrSource[] = [
  {
    symbol: "TCS.NS",
    name: "Tata Consultancy Services",
    irUrl: "https://www.tcs.com/investor-relations/financial-statements",
    build: (now, count) =>
      indianQuarters(now, count).map(({ fy, q, label }) => ({
        label,
        fiscalYear: fy,
        quarter: q,
        url:
          "https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/" +
          `${fy}/q${q}/Presentations/${encodeURIComponent(`Q${q} ${fy} Fact Sheet.pdf`)}`,
      })),
  },
];

export function irSourceFor(symbol: string): IrSource | null {
  return IR_SOURCES.find((s) => s.symbol === symbol) ?? null;
}

/* ---------------------------------------------------------------- *
 * Parsing
 * ---------------------------------------------------------------- */

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

function firstMatch(lines: string[], re: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m;
  }
  return null;
}

/**
 * Reads the headline block of a quarterly fact sheet.
 *
 * The currency glyph does not survive the subset-font mapping in these decks,
 * so the prefixes ("INR Revenue of", "USD Revenue of") are the anchors rather
 * than the symbol.
 */
export function parseIrQuarter(lines: string[], ref: IrDocRef): IrQuarter {
  const inr = firstMatch(
    lines,
    /INR Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn[^|]*?(?:up|down)\s*(-?[\d.]+)%\s*YoY/i,
  );
  const usd = firstMatch(lines, /USD Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn/i);
  const cc = firstMatch(
    lines,
    /Constant currency revenue[^|]*?(?:up|down)\s*(-?[\d.]+)%\s*YoY/i,
  );
  const op = firstMatch(lines, /Operating Margin at\s*(-?[\d.]+)\s*%/i);
  const net = firstMatch(lines, /Net Margin at\s*(-?[\d.]+)\s*%/i);
  const head = firstMatch(lines, /Closing headcount\s*:?\s*([\d,]+)/i);
  const attr = firstMatch(lines, /LTM attrition at\s*([\d.]+)\s*%/i);
  const tcv = firstMatch(lines, /Order book TCV at\s*\$?\s*([\d.]+)\s*Bn/i);

  const q: IrQuarter = {
    label: ref.label,
    url: ref.url,
    revenueInrMn: num(inr?.[1]),
    revenueUsdMn: num(usd?.[1]),
    inrGrowthYoyPct: num(inr?.[2]),
    ccGrowthYoyPct: num(cc?.[1]),
    operatingMarginPct: num(op?.[1]),
    netMarginPct: num(net?.[1]),
    headcount: num(head?.[1]),
    attritionLtmPct: num(attr?.[1]),
    orderBookUsdBn: num(tcv?.[1]),
    confidence: 0,
  };

  const fields = [
    q.revenueInrMn,
    q.revenueUsdMn,
    q.operatingMarginPct,
    q.netMarginPct,
    q.headcount,
    q.attritionLtmPct,
    q.orderBookUsdBn,
  ];
  q.confidence = fields.filter((f) => f !== null).length / fields.length;

  return q;
}

/* ---------------------------------------------------------------- *
 * Harvest
 * ---------------------------------------------------------------- */

async function fetchQuarter(ref: IrDocRef): Promise<IrQuarter | null> {
  const res = await cached(`ir:doc:${ref.url}`, DOC_TTL_MS, async () => {
    const bytes = await fetchBuffer(ref.url, {
      timeoutMs: 25000,
      retries: 0,
      maxBytes: 25 * 1024 * 1024,
    });
    const extracted = extractPdfText(bytes);
    return parseIrQuarter(extracted.lines, ref);
  });
  return res.value;
}

/**
 * Pulls the last `count` quarters.
 *
 * Requests are serialised. These are a publisher's own servers, and a burst of
 * concurrent PDF downloads is both impolite and the fastest way to get blocked.
 * Quarters that 404 are skipped: the newest candidate often has not been
 * published yet, which is expected rather than an error.
 */
export async function getIrHistory(
  symbol: string,
  count = 8,
): Promise<Envelope<IrProfile> | null> {
  const source = irSourceFor(symbol);
  if (!source) return null;

  const res = await cached(`ir:history:${symbol}:${count}`, HISTORY_TTL_MS, async () => {
    const refs = source.build(new Date(), count);
    const quarters: IrQuarter[] = [];

    for (const ref of refs) {
      try {
        const q = await fetchQuarter(ref);
        // A parse that recovered almost nothing means the layout moved. Keep it
        // out rather than letting a half-read document into a trend.
        if (q && q.confidence >= 0.4) quarters.push(q);
      } catch (err) {
        if (err instanceof PdfParseError) continue;
        // 404 on an unpublished quarter is normal. Anything else is skipped too,
        // because one bad document should not fail the series.
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // Oldest first, so charts read left to right.
    quarters.reverse();

    return {
      symbol: source.symbol,
      name: source.name,
      irUrl: source.irUrl,
      quarters,
    } satisfies IrProfile;
  });

  return {
    data: res.value,
    provenance: {
      kind: res.value.quarters.length > 0 ? "filing" : "unavailable",
      source: `${source.name} investor relations, quarterly fact sheets`,
      url: source.irUrl,
      retrievedAt: new Date(res.storedAt).toISOString(),
      note:
        res.value.quarters.length > 0
          ? `${res.value.quarters.length} quarters parsed directly from the published documents.`
          : "No fact sheet could be retrieved or parsed.",
    },
  };
}

/** Confirms a document is reachable without downloading it in full. */
export async function probeIrDocument(url: string): Promise<boolean> {
  try {
    const res = await safeFetch(url, { timeoutMs: 8000, retries: 0 });
    const type = res.headers.get("content-type") ?? "";
    await res.arrayBuffer();
    return type.includes("pdf");
  } catch {
    return false;
  }
}

export { nowIso };
