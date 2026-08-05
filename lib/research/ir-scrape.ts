/**
 * Investor relations document scraper.
 *
 * Companies outside the SEC register publish the same substance the register
 * would carry, on their own site, as a spreadsheet or a results release. TCS
 * publishes a quarterly data sheet as a workbook with nine sheets of key
 * financial and operating metrics; Bharti publishes a quarterly workbook;
 * HCLTech and Tech Mahindra publish results releases as documents. None of it
 * needs a data room and none of it needs a key.
 *
 * This crawls the investor relations index, finds the published files, ranks
 * them by how recent and how relevant the filename is, downloads the best
 * candidates and reads them. A workbook is read structurally: the period header
 * row is located first, then every labelled row beneath it is mapped onto those
 * periods, so a figure always arrives attached to the quarter it belongs to.
 *
 * Only what the document states is recorded. Nothing is interpolated across
 * periods and nothing is converted between currencies, because a metric whose
 * basis has been quietly changed is worse than a metric that is absent.
 */

import { cached } from "@/lib/core/cache";
import { fetchBuffer, fetchText } from "@/lib/core/fetcher";
import { xlsxText, XlsxError } from "@/lib/research/xlsx";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import { nowIso, type Provenance } from "@/lib/core/types";

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const DOC_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DOC_BYTES = 30 * 1024 * 1024;

/** These hosts refuse a bare client, so the crawler presents a normal one. */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/* ------------------------------------------------------------------ *
 * Where the documents live
 * ------------------------------------------------------------------ */

export interface IrIndex {
  symbol: string;
  name: string;
  /** Index pages to crawl, in order. The first that yields files wins. */
  urls: string[];
  /** Base for resolving relative links, when it differs from the index host. */
  base?: string;
}

/**
 * Verified index pages. Each was confirmed to serve the company's published
 * results files to an ordinary browser request.
 */
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
      "https://www.techmahindra.com/en-in/investors/",
      "https://www.techmahindra.com/investors/",
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
      "https://www.ltimindtree.com/investors/financial-results/",
      "https://www.ltimindtree.com/investors/",
    ],
  },
  {
    symbol: "INFY.NS",
    name: "Infosys Limited",
    urls: [
      "https://www.infosys.com/investors/reports-filings/quarterly-results.html",
      "https://www.infosys.com/investors.html",
    ],
  },
  {
    symbol: "WIPRO.NS",
    name: "Wipro Limited",
    urls: [
      "https://www.wipro.com/investors/quarterly-results/",
      "https://www.wipro.com/investors/",
    ],
  },
];

export function irIndexFor(symbol: string): IrIndex | null {
  return IR_INDEXES.find((i) => i.symbol === symbol) ?? null;
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

export interface IrDocRef {
  url: string;
  filename: string;
  kind: "workbook" | "document";
  /** Fiscal period read out of the filename, when it names one. */
  period: string | null;
  /** Higher is a better candidate to read. */
  score: number;
}

const FILE_LINK = /href\s*=\s*["']([^"'\s>]+\.(?:xlsx|xls|pdf))(?:\?[^"']*)?["']/gi;

/** Fiscal period as it appears in a published filename. */
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

/**
 * Ranks a candidate by what its filename says it is.
 *
 * A workbook of key metrics is worth far more than a governance policy, and
 * both live on the same index page. Scoring on the filename is what keeps the
 * crawler from downloading thirty megabytes of annual report to find a number
 * that is on the first sheet of the data sheet.
 */
function score(filename: string, kind: IrDocRef["kind"], period: string | null): number {
  const n = filename.toLowerCase();
  let s = 0;

  if (kind === "workbook") s += 60;
  if (/data[ _-]?sheet|fact[ _-]?sheet|factsheet/.test(n)) s += 50;
  if (/key[ _-]?(financial|metric)|metrics/.test(n)) s += 40;
  if (/quarterly|results|earnings|financial/.test(n)) s += 25;
  if (/press[ _-]?release|investor[ _-]?release/.test(n)) s += 20;
  if (/annual[ _-]?report/.test(n)) s += 10;
  if (period) s += 30;

  // Recency, read from the fiscal year in the name.
  const y = n.match(/(?:fy|20)(\d{2})\b/);
  if (y) s += Math.min(30, Number(y[1]));

  // Things that are published on the same page but are not results.
  if (/policy|code[ _-]?of|charter|notice|intimation|disclosure|transcript|ppt|presentation|esg|sustainab|agm|postal|scrutin|newspaper|advertis/.test(n))
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

/** Crawls the index pages and returns the candidate files, best first. */
export async function discoverIrDocuments(index: IrIndex): Promise<{
  indexUrl: string;
  docs: IrDocRef[];
}> {
  const res = await cached(`ir:index:${index.symbol}`, INDEX_TTL_MS, async () => {
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

      const seen = new Set<string>();
      const docs: IrDocRef[] = [];

      for (const m of html.matchAll(FILE_LINK)) {
        const abs = absolute(m[1], url, index.base);
        if (!abs || seen.has(abs)) continue;
        seen.add(abs);

        const filename = decodeURIComponent(abs.split("/").pop() ?? "").slice(0, 160);
        const kind: IrDocRef["kind"] = /\.xlsx?$/i.test(filename) ? "workbook" : "document";
        const period = readPeriod(filename);
        docs.push({ url: abs, filename, kind, period, score: score(filename, kind, period) });
      }

      if (docs.length > 0) {
        docs.sort((a, b) => b.score - a.score);
        return { indexUrl: url, docs: docs.slice(0, 60) };
      }
    }
    return { indexUrl: index.urls[0], docs: [] as IrDocRef[] };
  });

  return res.value;
}

/* ------------------------------------------------------------------ *
 * Workbook reading
 * ------------------------------------------------------------------ */

export interface IrUnit {
  /** ISO code the figures are stated in, when the sheet says. */
  currency: string | null;
  /** Multiplier from the stated scale to units. Millions give 1e6. */
  scale: number;
  /** Whether the scale was read from the sheet or is the default of one. */
  scaleStated: boolean;
  /** The line the hint was read from, kept so the reading can be audited. */
  source: string;
}

export interface IrMetric {
  label: string;
  /** Values by the period column they sit under. */
  values: Array<{ period: string; value: number }>;
  /** Currency and scale in force where the row was read, when stated. */
  unit: IrUnit | null;
  /**
   * Whether the row's own label declares its units, as in
   * "Reported Revenue ($M)". A spreadsheet states units once in a caption that
   * governs the table beneath it; a results release laid out as prose has no
   * such structure, so a caption found earlier in the text may belong to a
   * different table entirely. A self describing label is trustworthy in both.
   */
  unitFromLabel: boolean;
  /** Set when the row came from a spreadsheet rather than from prose. */
  structured?: boolean;
}

/**
 * Currency and scale as a published sheet declares them.
 *
 * A results workbook states its units once, in a caption above the table:
 * "Consolidated Income Statement as per IFRS - USD Mn", or "Amount in Rs Mn,
 * except ratios". Every figure below that caption is in those units. Reading
 * the caption is the difference between 7,421 meaning seven billion dollars
 * and meaning seven thousand rupees, and there is no way to infer it from the
 * number itself.
 */
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

/** A cell that names a reporting period rather than carrying a value. */
const PERIOD_CELL =
  /^(?:[1-4]Q[ ]?(?:FY)?[0-9]{2,4}|Q[1-4][ _-]?(?:FY)?[ ]?[0-9]{2,4}|FY[ ]?[0-9]{2,4}|H[12][ ]?(?:FY)?[0-9]{2,4}|(?:19|20)[0-9]{2}[-/][0-9]{2}|[A-Z][a-z]{2}[-' ][0-9]{2,4})$/;

function isPeriodCell(s: string): boolean {
  return PERIOD_CELL.test(s.trim());
}

/**
 * A header written as plain calendar years.
 *
 * Bare four digit numbers cannot be accepted as periods on sight: a row of
 * figures in the nineteen hundreds reads exactly the same, and treating it as
 * a header attributes every row beneath it to invented periods. A run of them
 * is only a header when the values step by one year, which figures do not.
 */
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

/* --- Date-serial headers ------------------------------------------- *
 *
 * A spreadsheet that formats its period header as a date stores it as a serial
 * day count, so the header arrives as a row of five-digit integers. Bharti's
 * quarterly workbook does exactly this and its header reads 46112, 46022,
 * 45930, and so on.
 *
 * Detecting these by range alone would misread a row of figures that happens
 * to fall in the same range. What distinguishes a date header is the spacing:
 * consecutive period ends are a month, a quarter or a year apart, and revenue
 * figures are not. So the run has to be both in range and evenly spaced before
 * it is accepted.
 */

const SERIAL_MIN = 36_526; // 2000-01-01
const SERIAL_MAX = 51_136; // 2040-01-01

function serialToDate(serial: number): Date {
  // The serial epoch is 1899-12-30, which absorbs the 1900 leap-year quirk.
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function serialLabel(serial: number): string {
  const d = serialToDate(serial);
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

/** Returns the row rewritten with date serials as period labels, or null. */
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

/** Parses a number as published, tolerating separators, percents and brackets. */
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

/**
 * Reads labelled metric rows out of a flattened workbook.
 *
 * The reader upstream joins each row's cells with a pipe. A published data
 * sheet lays out one header row of period labels followed by labelled rows of
 * figures, so the parser tracks the most recent header and maps each row's
 * values onto it by column. A row read without a header in scope is dropped,
 * because a figure with no period attached cannot be used for anything.
 */
export function parseWorkbookMetrics(text: string): {
  metrics: IrMetric[];
  periods: string[];
} {
  const lines = text.split("\n");
  let header: string[] | null = null;
  let unit: IrUnit | null = null;
  const metrics: IrMetric[] = [];
  const allPeriods = new Set<string>();

  for (const line of lines) {
    const hint = readUnitHint(line);
    if (hint) unit = hint;

    const rawCells = line.split("|").map((c) => c.trim());
    if (rawCells.length < 2) continue;

    // A header written as formatted dates arrives as serials, so it is
    // converted before the row is classified.
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

    // A header row is one whose cells are mostly period labels.
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

    // A header row that begins with a period rather than a label is one column
    // narrower than the data rows beneath it, because the data rows carry a
    // label in the first column and the header does not. Without this the whole
    // sheet is read one quarter out of step, which is worse than not reading it
    // at all: every figure is attributed to the wrong period and still looks
    // entirely plausible.
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

/** Two rows can be combined only when they are stated the same way. */
function sameUnit(a: IrUnit | null, b: IrUnit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.currency === b.currency && a.scale === b.scale;
}

export interface IrReadResult {
  doc: IrDocRef;
  /** True when the figures came from a spreadsheet rather than from prose. */
  structured: boolean;
  ok: boolean;
  reason: string | null;
  bytes: number;
  sheets: number;
  metrics: IrMetric[];
  periods: string[];
}

/** Downloads one published file and reads what it states. */
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
      // A results release is laid out as text rather than as a grid, so the
      // same column mapping is applied to whitespace-separated lines.
      const asGrid = extracted.lines
        .map((l) => l.replace(/\s{2,}/g, " | "))
        .join("\n");
      const { metrics, periods } = parseWorkbookMetrics(asGrid);
      return { size: bytes.byteLength, sheets: extracted.pageCount, metrics, periods, structured: false };
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

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

export interface IrScrapeResult {
  symbol: string;
  name: string;
  indexUrl: string;
  /** Every candidate found on the index, whether or not it was read. */
  discovered: number;
  workbooks: number;
  /** Files actually downloaded and parsed. */
  read: IrReadResult[];
  metrics: IrMetric[];
  periods: string[];
  provenance: Provenance;
}

/**
 * Crawls, downloads and reads a company's published results files.
 *
 * At most `limit` files are downloaded, best-ranked first, and they are taken
 * one at a time. These are a publisher's own servers, and a burst of parallel
 * downloads is both impolite and the fastest way to be blocked.
 */
export async function scrapeIr(symbol: string, limit = 3): Promise<IrScrapeResult | null> {
  const index = irIndexFor(symbol);
  if (!index) return null;

  const { indexUrl, docs } = await discoverIrDocuments(index);

  // A negative score means the filename says it is a policy, a notice or a
  // meeting paper. Reading three of those and reporting nothing is worse than
  // reporting that the index carried no results files.
  const candidates = docs.filter((d) => d.score > 0).slice(0, limit);

  const read: IrReadResult[] = [];
  for (const doc of candidates) {
    read.push(await readIrDocument(doc));
  }

  // Merge across files, keeping the first statement of any label and period.
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
        });
      } else if (sameUnit(held.unit, m.unit)) {
        // Only extend a series from a file stated in the same units. A
        // publisher's archive often restates an old year in a different
        // currency and scale under an identical row label, and appending it
        // blind produces a series that appears to collapse by an order of
        // magnitude between two adjacent periods.
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

/* ------------------------------------------------------------------ *
 * Metric lookup
 * ------------------------------------------------------------------ */

/** Finds a metric by any of a set of label patterns, most recent value first. */
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
