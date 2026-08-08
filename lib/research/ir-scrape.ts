import { cached } from "@/lib/core/cache";
import { fetchBuffer, fetchText } from "@/lib/core/fetcher";
import { xlsxText, XlsxError } from "@/lib/research/xlsx";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import { parseNarrativeMetrics } from "@/lib/research/ir-narrative";
import { nowIso, type Provenance } from "@/lib/core/types";
import { IR_DISCOVERED } from "@/lib/data/ir-discovered";

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const DOC_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DOC_BYTES = 30 * 1024 * 1024;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export interface IrIndex {
  symbol: string;
  name: string;
  urls: string[];
  base?: string;
}

export const IR_INDEXES: IrIndex[] = [
  {
    symbol: "TCS.NS",
    name: "Tata Consultancy Services",
    urls: [
      "https://www.tcs.com/investor-relations/financial-statements",
      "https://www.tcs.com/investor-relations",
    ],
  },
  {
    symbol: "HCLTECH.NS",
    name: "HCL Technologies",
    urls: [
      "https://www.hcltech.com/investors/quarterly-results",
      "https://www.hcltech.com/investors",
    ],
  },
  {
    symbol: "MPHASIS.NS",
    name: "Mphasis Limited",
    urls: ["https://www.mphasis.com/home/corporate/investors.html"],
  },
  {
    symbol: "TECHM.NS",
    name: "Tech Mahindra",
    urls: [
      "https://www.techmahindra.com/investors/quarterly-earnings/",
      "https://www.techmahindra.com/en-in/investors/",
    ],
  },
  {
    symbol: "BHARTIARTL.NS",
    name: "Bharti Airtel",
    urls: ["https://www.airtel.in/about-bharti/equity/results"],
  },
  {
    symbol: "RELIANCE.NS",
    name: "Reliance Industries",
    urls: ["https://www.ril.com/InvestorRelations/FinancialReporting.aspx"],
  },
  {
    symbol: "LTIM.NS",
    name: "LTIMindtree",
    urls: [
      "https://www.ltm.com/investors/financial-results",
      "https://www.ltimindtree.com/investors/financial-results/",
    ],
  },
  {
    symbol: "COFORGE.NS",
    name: "Coforge Limited",
    urls: ["https://investors.coforge.com/quarter-reports", "https://investors.coforge.com/"],
  },
  {
    symbol: "PERSISTENT.NS",
    name: "Persistent Systems",
    urls: [
      "https://www.persistent.com/investors/quarterly-results/",
      "https://www.persistent.com/investors/",
    ],
  },
  {
    symbol: "CAP.PA",
    name: "Capgemini SE",
    urls: ["https://investors.capgemini.com/en/financial-results/", "https://investors.capgemini.com/en/"],
  },
  {
    symbol: "EXPN.L",
    name: "Experian plc",
    urls: [
      "https://www.experianplc.com/investors/results-reports-presentations/results-presentations",
      "https://www.experianplc.com/investors/",
    ],
  },
  {
    symbol: "ATE.PA",
    name: "Alten SA",
    urls: ["https://www.alten.com/investors/", "https://www.alten.com/finance/"],
  },
  {
    symbol: "ZENSARTECH.NS",
    name: "Zensar Technologies",
    urls: ["https://www.zensar.com/investors"],
  },
  {
    symbol: "BSOFT.NS",
    name: "Birlasoft Limited",
    urls: [
      "https://www.birlasoft.com/company/investors/policies-reports-filings",
      "https://www.birlasoft.com/company/investors",
    ],
  },
  {
    symbol: "MASTEK.NS",
    name: "Mastek Limited",
    urls: ["https://www.mastek.com/investors/financial-information/", "https://www.mastek.com/investors/"],
  },
  {
    symbol: "DATAMATICS.NS",
    name: "Datamatics Global Services",
    urls: ["https://www.datamatics.com/about-us/investor-relations/financials"],
  },
  {
    symbol: "RSYSTEMS.NS",
    name: "R Systems International",
    urls: ["https://www.rsystems.com/investors-info/"],
  },
  {
    symbol: "HAPPSTMNDS.NS",
    name: "Happiest Minds Technologies",
    urls: ["https://www.happiestminds.com/investors/"],
  },
  {
    symbol: "SAKSOFT.NS",
    name: "Saksoft Limited",
    urls: ["https://www.saksoft.com/investor/financials/", "https://www.saksoft.com/investors/"],
  },
  {
    symbol: "KELLTONTEC.NS",
    name: "Kellton Tech Solutions",
    urls: ["https://www.kellton.com/financial-results", "https://www.kellton.com/investors"],
  },
];

export function irIndexFor(symbol: string): IrIndex | null {
  return IR_INDEXES.find((i) => i.symbol === symbol) ?? null;
}

export interface IrDocRef {
  url: string;
  filename: string;
  kind: "workbook" | "document";
  period: string | null;
  score: number;
}

const FILE_LINK = /href\s*=\s*["']([^"'\s>]+\.(?:xlsx|xls|pdf))(?:\?[^"']*)?["']/gi;

const PERIOD_PATTERNS: RegExp[] = [
  /\b(Q[1-4])[ _-]?(FY)?[ _-]?(\d{2,4})\b/i,
  /\b([1-4])Q[ _-]?(FY)?[ _-]?(\d{2,4})\b/i,
  /\bFY[ _-]?(\d{2,4})\b/i,
];

function readPeriod(name: string): string | null {
  for (const re of PERIOD_PATTERNS) {
    const m = name.match(re);
    if (!m) continue;
    if (re === PERIOD_PATTERNS[2]) return `FY${m[1]}`;
    const q = m[1].toUpperCase().replace("Q", "");
    return `Q${q} FY${m[3]}`;
  }
  return null;
}

function score(filename: string, kind: IrDocRef["kind"], period: string | null): number {
  const n = filename.toLowerCase();
  let s = 0;

  if (kind === "workbook") s += 60;
  if (/data[ _-]?sheet|fact[ _-]?sheet|factsheet/.test(n)) s += 50;
  if (/key[ _-]?(financial|metric)|metrics/.test(n)) s += 40;
  if (/quarterly|results|earnings|financial/.test(n)) s += 25;
  if (/press[ _-]?release|investor[ _-]?release/.test(n)) s += 20;
  if (/transcript/.test(n)) s += 15;
  if (/annual[ _-]?report/.test(n)) s += 10;
  if (period) s += 30;

  const y = n.match(/f\s*y[ _-]?(\d{2})\b/) ?? n.match(/\b20(\d{2})\b/);
  if (y) s += Math.min(34, Number(y[1])) * 2;

  if (/policy|code[ _-]?of|charter|notice|intimation|disclosure|esg|sustainab|agm|postal|scrutin|newspaper|advertis|subsidiar/.test(n))
    s -= 70;

  return s;
}

function absolute(href: string, indexUrl: string, base?: string): string | null {
  try {
    return new URL(href, base ?? indexUrl).href;
  } catch {
    return null;
  }
}

interface DiscoveredIndex {
  indexUrl: string;
  mode: string;
  files: string[];
}

function discoveredFor(symbol: string): DiscoveredIndex | null {
  const hit = IR_DISCOVERED[symbol];
  return hit && hit.files.length > 0 ? hit : null;
}

export async function discoverIrDocuments(index: IrIndex): Promise<{
  indexUrl: string;
  docs: IrDocRef[];
}> {
  const res = await cached(`ir:index:${index.symbol}`, INDEX_TTL_MS, async () => {
    const seen = new Set<string>();
    const docs: IrDocRef[] = [];

    const add = (abs: string) => {
      if (seen.has(abs)) return;
      seen.add(abs);
      const filename = decodeURIComponent(abs.split("/").pop() ?? "").slice(0, 160);
      const kind: IrDocRef["kind"] = /\.xlsx?(\?|$)/i.test(filename) ? "workbook" : "document";
      const period = readPeriod(filename);
      docs.push({ url: abs, filename, kind, period, score: score(filename, kind, period) });
    };

    const pre = discoveredFor(index.symbol);
    if (pre) for (const abs of pre.files) add(abs);

    for (const url of index.urls) {
      let html: string;
      try {
        html = await fetchText(url, {
          headers: BROWSER_HEADERS,
          timeoutMs: 25_000,
          retries: 0,
          maxBytes: 8 * 1024 * 1024,
        });
      } catch {
        continue;
      }

      for (const m of html.matchAll(FILE_LINK)) {
        const abs = absolute(m[1], url, index.base);
        if (abs) add(abs);
      }

      if (docs.length > 0) {
        docs.sort((a, b) => b.score - a.score);
        return { indexUrl: pre?.indexUrl ?? url, docs: docs.slice(0, 60) };
      }
    }

    docs.sort((a, b) => b.score - a.score);
    return {
      indexUrl: pre?.indexUrl ?? index.urls[0],
      docs: docs.slice(0, 60),
    };
  });

  return res.value;
}

export interface IrUnit {
  currency: string | null;
  scale: number;
  scaleStated: boolean;
  source: string;
}

export interface IrMetric {
  label: string;
  values: Array<{ period: string; value: number }>;
  unit: IrUnit | null;
  unitFromLabel: boolean;
  structured?: boolean;
  /** Set when the figure was read from a sentence rather than a table. */
  derivedFrom?: string;
}

const CURRENCY_HINT: Array<[RegExp, string]> = [
  [/\bUSD?\b|\bUS ?\$|\$\s?(?:m|bn|k)\b|\bdollar/i, "USD"],
  [/\bINR\b|\bRs\.?\b|\brupee|₹/i, "INR"],
  [/\bEUR\b|\beuro\b|€/i, "EUR"],
  [/\bGBP\b|\bsterling\b|£/i, "GBP"],
];

const SCALE_HINT: Array<[RegExp, number]> = [
  [/\$\s?bn\b|\bbn\b|\bbillion/i, 1e9],
  [/\$\s?mn?\b/i, 1e6],
  [/\bcr\b|\bcrore/i, 1e7],
  [/\bmn\b|\bmillion/i, 1e6],
  [/\blakh/i, 1e5],
  [/\bthousand|\b'?000s?\b/i, 1e3],
];

function readUnitHint(line: string): IrUnit | null {
  if (line.length > 220) return null;
  let currency: string | null = null;
  for (const [re, code] of CURRENCY_HINT) {
    if (re.test(line)) {
      currency = code;
      break;
    }
  }
  let scale = 1;
  let scaled = false;
  for (const [re, mult] of SCALE_HINT) {
    if (re.test(line)) {
      scale = mult;
      scaled = true;
      break;
    }
  }
  if (!currency && !scaled) return null;
  return { currency, scale, scaleStated: scaled, source: line.slice(0, 160) };
}

const PERIOD_CELL =
  /^(?:[1-4]Q[ ]?(?:FY)?[0-9]{2,4}|Q[1-4][ _-]?(?:FY)?[ ]?[0-9]{2,4}|FY[ ]?[0-9]{2,4}|H[12][ ]?(?:FY)?[0-9]{2,4}|(?:19|20)[0-9]{2}[-/][0-9]{2}|[A-Z][a-z]{2}[-' ][0-9]{2,4})$/;

function isPeriodCell(s: string): boolean {
  return PERIOD_CELL.test(s.trim());
}

function readYearHeader(cells: string[]): string[] | null {
  const years: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    if (!/^(?:19|20)[0-9]{2}$/.test(cells[i])) continue;
    years.push({ i, v: Number(cells[i]) });
  }
  if (years.length < 3) return null;
  for (let i = 1; i < years.length; i++) {
    if (Math.abs(years[i].v - years[i - 1].v) !== 1) return null;
  }
  return cells;
}

const SERIAL_MIN = 36_526; // 2000-01-01
const SERIAL_MAX = 51_136; // 2040-01-01

function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function serialLabel(serial: number): string {
  const d = serialToDate(serial);
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

function readSerialHeader(cells: string[]): string[] | null {
  const serials: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    const n = Number(cells[i]);
    if (!Number.isInteger(n) || n < SERIAL_MIN || n > SERIAL_MAX) continue;
    serials.push({ i, v: n });
  }
  if (serials.length < 3) return null;

  const gaps: number[] = [];
  for (let i = 1; i < serials.length; i++) gaps.push(Math.abs(serials[i].v - serials[i - 1].v));

  const spaced = (lo: number, hi: number) => gaps.every((g) => g >= lo && g <= hi);
  if (!spaced(27, 32) && !spaced(85, 96) && !spaced(180, 190) && !spaced(360, 370)) return null;

  const out = [...cells];
  for (const s of serials) out[s.i] = serialLabel(s.v);
  return out;
}

const FISCAL_YEAR = /^FY\s?((?:19|20)\d{2})\s?[-/]\s?(\d{2})$/i;
const QUARTER_CELL = /^(Q[1-4]|[1-4]Q|Total|Full[ _-]?Year|FY)$/i;

/**
 * A data sheet often heads its columns twice: the fiscal year on one row, the
 * quarter on the next, with the year written once per group of columns. This
 * pairs the two rows back together so each column carries a whole period.
 */
function readYearGroupHeader(previous: string[] | null, cells: string[]): string[] | null {
  if (!previous) return null;

  const quarters = cells.filter((c) => QUARTER_CELL.test(c)).length;
  if (quarters < 4 || quarters < cells.length - 1) return null;

  const years: string[] = [];
  for (const c of previous) {
    const m = c.match(FISCAL_YEAR);
    if (!m) continue;
    const label = `FY${m[1].slice(0, 2)}${m[2]}`;
    if (years.at(-1) !== label) years.push(label);
  }
  if (years.length < 2) return null;

  const out: string[] = [];
  let group = -1;
  for (const cell of cells) {
    if (/^(?:Q1|1Q)$/i.test(cell)) group += 1;
    const year = years[Math.max(0, group)];
    if (!year) {
      out.push("");
      continue;
    }
    if (/^(?:Total|Full[ _-]?Year|FY)$/i.test(cell)) {
      out.push(year);
      continue;
    }
    const q = cell.match(/^Q?([1-4])Q?$/i);
    out.push(q ? `Q${q[1]} ${year}` : "");
  }

  return out.some((c) => c !== "") ? out : null;
}

function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "-" || s === "NA" || s === "N/A") return null;
  const neg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[()]/g, "").replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function parseWorkbookMetrics(text: string): {
  metrics: IrMetric[];
  periods: string[];
} {
  const lines = text.split("\n");
  let header: string[] | null = null;
  let unit: IrUnit | null = null;
  let previous: string[] | null = null;
  const metrics: IrMetric[] = [];
  const allPeriods = new Set<string>();

  for (const line of lines) {
    const hint = readUnitHint(line);
    if (hint) unit = hint;

    const rawCells = line.split("|").map((c) => c.trim());
    const held = previous;
    previous = rawCells;
    if (rawCells.length < 2) continue;

    const paired = readYearGroupHeader(held, rawCells);
    if (paired) {
      header = paired;
      for (const c of paired) if (c) allPeriods.add(c);
      continue;
    }

    const yearHeader = readYearHeader(rawCells);
    if (yearHeader) {
      header = yearHeader;
      for (const c of yearHeader) if (/^(?:19|20)[0-9]{2}$/.test(c)) allPeriods.add(c);
      continue;
    }

    const serialHeader = readSerialHeader(rawCells);
    if (serialHeader) {
      header = serialHeader;
      for (const c of serialHeader) if (isPeriodCell(c)) allPeriods.add(c);
      continue;
    }

    const cells = rawCells;

    const periodCells = cells.filter(isPeriodCell).length;
    if (periodCells >= 2 && periodCells >= cells.length - 2) {
      header = cells;
      for (const c of cells) if (isPeriodCell(c)) allPeriods.add(c);
      continue;
    }

    if (!header) continue;

    const label = cells[0];
    if (!label || label.length < 2 || label.length > 90) continue;
    if (toNumber(label) !== null) continue;

    const offset = isPeriodCell(header[0]) || /^(?:19|20)[0-9]{2}$/.test(header[0]) ? 1 : 0;

    const values: IrMetric["values"] = [];
    for (let i = 1; i < cells.length; i++) {
      const period = header[i - offset];
      if (!period || !(isPeriodCell(period) || /^(?:19|20)[0-9]{2}$/.test(period))) continue;
      const v = toNumber(cells[i]);
      if (v === null) continue;
      values.push({ period, value: v });
    }

    if (values.length > 0) {
      const labelUnit = readUnitHint(label);
      metrics.push({
        label,
        values,
        unit: labelUnit ?? unit,
        unitFromLabel: labelUnit !== null,
      });
    }
  }

  return { metrics, periods: [...allPeriods] };
}

function sameUnit(a: IrUnit | null, b: IrUnit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.currency === b.currency && a.scale === b.scale;
}

export interface IrReadResult {
  doc: IrDocRef;
  structured: boolean;
  ok: boolean;
  reason: string | null;
  bytes: number;
  sheets: number;
  metrics: IrMetric[];
  periods: string[];
}

export async function readIrDocument(doc: IrDocRef): Promise<IrReadResult> {
  const empty = {
    doc,
    ok: false,
    structured: doc.kind === "workbook",
    bytes: 0,
    sheets: 0,
    metrics: [] as IrMetric[],
    periods: [] as string[],
  };

  try {
    const res = await cached(`ir:file:${doc.url}`, DOC_TTL_MS, async () => {
      const bytes = await fetchBuffer(doc.url, {
        headers: BROWSER_HEADERS,
        timeoutMs: 45_000,
        retries: 0,
        maxBytes: MAX_DOC_BYTES,
      });

      if (doc.kind === "workbook") {
        const { text, sheets } = xlsxText(bytes);
        const { metrics, periods } = parseWorkbookMetrics(text);
        return { size: bytes.byteLength, sheets, metrics, periods, structured: true };
      }

      const extracted = extractPdfText(bytes);
      const asGrid = extracted.lines
        .map((l) => l.replace(/\s{2,}/g, " | "))
        .join("\n");
      const { metrics, periods } = parseWorkbookMetrics(asGrid);
      const spoken = parseNarrativeMetrics(extracted.lines.join("\n"));
      const held = new Set(metrics.map((m) => m.label.toLowerCase()));
      const merged = [...metrics, ...spoken.filter((m) => !held.has(m.label.toLowerCase()))];
      const allPeriods = new Set(periods);
      for (const m of spoken) for (const v of m.values) allPeriods.add(v.period);
      return {
        size: bytes.byteLength,
        sheets: extracted.pageCount,
        metrics: merged,
        periods: [...allPeriods],
        structured: false,
      };
    });

    const v = res.value;
    return {
      doc,
      structured: v.structured,
      ok: v.metrics.length > 0,
      reason: v.metrics.length > 0 ? null : "No labelled metric rows could be read from this file.",
      bytes: v.size,
      sheets: v.sheets,
      metrics: v.metrics,
      periods: v.periods,
    };
  } catch (err) {
    const reason =
      err instanceof XlsxError || err instanceof PdfParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { ...empty, reason };
  }
}

export interface IrScrapeResult {
  symbol: string;
  name: string;
  indexUrl: string;
  discovered: number;
  workbooks: number;
  read: IrReadResult[];
  metrics: IrMetric[];
  periods: string[];
  provenance: Provenance;
}

export async function scrapeIr(symbol: string, limit = 3): Promise<IrScrapeResult | null> {
  const index = irIndexFor(symbol);
  if (!index) return null;

  const { indexUrl, docs } = await discoverIrDocuments(index);

  const candidates = docs.filter((d) => d.score > 0).slice(0, limit);

  const read: IrReadResult[] = [];
  for (const doc of candidates) {
    read.push(await readIrDocument(doc));
  }

  const byLabel = new Map<string, IrMetric>();
  const periods = new Set<string>();

  for (const r of read) {
    for (const m of r.metrics.map((x) => ({ ...x, structured: r.structured }))) {
      const key = m.label.toLowerCase().replace(/\s+/g, " ");
      const held = byLabel.get(key);
      if (!held) {
        byLabel.set(key, {
          label: m.label,
          values: [...m.values],
          unit: m.unit,
          unitFromLabel: m.unitFromLabel,
          structured: m.structured,
          derivedFrom: m.derivedFrom,
        });
      } else if (sameUnit(held.unit, m.unit)) {
        for (const v of m.values) {
          if (!held.values.some((x) => x.period === v.period)) held.values.push(v);
        }
      }
      for (const v of m.values) periods.add(v.period);
    }
  }

  const okCount = read.filter((r) => r.ok).length;

  return {
    symbol,
    name: index.name,
    indexUrl,
    discovered: docs.length,
    workbooks: docs.filter((d) => d.kind === "workbook").length,
    read,
    metrics: [...byLabel.values()],
    periods: [...periods],
    provenance: {
      kind: okCount > 0 ? "filing" : "unavailable",
      source: `${index.name} investor relations, published results files`,
      url: indexUrl,
      retrievedAt: nowIso(),
      note:
        okCount > 0
          ? `${docs.length} published files found, ${okCount} of ${read.length} downloaded and read.`
          : `${docs.length} files found on the index, none could be parsed into metric rows.`,
    },
  };
}

export function findMetric(
  metrics: IrMetric[],
  patterns: RegExp[],
): { label: string; values: Array<{ period: string; value: number }> } | null {
  for (const re of patterns) {
    const hit = metrics.find((m) => re.test(m.label));
    if (hit && hit.values.length > 0) return hit;
  }
  return null;
}
