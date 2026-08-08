import { readFileSync, writeFileSync } from "node:fs";
import { fetchBuffer } from "@/lib/core/fetcher";
import { extractPdfText } from "@/lib/pdf/extract";

/**
 * Turns the earnings call reading run into lib/data/ir-calls.ts.
 *
 * Every transcript is downloaded here and every quote is searched for in it.
 * A quote that cannot be found in the document it cites is dropped, and a
 * company whose transcript will not download is dropped with it.
 *
 * Usage: node --experimental-strip-types scripts/write-calls.mts <journal.jsonl>
 */

interface Quote {
  speaker?: string;
  role?: string;
  text?: string;
  topic?: string;
}

interface Call {
  symbol: string;
  found: boolean;
  quarter?: string;
  callDate?: string;
  transcriptUrl?: string;
  transcriptTitle?: string;
  audioUrl?: string;
  quotes?: Quote[];
}

const NAMES: Record<string, string> = {
  "TCS.NS": "TCS",
  INFY: "Infosys",
  "HCLTECH.NS": "HCL Tech",
  WIT: "Wipro",
  "TECHM.NS": "Tech Mahindra",
  "LTIM.NS": "LTIMindtree",
  "COFORGE.NS": "Coforge",
  "MPHASIS.NS": "Mphasis",
  "PERSISTENT.NS": "Persistent Systems",
  "SONATSOFTW.NS": "Sonata Software",
  "HAPPSTMNDS.NS": "Happiest Minds",
  "ZENSARTECH.NS": "Zensar",
  "BSOFT.NS": "Birlasoft",
  "MASTEK.NS": "Mastek",
  "DATAMATICS.NS": "Datamatics",
  "RSYSTEMS.NS": "R Systems",
  "SAKSOFT.NS": "Saksoft",
  "KELLTONTEC.NS": "Kellton",
  "BHARTIARTL.NS": "Bharti Airtel",
  "RELIANCE.NS": "Reliance Industries",
};

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
};

const WORD_CAP = 45;

/** Whitespace, quote marks and dashes differ between a PDF and a reader. */
function flatten(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function documentText(url: string): Promise<string> {
  const bytes = await fetchBuffer(url, {
    headers: BROWSER,
    timeoutMs: 60_000,
    retries: 1,
    maxBytes: 40 * 1024 * 1024,
  });

  if (/\.pdf(\?|$)/i.test(url) || bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return extractPdfText(bytes).lines.join(" ");
  }

  return bytes
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

const journal = process.argv[2];
const calls = new Map<string, Call>();

for (const line of readFileSync(journal, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let entry: { type?: string; result?: unknown };
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type !== "result" || typeof entry.result !== "object" || entry.result === null) continue;
  const r = entry.result as Record<string, unknown>;
  if (typeof r.symbol === "string" && "found" in r) calls.set(r.symbol, r as unknown as Call);
}

const rows: Array<Record<string, unknown>> = [];
const skipped: string[] = [];

for (const [symbol, call] of calls) {
  const name = NAMES[symbol] ?? symbol;

  if (!call.found || !call.transcriptUrl) {
    skipped.push(`${name}: no transcript could be reached`);
    continue;
  }

  let text: string;
  try {
    text = flatten(await documentText(call.transcriptUrl));
  } catch (err) {
    skipped.push(
      `${name}: transcript would not download (${err instanceof Error ? err.message.slice(0, 60) : String(err)})`,
    );
    continue;
  }

  if (text.length < 2000) {
    skipped.push(`${name}: the transcript has no readable text`);
    continue;
  }

  const quotes = (call.quotes ?? [])
    .map((q) => ({
      speaker: String(q.speaker ?? "").trim(),
      role: String(q.role ?? "").trim(),
      text: String(q.text ?? "").trim(),
      topic: String(q.topic ?? "").trim(),
    }))
    .filter((q) => q.speaker && q.text.split(/\s+/).length <= WORD_CAP)
    .filter((q) => text.includes(flatten(q.text)))
    .slice(0, 3);

  const attempted = (call.quotes ?? []).length;

  if (quotes.length === 0) {
    skipped.push(`${name}: none of its ${attempted} quotes were found in the transcript`);
    continue;
  }

  rows.push({
    symbol,
    name,
    quarter: String(call.quarter ?? "").trim() || "Latest call",
    callDate: String(call.callDate ?? "").trim(),
    transcriptUrl: call.transcriptUrl,
    transcriptTitle: String(call.transcriptTitle ?? "Earnings call transcript"),
    audioUrl: String(call.audioUrl ?? ""),
    quotes,
    verification: "found in the transcript",
  });

  console.log(`  ${name.padEnd(20)} ${quotes.length} of ${attempted} quotes found in the transcript`);
}

rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));

const taken = new Date().toISOString();

const banner = `/**
 * The latest earnings call each company published on its own investor site.
 *
 * Management commentary comes from the call itself, not from a summary of it.
 * Every quote below was searched for in the transcript at the URL on the row
 * and found there; anything that could not be found was dropped.
 *
 * Refresh with: node --experimental-strip-types scripts/write-calls.mts
 */

export interface CallQuote {
  speaker: string;
  role: string;
  text: string;
  topic: string;
}

export interface EarningsCall {
  symbol: string;
  name: string;
  /** The quarter the call covered, in the company's own words. */
  quarter: string;
  callDate: string;
  transcriptUrl: string;
  transcriptTitle: string;
  audioUrl: string;
  quotes: CallQuote[];
  verification: string;
}

export const IR_CALLS_TAKEN = ${JSON.stringify(taken)};

export const IR_CALLS: EarningsCall[] = `;

const footer = `

const INDEX = new Map<string, EarningsCall>();
for (const call of IR_CALLS) {
  INDEX.set(call.symbol, call);
  INDEX.set(call.name.toLowerCase(), call);
}

export function callFor(nameOrSymbol: string): EarningsCall | null {
  const k = nameOrSymbol.trim();
  return INDEX.get(k) ?? INDEX.get(k.toLowerCase()) ?? null;
}
`;

writeFileSync("lib/data/ir-calls.ts", `${banner}${JSON.stringify(rows, null, 1)};\n${footer}`);

console.log(
  `\nwrote lib/data/ir-calls.ts: ${rows.length} calls, ` +
    `${rows.reduce((s, r) => s + (r.quotes as unknown[]).length, 0)} quotes`,
);
for (const s of skipped) console.log(`  skipped ${s}`);
