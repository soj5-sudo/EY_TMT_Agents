import { randomUUID } from "node:crypto";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import { xlsxText, XlsxError } from "@/lib/research/xlsx";
import type { IngestedDocument } from "@/lib/research/company";

const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_DOCS_PER_SESSION = 12;
const MAX_TOTAL_CHARS = 900_000;

export class DocumentError extends Error {}

const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "Revenue", re: /\brevenue[^.\n]{0,40}?([$₹€£]?\s?[\d,]+(?:\.\d+)?\s?(?:mn|m|bn|billion|million|crore|lakh|k)?)/gi },
  { label: "EBITDA", re: /\bebitda[^.\n]{0,40}?([$₹€£]?\s?[\d,]+(?:\.\d+)?\s?(?:mn|m|bn|billion|million|crore|%)?)/gi },
  { label: "Net income", re: /\bnet (?:income|profit)[^.\n]{0,40}?([$₹€£]?\s?[\d,]+(?:\.\d+)?\s?(?:mn|m|bn|billion|million|crore)?)/gi },
  { label: "Margin", re: /\b(?:gross|operating|net|ebitda) margin[^.\n]{0,30}?([\d.]+\s?%)/gi },
  { label: "Headcount", re: /\b(?:headcount|employees|associates)[^.\n]{0,30}?([\d,]{3,})/gi },
  { label: "Growth", re: /\b(?:growth|increase[ds]?|decline[ds]?)[^.\n]{0,30}?([-+]?[\d.]+\s?%)/gi },
  { label: "ARR", re: /\b(?:ARR|annual recurring revenue)[^.\n]{0,40}?([$₹€£]?\s?[\d,]+(?:\.\d+)?\s?(?:mn|m|bn)?)/gi },
  { label: "Churn", re: /\bchurn[^.\n]{0,30}?([\d.]+\s?%)/gi },
];

function extractFigures(body: string): IngestedDocument["extracted"] {
  const out: IngestedDocument["extracted"] = [];
  const seen = new Set<string>();

  for (const { label, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let perPattern = 0;

    while ((m = re.exec(body)) !== null && perPattern < 6) {
      const value = m[1].replace(/\s+/g, " ").trim();
      const key = `${label}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const from = Math.max(0, m.index - 60);
      const context = body
        .slice(from, Math.min(body.length, m.index + m[0].length + 60))
        .replace(/\s+/g, " ")
        .trim();

      out.push({ label, value, context });
      perPattern++;
    }
  }

  return out.slice(0, 40);
}

export async function ingest(file: File): Promise<IngestedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new DocumentError(
      `${file.name} is ${(file.size / 1_048_576).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1_048_576} MB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/[^\w\s.\-()]/g, "").slice(0, 120) || "document";

  let body: string;
  let pages: number | null = null;

  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (header === "%PDF-") {
    try {
      const parsed = extractPdfText(bytes);
      body = parsed.text;
      pages = parsed.pageCount;
    } catch (err) {
      throw new DocumentError(
        err instanceof PdfParseError
          ? `${name} could not be read: ${err.message}`
          : `${name} could not be parsed.`,
      );
    }
  } else if (isZip && /\.(xlsx|xlsm)$/i.test(name)) {
    try {
      const parsed = xlsxText(bytes);
      body = parsed.text;
      pages = parsed.sheets;
    } catch (err) {
      throw new DocumentError(
        err instanceof XlsxError
          ? `${name} could not be read: ${err.message}`
          : `${name} could not be parsed as a workbook.`,
      );
    }
  } else if (/\.(txt|csv|md|json)$/i.test(name)) {
    body = new TextDecoder("utf-8").decode(bytes);
  } else {
    throw new DocumentError(
      `${name} is not a supported format. Upload PDF, XLSX, CSV, TXT, MD or JSON.`,
    );
  }

  if (body.trim().length < 40) {
    throw new DocumentError(
      `${name} yielded no readable text. Scanned images without an embedded text layer cannot be read.`,
    );
  }

  const doc: IngestedDocument = {
    id: randomUUID(),
    name,
    bytes: file.size,
    pages,
    characters: body.length,
    extracted: extractFigures(body),
    addedAt: new Date().toISOString(),
  };

  return doc;
}

export function acceptDocuments(raw: unknown): IngestedDocument[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_DOCS_PER_SESSION)
    .filter((d): d is IngestedDocument => {
      if (!d || typeof d !== "object") return false;
      const doc = d as Record<string, unknown>;
      return (
        typeof doc.id === "string" &&
        typeof doc.name === "string" &&
        typeof doc.characters === "number" &&
        Array.isArray(doc.extracted)
      );
    })
    .map((d) => ({
      id: String(d.id).slice(0, 64),
      name: String(d.name).replace(/[^\w\s.\-()]/g, "").slice(0, 120),
      bytes: Number.isFinite(d.bytes) ? d.bytes : 0,
      pages: typeof d.pages === "number" ? d.pages : null,
      characters: Math.min(Number(d.characters) || 0, MAX_TOTAL_CHARS),
      extracted: (d.extracted ?? []).slice(0, 40).map((e) => ({
        label: String(e?.label ?? "").slice(0, 60),
        value: String(e?.value ?? "").slice(0, 60),
        context: String(e?.context ?? "").slice(0, 240),
      })),
      addedAt: typeof d.addedAt === "string" ? d.addedAt : new Date().toISOString(),
    }));
}
