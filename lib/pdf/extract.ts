/**
 * PDF text extraction, zero dependencies.
 *
 * Quarterly fact sheets from several filers use the standard security handler
 * at revision 6 (AES-256, /AESV3) with an empty user password, so streams must
 * be decrypted before they can be inflated.
 *
 *   /Encrypt -> file key (ISO 32000-2 alg 2.A/2.B) -> AES-256-CBC -> inflate
 *   -> keep streams carrying text operators -> parse Tj/TJ/'/" with the text
 *   matrix -> group runs into lines by page and Y
 *
 * Plain PDFs skip the first two steps. Flate is the only stream filter handled;
 * image codecs are dropped by the text-operator filter regardless.
 *
 * Limitation: reads WinAnsi/Standard encodings. ToUnicode CMaps for subset
 * fonts with custom encodings are not resolved. Callers check parse confidence
 * rather than trusting output blindly.
 */

import crypto from "node:crypto";
import zlib from "node:zlib";

export interface ExtractResult {
  text: string;
  lines: string[];
  pageCount: number;
  encrypted: boolean;
  streamsTotal: number;
  streamsDecoded: number;
}

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}

const EMPTY = Buffer.alloc(0);

/* ------------------------------------------------------------------ *
 * Encryption
 * ------------------------------------------------------------------ */

/**
 * ISO 32000-2 algorithm 2.B, the revision 6 hardened hash. Iterates AES-128-CBC
 * over a repeated block and rotates the digest between SHA-256/384/512 based on
 * the ciphertext, at least 64 rounds. The odd terminating condition is from the
 * spec verbatim: stop once at least 64 rounds have run and the final byte of the
 * last ciphertext is no greater than round - 32.
 */
function hash2B(password: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let K = crypto
    .createHash("sha256")
    .update(Buffer.concat([password, salt, udata]))
    .digest();

  for (let round = 0; ; ) {
    const block = Buffer.concat([password, K, udata]);
    const K1 = Buffer.concat(Array(64).fill(block));

    const cipher = crypto.createCipheriv(
      "aes-128-cbc",
      K.subarray(0, 16),
      K.subarray(16, 32),
    );
    cipher.setAutoPadding(false);
    const E = Buffer.concat([cipher.update(K1), cipher.final()]);

    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    const mod = sum % 3;
    const algo = mod === 0 ? "sha256" : mod === 1 ? "sha384" : "sha512";
    K = crypto.createHash(algo).update(E).digest();

    round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
    // Runaway guard. The spec's loop always terminates, but a corrupt file
    // should not spin a request handler forever.
    if (round > 512) break;
  }

  return K.subarray(0, 32);
}

/** Reads a PDF string object, either <hex> or (literal), into raw bytes. */
function readStringObject(src: string, key: string): Buffer | null {
  const re = new RegExp(
    `${key}\\s*(?:<([0-9A-Fa-f\\s]+)>|\\(((?:\\\\.|[^\\\\()])*)\\))`,
  );
  const m = src.match(re);
  if (!m) return null;

  if (m[1] !== undefined) {
    return Buffer.from(m[1].replace(/\s/g, ""), "hex");
  }

  const unescaped = (m[2] ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\([0-7]{1,3})/g, (_, o: string) =>
      String.fromCharCode(parseInt(o, 8)),
    )
    .replace(/\\(.)/g, "$1");

  return Buffer.from(unescaped, "latin1");
}

interface CryptInfo {
  fileKey: Buffer;
  revision: number;
}

function deriveFileKey(latin: string): CryptInfo | null {
  const at = latin.lastIndexOf("/Filter/Standard");
  const alt = at === -1 ? latin.lastIndexOf("/Filter /Standard") : at;
  if (alt === -1) return null;

  const region = latin.slice(Math.max(0, alt - 800), alt + 2000);

  const rMatch = region.match(/\/R\s+(\d+)/);
  const revision = rMatch ? Number(rMatch[1]) : 0;

  if (revision !== 5 && revision !== 6) {
    throw new PdfParseError(
      `Unsupported PDF encryption revision ${revision || "unknown"}. ` +
        `Only AES-256 revisions 5 and 6 are handled.`,
    );
  }

  const U = readStringObject(region, "/U");
  const UE = readStringObject(region, "/UE");
  if (!U || !UE || U.length < 48 || UE.length < 32) {
    throw new PdfParseError("Encryption dictionary is missing /U or /UE.");
  }

  const validationSalt = U.subarray(32, 40);
  const keySalt = U.subarray(40, 48);

  // Confirm the document opens with an empty user password. If a real
  // password were required we would stop here rather than emit garbage.
  const check =
    revision === 6
      ? hash2B(EMPTY, validationSalt, EMPTY)
      : crypto.createHash("sha256").update(Buffer.concat([EMPTY, validationSalt])).digest();

  if (!check.equals(U.subarray(0, 32))) {
    throw new PdfParseError(
      "Document requires a user password. Automated extraction stopped.",
    );
  }

  const intermediate =
    revision === 6
      ? hash2B(EMPTY, keySalt, EMPTY)
      : crypto.createHash("sha256").update(Buffer.concat([EMPTY, keySalt])).digest();

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    intermediate,
    Buffer.alloc(16),
  );
  decipher.setAutoPadding(false);
  const fileKey = Buffer.concat([
    decipher.update(UE.subarray(0, 32)),
    decipher.final(),
  ]);

  return { fileKey, revision };
}

function decryptStream(raw: Buffer, fileKey: Buffer): Buffer | null {
  // AES-CBC in PDF prefixes the 16-byte IV to the ciphertext.
  if (raw.length <= 16 || (raw.length - 16) % 16 !== 0) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      fileKey,
      raw.subarray(0, 16),
    );
    decipher.setAutoPadding(false);
    let out = Buffer.concat([
      decipher.update(raw.subarray(16)),
      decipher.final(),
    ]);
    const pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && pad <= out.length) {
      out = out.subarray(0, out.length - pad);
    }
    return out;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Content stream harvesting
 * ------------------------------------------------------------------ */

function inflate(data: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(data);
  } catch {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return null;
    }
  }
}

/**
 * A decoded stream is treated as page content only if it contains a text
 * object. This is what keeps embedded font programs, ICC profiles and image
 * data out of the extracted text, and it is far cheaper than walking the
 * page tree to resolve every /Contents reference.
 */
function looksLikeContent(s: string): boolean {
  if (s.length < 8) return false;
  if (!s.includes("BT")) return false;
  return s.includes("Tj") || s.includes("TJ") || s.includes("Tf");
}

/* ------------------------------------------------------------------ *
 * Text operator parsing
 * ------------------------------------------------------------------ */

interface Run {
  /** Index of the content stream this run came from, i.e. its page. */
  page: number;
  x: number;
  y: number;
  text: string;
}

function decodeLiteral(body: string): string {
  return body
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "")
    .replace(/\\f/g, "")
    .replace(/\\([0-7]{1,3})/g, (_, o: string) =>
      String.fromCharCode(parseInt(o, 8)),
    )
    .replace(/\\\n/g, "")
    .replace(/\\(.)/g, "$1");
}

function decodeHex(body: string): string {
  const clean = body.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  // Two-digit groups are single-byte encodings; four-digit groups appear in
  // Identity-H CID fonts. Treating pairs is correct for these documents.
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Walks a content stream tracking the text matrix so runs can be grouped back
 * into visual lines. Without the Y coordinate, a table in a slide deck
 * collapses into one undifferentiated string and every row label is lost.
 */
function parseContent(content: string, runs: Run[], page: number): void {
  // Tokenise only what is needed: strings, arrays, numbers and operators.
  const tokenRe =
    /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/<>[\]()]+|[A-Za-z'"*]+/g;

  let tx = 0;
  let ty = 0;
  let lineX = 0;
  let lineY = 0;
  let leading = 0;
  let pending: string[] = [];
  const stack: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(content)) !== null) {
    const tok = m[0];

    if (tok.startsWith("(")) {
      pending.push(decodeLiteral(tok.slice(1, -1)));
      stack.push("@str");
      continue;
    }
    if (tok.startsWith("<") && !tok.startsWith("<<")) {
      pending.push(decodeHex(tok.slice(1, -1)));
      stack.push("@str");
      continue;
    }
    if (tok === "[" || tok === "]") {
      stack.push(tok);
      continue;
    }
    if (/^-?\d*\.?\d+$/.test(tok)) {
      stack.push(tok);
      continue;
    }
    if (tok.startsWith("/")) {
      stack.push(tok);
      continue;
    }

    // Operator.
    switch (tok) {
      case "BT":
        tx = ty = lineX = lineY = 0;
        pending = [];
        break;

      case "Tm": {
        const nums = numericTail(stack, 6);
        if (nums) {
          lineX = tx = nums[4];
          lineY = ty = nums[5];
        }
        break;
      }

      case "Td": {
        const nums = numericTail(stack, 2);
        if (nums) {
          lineX = tx = lineX + nums[0];
          lineY = ty = lineY + nums[1];
        }
        break;
      }

      case "TD": {
        const nums = numericTail(stack, 2);
        if (nums) {
          leading = -nums[1];
          lineX = tx = lineX + nums[0];
          lineY = ty = lineY + nums[1];
        }
        break;
      }

      case "TL": {
        const nums = numericTail(stack, 1);
        if (nums) leading = nums[0];
        break;
      }

      case "T*":
        lineY = ty = lineY - leading;
        tx = lineX;
        break;

      case "Tj":
      case "TJ":
      case "'":
      case '"': {
        if (tok === "'" || tok === '"') {
          lineY = ty = lineY - leading;
          tx = lineX;
        }
        const text = pending.join("");
        if (text.trim().length > 0) {
          runs.push({ page, x: tx, y: ty, text });
        }
        pending = [];
        break;
      }

      default:
        // Any other operator ends the current string accumulation so that
        // strings belonging to non-text operators are not absorbed.
        if (tok !== "Tf" && tok !== "Tc" && tok !== "Tw" && tok !== "Tz") {
          pending = [];
        }
        break;
    }

    stack.length = 0;
  }
}

function numericTail(stack: string[], count: number): number[] | null {
  const nums: number[] = [];
  for (let i = stack.length - 1; i >= 0 && nums.length < count; i--) {
    const v = Number(stack[i]);
    if (Number.isFinite(v) && /^-?\d*\.?\d+$/.test(stack[i])) {
      nums.unshift(v);
    } else if (stack[i] !== "[" && stack[i] !== "]") {
      break;
    }
  }
  return nums.length === count ? nums : null;
}

/**
 * Groups runs into lines. Runs within Y_TOLERANCE of one another are the same
 * visual row; within a row they are ordered left to right and joined with the
 * gap widened to a double space when the horizontal jump is large, which keeps
 * table columns distinguishable downstream.
 */
function runsToLines(runs: Run[]): string[] {
  const Y_TOLERANCE = 3;
  // Page first. Y coordinates restart on every page, so grouping globally
  // would splice the disclaimer on page 2 into the P&L table on page 14.
  const sorted = [...runs].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );

  const lines: string[] = [];
  let bucket: Run[] = [];
  let bucketY: number | null = null;
  let bucketPage: number | null = null;

  const flush = () => {
    if (bucket.length === 0) return;
    bucket.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd: number | null = null;
    for (const r of bucket) {
      if (prevEnd !== null) {
        const gap = r.x - prevEnd;
        line += gap > 24 ? "   " : gap > 2 ? " " : "";
      }
      line += r.text;
      // Rough advance estimate. Precise widths would need the font metrics,
      // which is more machinery than the grouping heuristic warrants.
      prevEnd = r.x + r.text.length * 5;
    }
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed.trim().length > 0) lines.push(trimmed);
    bucket = [];
  };

  for (const r of sorted) {
    const sameRow =
      bucketY !== null &&
      bucketPage === r.page &&
      Math.abs(r.y - bucketY) <= Y_TOLERANCE;

    if (bucketY === null || sameRow) {
      bucket.push(r);
      if (bucketY === null) {
        bucketY = r.y;
        bucketPage = r.page;
      }
    } else {
      flush();
      bucket = [r];
      bucketY = r.y;
      bucketPage = r.page;
    }
  }
  flush();

  return lines;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function extractPdfText(input: Uint8Array): ExtractResult {
  const buf = Buffer.from(input);
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new PdfParseError("Not a PDF: missing %PDF- header.");
  }

  const latin = buf.toString("latin1");

  let crypt: CryptInfo | null = null;
  if (latin.includes("/Encrypt")) {
    crypt = deriveFileKey(latin);
  }

  const runs: Run[] = [];
  let streamsTotal = 0;
  let streamsDecoded = 0;

  let idx = 0;
  for (;;) {
    const kw = latin.indexOf("stream", idx);
    if (kw === -1) break;

    // Skip the tail of an "endstream" keyword.
    if (latin.startsWith("endstream", kw - 3)) {
      idx = kw + 6;
      continue;
    }

    let start = kw + 6;
    if (latin[start] === "\r") start++;
    if (latin[start] === "\n") start++;

    const stop = latin.indexOf("endstream", start);
    if (stop === -1) break;
    streamsTotal++;

    let end = stop;
    if (crypt) {
      // An EOL sits between the data and the keyword. AES-CBC output is always
      // a multiple of 16, so trim back until the length realigns.
      while (
        end > start &&
        (end - start) % 16 !== 0 &&
        (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)
      ) {
        end--;
      }
    } else {
      while (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) {
        end--;
      }
    }

    const raw = buf.subarray(start, end);
    const payload = crypt ? decryptStream(raw, crypt.fileKey) : raw;

    if (payload) {
      const flat = inflate(payload) ?? payload;
      const s = flat.toString("latin1");
      if (looksLikeContent(s)) {
        parseContent(s, runs, streamsDecoded);
        streamsDecoded++;
      }
    }

    idx = stop + 9;
  }

  const lines = runsToLines(runs);
  const pageCount = (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  return {
    text: lines.join("\n"),
    lines,
    pageCount,
    encrypted: crypt !== null,
    streamsTotal,
    streamsDecoded,
  };
}
