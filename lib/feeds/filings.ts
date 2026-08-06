import { cached } from "@/lib/core/cache";
import { fetchBuffer, safeFetch } from "@/lib/core/fetcher";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import type { Envelope, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const DOC_TTL_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export interface FilingRef {
  fiscalYear: string;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  url: string;
}

export function candidateFilings(now = new Date(), count = 6): FilingRef[] {
  const month = now.getUTCMonth(); // 0 = January
  const year = now.getUTCFullYear();

  let fyStart = month >= 3 ? year : year - 1;
  let q: 1 | 2 | 3 | 4;
  if (month >= 6 && month <= 8) q = 1;
  else if (month >= 9 && month <= 11) q = 2;
  else if (month >= 0 && month <= 2) q = 3;
  else if (month >= 3 && month <= 5) q = 4;
  else q = 1;

  if (q === 4) fyStart -= 1;

  const refs: FilingRef[] = [];
  for (let i = 0; i < count; i++) {
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    const filename = `Q${q} ${fy} Fact Sheet.pdf`;
    refs.push({
      fiscalYear: fy,
      quarter: q,
      label: `Q${q} FY${String((fyStart + 1) % 100).padStart(2, "0")}`,
      url:
        "https://www.tcs.com/content/dam/tcs/investor-relations/financial-statements/" +
        `${fy}/q${q}/Presentations/${encodeURIComponent(filename)}`,
    });

    if (q === 1) {
      q = 4;
      fyStart -= 1;
    } else {
      q = (q - 1) as 1 | 2 | 3;
    }
  }

  return refs;
}

export async function discoverLatestFiling(): Promise<FilingRef> {
  const res = await cached("filing:latest", DISCOVERY_TTL_MS, async () => {
    const candidates = candidateFilings();
    const errors: string[] = [];

    for (const ref of candidates) {
      try {
        const head = await safeFetch(ref.url, { timeoutMs: 9000, retries: 0 });
        const type = head.headers.get("content-type") ?? "";
        await head.arrayBuffer();
        if (type.includes("pdf")) return ref;
        errors.push(`${ref.label}: unexpected content-type ${type}`);
      } catch (err) {
        errors.push(
          `${ref.label}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new Error(
      `No fact sheet resolved. Tried ${candidates.length} candidates. ${errors.join("; ")}`,
    );
  });

  return res.value;
}

export interface SegmentParse {
  label: string;
  values: number[];
}

export interface FactSheetParse {
  ref: FilingRef;
  headline: {
    revenueInrMn: number | null;
    revenueUsdMn: number | null;
    revenueQoqInrPct: number | null;
    revenueYoyInrPct: number | null;
    revenueYoyUsdPct: number | null;
    ccQoqPct: number | null;
    ccYoyPct: number | null;
    operatingMarginPct: number | null;
    netMarginPct: number | null;
    closingHeadcount: number | null;
    attritionLtmPct: number | null;
    orderBookTcvUsdBn: number | null;
    northAmericaTcvUsdBn: number | null;
    bfsiTcvUsdBn: number | null;
  };
  geography: SegmentParse[];
  verticals: SegmentParse[];
  lines: string[];
  meta: {
    pageCount: number;
    encrypted: boolean;
    streamsTotal: number;
    streamsDecoded: number;
    lineCount: number;
  };
}

function num(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "").replace(/,/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

function firstMatch(lines: string[], re: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m;
  }
  return null;
}

function parseSegmentRow(lines: string[], label: string): SegmentParse | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s+([-\\d.,\\s]+)$`, "i");

  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const values = (m[1].match(/-?\s?\d+(?:\.\d+)?/g) ?? [])
      .map((t) => num(t))
      .filter((v): v is number => v !== null);
    if (values.length >= 5) return { label, values };
  }
  return null;
}

const GEO_LABELS = [
  "North America",
  "Latin America",
  "UK",
  "Continental Europe",
  "Asia Pacific",
  "India",
  "MEA",
];

const VERTICAL_LABELS = [
  "BFSI",
  "Consumer Business",
  "Life Sciences & Healthcare",
  "Manufacturing",
  "Technology & Services",
  "Communication & Media",
  "Energy, Resources and Utilities",
  "Regional Markets & Others",
];

export function parseFactSheet(
  lines: string[],
  ref: FilingRef,
  meta: FactSheetParse["meta"],
): FactSheetParse {
  const inrRev = firstMatch(
    lines,
    /INR Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn,\s*(?:up|down)?\s*(-?[\d.]+)%\s*QoQ\s*\|\s*(?:up|down)?\s*(-?[\d.]+)%\s*YoY/i,
  );
  const usdRev = firstMatch(
    lines,
    /USD Revenue of\s*\D{0,3}\s*([\d,]+)\s*Mn,\s*(?:(Flat)|(?:up|down)\s*(-?[\d.]+)%)\s*QoQ\s*\|\s*(?:up|down)?\s*(-?[\d.]+)%\s*YoY/i,
  );
  const cc = firstMatch(
    lines,
    /Constant currency revenue\s*(?:up|down)?\s*(-?[\d.]+)%\s*QoQ\s*\|\s*(?:up|down)?\s*(-?[\d.]+)%\s*YoY/i,
  );
  const opMargin = firstMatch(lines, /Operating Margin at\s*(-?[\d.]+)\s*%/i);
  const netMargin = firstMatch(lines, /Net Margin at\s*(-?[\d.]+)\s*%/i);
  const headcount = firstMatch(lines, /Closing headcount\s*:?\s*([\d,]+)/i);
  const attrition = firstMatch(
    lines,
    /(?:Voluntary\s+)?LTM attrition at\s*([\d.]+)\s*%/i,
  );
  const tcv = firstMatch(lines, /Order book TCV at\s*\$?\s*([\d.]+)\s*Bn/i);
  const naTcv = firstMatch(
    lines,
    /North America TCV at\s*\$?\s*([\d.]+)\s*Bn/i,
  );
  const bfsiTcv = firstMatch(lines, /BFSI TCV at\s*\$?\s*([\d.]+)\s*Bn/i);

  return {
    ref,
    headline: {
      revenueInrMn: num(inrRev?.[1]),
      revenueUsdMn: num(usdRev?.[1]),
      revenueQoqInrPct: num(inrRev?.[2]),
      revenueYoyInrPct: num(inrRev?.[3]),
      revenueYoyUsdPct: num(usdRev?.[4]),
      ccQoqPct: num(cc?.[1]),
      ccYoyPct: num(cc?.[2]),
      operatingMarginPct: num(opMargin?.[1]),
      netMarginPct: num(netMargin?.[1]),
      closingHeadcount: num(headcount?.[1]),
      attritionLtmPct: num(attrition?.[1]),
      orderBookTcvUsdBn: num(tcv?.[1]),
      northAmericaTcvUsdBn: num(naTcv?.[1]),
      bfsiTcvUsdBn: num(bfsiTcv?.[1]),
    },
    geography: GEO_LABELS.map((l) => parseSegmentRow(lines, l)).filter(
      (r): r is SegmentParse => r !== null,
    ),
    verticals: VERTICAL_LABELS.map((l) => parseSegmentRow(lines, l)).filter(
      (r): r is SegmentParse => r !== null,
    ),
    lines,
    meta,
  };
}

export function parseConfidence(parsed: FactSheetParse): {
  score: number;
  recovered: number;
  expected: number;
  missing: string[];
} {
  const checks: Array<[string, boolean]> = [
    ["revenue INR", parsed.headline.revenueInrMn !== null],
    ["revenue USD", parsed.headline.revenueUsdMn !== null],
    ["operating margin", parsed.headline.operatingMarginPct !== null],
    ["net margin", parsed.headline.netMarginPct !== null],
    ["headcount", parsed.headline.closingHeadcount !== null],
    ["attrition", parsed.headline.attritionLtmPct !== null],
    ["order book TCV", parsed.headline.orderBookTcvUsdBn !== null],
    ["geography table", parsed.geography.length >= 5],
    ["vertical table", parsed.verticals.length >= 5],
  ];

  const recovered = checks.filter(([, ok]) => ok).length;
  return {
    score: recovered / checks.length,
    recovered,
    expected: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([name]) => name),
  };
}

export async function getLatestFactSheet(): Promise<Envelope<FactSheetParse>> {
  const ref = await discoverLatestFiling();

  const res = await cached(`filing:parse:${ref.url}`, DOC_TTL_MS, async () => {
    const bytes = await fetchBuffer(ref.url, {
      timeoutMs: 30000,
      retries: 1,
      maxBytes: 25 * 1024 * 1024,
    });

    let extracted;
    try {
      extracted = extractPdfText(bytes);
    } catch (err) {
      if (err instanceof PdfParseError) {
        throw new Error(`Could not read ${ref.label}: ${err.message}`);
      }
      throw err;
    }

    const parsed = parseFactSheet(extracted.lines, ref, {
      pageCount: extracted.pageCount,
      encrypted: extracted.encrypted,
      streamsTotal: extracted.streamsTotal,
      streamsDecoded: extracted.streamsDecoded,
      lineCount: extracted.lines.length,
    });

    return { parsed, bytes: bytes.byteLength };
  });

  const confidence = parseConfidence(res.value.parsed);

  const provenance: Provenance = {
    kind: confidence.score >= 0.6 ? "filing" : "unavailable",
    source: `Tata Consultancy Services, ${ref.label} Fact Sheet`,
    url: ref.url,
    retrievedAt: new Date(res.storedAt).toISOString(),
    note:
      confidence.score >= 0.6
        ? `Parsed ${confidence.recovered} of ${confidence.expected} expected structures from ${res.value.bytes.toLocaleString()} bytes.`
        : `Parse recovered only ${confidence.recovered} of ${confidence.expected} structures. Missing: ${confidence.missing.join(", ")}.`,
  };

  return { data: res.value.parsed, provenance };
}
