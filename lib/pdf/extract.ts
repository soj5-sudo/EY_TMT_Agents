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
 * Investor decks embed subset fonts whose glyphs are renumbered in order of
 * first use, so a character code in the content stream is not a character. The
 * indirect objects are indexed once up front, including those packed into
 * object streams, and each font's /ToUnicode CMap is read so those codes can be
 * translated back. Codes outside a font's CMap, and fonts that carry no CMap at
 * all, pass through untouched: WinAnsi text was already correct.
 *
 * Callers check parse confidence rather than trusting output blindly.
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

interface StreamSlice {
  /** Decrypted bytes, still compressed. Null when decryption failed. */
  payload: Buffer | null;
  /** Offset of the closing "endstream" keyword. */
  stop: number;
}

/**
 * The stream's declared /Length, when the dictionary states it directly rather
 * than through a reference. Only the current object's dictionary is searched,
 * so a neighbouring object's length cannot be picked up by mistake.
 */
function declaredLength(latin: string, kw: number): number | null {
  let head = latin.slice(Math.max(0, kw - 2048), kw);
  const obj = head.lastIndexOf("obj");
  if (obj !== -1) head = head.slice(obj);

  const re = /\/Length\s+(\d+)(?!\s+\d+\s+R)/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) last = m;
  return last ? Number(last[1]) : null;
}

/**
 * Reads the payload of the stream whose "stream" keyword sits at `kw`.
 * Returns null if the file ends without a closing keyword.
 */
function readStream(
  buf: Buffer,
  latin: string,
  kw: number,
  crypt: CryptInfo | null,
): StreamSlice | null {
  let start = kw + 6;
  if (latin[start] === "\r") start++;
  if (latin[start] === "\n") start++;

  // A stated length is exact, and exactness matters: compressed data ends in a
  // carriage return often enough, and trimming back from the keyword eats it,
  // leaving a truncated deflate stream that inflates to nothing.
  const declared = declaredLength(latin, kw);
  if (declared !== null && start + declared <= latin.length) {
    const at = start + declared;
    const gap = /^[\r\n \t]{0,4}endstream/.exec(latin.slice(at, at + 14));
    if (gap) {
      const raw = buf.subarray(start, at);
      return {
        payload: crypt ? decryptStream(raw, crypt.fileKey) : raw,
        stop: at + gap[0].length - 9,
      };
    }
  }

  const stop = latin.indexOf("endstream", start);
  if (stop === -1) return null;

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
  return { payload: crypt ? decryptStream(raw, crypt.fileKey) : raw, stop };
}

/* ------------------------------------------------------------------ *
 * Objects, fonts and ToUnicode CMaps
 * ------------------------------------------------------------------ */

/** One font's character codes, and how many bytes each code occupies. */
interface FontMap {
  codes: Map<number, string>;
  /** 2 for composite (Type0) fonts, whose strings pack two bytes per code. */
  codeBytes: number;
  /** Merged maps translate only codes that could not already be text. */
  guarded: boolean;
}

interface RawObject {
  /** Dictionary text, cut before any stream payload. */
  dict: string;
  /** Offset of the "stream" keyword, or -1 when the object has no payload. */
  streamAt: number;
}

interface FontIndex {
  /** Font maps keyed by the object number of the stream that uses them. */
  byStream: Map<number, Map<string, FontMap>>;
  /** Every single-byte map merged, for streams whose fonts cannot be found. */
  merged: FontMap | null;
  /** Object number owning the stream that begins at a given offset. */
  streamOwner: Map<number, number>;
}

const EMPTY_INDEX: FontIndex = {
  byStream: new Map(),
  merged: null,
  streamOwner: new Map(),
};

/** A page dictionary can carry a large /Annots array; nothing needs more. */
const DICT_LIMIT = 64 * 1024;

const NAME_END = /[\s/<>[\]()]/;

/** Offset just past "/key" where the dictionary names exactly that key. */
function keyAt(src: string, key: string): number {
  for (let from = 0; ; ) {
    const i = src.indexOf("/" + key, from);
    if (i === -1) return -1;
    const after = src[i + key.length + 1];
    // Without this test /Font would also match inside /FontDescriptor.
    if (after === undefined || NAME_END.test(after)) return i + key.length + 1;
    from = i + 1;
  }
}

/** The balanced << >> value of a key, or null when it is absent or a reference. */
function inlineDict(src: string, key: string): string | null {
  let i = keyAt(src, key);
  if (i === -1) return null;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== "<" || src[i + 1] !== "<") return null;

  const open = i;
  let depth = 0;
  while (i < src.length) {
    if (src[i] === "<" && src[i + 1] === "<") {
      depth++;
      i += 2;
    } else if (src[i] === ">" && src[i + 1] === ">") {
      depth--;
      i += 2;
      if (depth === 0) return src.slice(open + 2, i - 2);
    } else if (src[i] === "(") {
      // Literal strings can hold unbalanced angle brackets, so step over them.
      i++;
      for (let nest = 1; i < src.length && nest > 0; ) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "(") (nest++, i++);
        else if (src[i] === ")") (nest--, i++);
        else i++;
      }
    } else {
      i++;
    }
  }
  return null;
}

/** Object number of an indirect reference held under a key. */
function refValue(src: string, key: string): number | null {
  const at = keyAt(src, key);
  if (at === -1) return null;
  const m = /^\s*(\d+)\s+\d+\s+R/.exec(src.slice(at, at + 40));
  return m ? Number(m[1]) : null;
}

/** Object numbers behind a key holding either one reference or an array. */
function refList(src: string, key: string): number[] {
  const at = keyAt(src, key);
  if (at === -1) return [];
  const tail = src.slice(at, at + 4096);
  const single = /^\s*(\d+)\s+\d+\s+R/.exec(tail);
  if (single) return [Number(single[1])];
  const array = /^\s*\[([^\]]*)\]/.exec(tail);
  if (!array) return [];
  return [...array[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

/** Decodes a CMap destination, which is UTF-16BE and may be a ligature. */
function utf16beText(hex: string): string {
  if (hex.length === 0) return "";
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16));
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

/**
 * Reads the bfchar and bfrange sections of a ToUnicode CMap.
 *
 * Codes are stored as numbers rather than by their source byte width, so a map
 * written as <41> and one written as <0041> index identically; the width only
 * decides how many bytes a lookup consumes from the content stream.
 */
function parseCMap(text: string): Map<number, string> {
  const codes = new Map<number, string>();

  const charRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    charRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = charRe.exec(block[1])) !== null) {
      const dst = utf16beText(m[2]);
      if (dst.length > 0) codes.set(parseInt(m[1], 16), dst);
    }
  }

  const rangeRe =
    /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g;
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    rangeRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rangeRe.exec(block[1])) !== null) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (!Number.isFinite(lo) || hi < lo || hi - lo > 0xffff) continue;

      if (m[4] !== undefined) {
        const items = [...m[4].matchAll(/<([0-9A-Fa-f]*)>/g)];
        for (let i = 0; i < items.length && lo + i <= hi; i++) {
          const dst = utf16beText(items[i][1]);
          if (dst.length > 0) codes.set(lo + i, dst);
        }
        continue;
      }

      const base = utf16beText(m[3] ?? "");
      if (base.length === 0) continue;
      // A range increments the last UTF-16 unit of its destination, which is
      // how a contiguous alphabet is written as a single line.
      const head = base.slice(0, -1);
      const tail = base.charCodeAt(base.length - 1);
      for (let c = lo; c <= hi; c++) {
        codes.set(c, head + String.fromCharCode((tail + c - lo) & 0xffff));
      }
    }
  }

  return codes;
}

/**
 * Indexes every indirect object by number.
 *
 * Scanning for "N 0 obj" rather than reading the cross-reference table costs
 * nothing in accuracy here and survives the broken xref offsets that several
 * publishers ship. Binary payloads are stepped over so that byte sequences
 * inside an image cannot register as objects.
 */
function indexObjects(
  latin: string,
  streamOwner: Map<number, number>,
): Map<number, RawObject> {
  const objects = new Map<number, RawObject>();
  const header = /(\d+)\s+\d+\s+obj\b/g;

  let m: RegExpExecArray | null;
  while ((m = header.exec(latin)) !== null) {
    const num = Number(m[1]);
    const from = m.index + m[0].length;

    const endobj = latin.indexOf("endobj", from);
    let streamAt = latin.indexOf("stream", from);
    if (streamAt === -1 || (endobj !== -1 && endobj < streamAt)) streamAt = -1;

    const cut = streamAt === -1 ? (endobj === -1 ? latin.length : endobj) : streamAt;
    objects.set(num, {
      dict: latin.slice(from, Math.min(cut, from + DICT_LIMIT)),
      streamAt,
    });

    if (streamAt !== -1) {
      streamOwner.set(streamAt, num);
      const close = latin.indexOf("endstream", streamAt);
      if (close > header.lastIndex) header.lastIndex = close;
    }
  }

  return objects;
}

/**
 * Unpacks the dictionaries held inside object streams.
 *
 * Modern producers put font and page dictionaries there, so without this step
 * a document can appear to have no fonts at all. Object streams cannot contain
 * streams, so a ToUnicode CMap is always a top-level object.
 */
function expandObjectStreams(
  objects: Map<number, RawObject>,
  buf: Buffer,
  latin: string,
  crypt: CryptInfo | null,
): void {
  for (const obj of [...objects.values()]) {
    if (obj.streamAt === -1 || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;

    const slice = readStream(buf, latin, obj.streamAt, crypt);
    const flat = slice?.payload ? inflate(slice.payload) : null;
    if (!flat) continue;

    const count = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(first)) continue;

    const text = flat.toString("latin1");
    const heads = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const num = heads[2 * i];
      const at = heads[2 * i + 1];
      if (!Number.isFinite(num) || !Number.isFinite(at)) continue;
      // A top-level definition is the newer one and keeps precedence.
      if (objects.has(num)) continue;
      const next = i + 1 < count ? heads[2 * i + 3] : text.length - first;
      const to = Number.isFinite(next) ? first + next : text.length;
      objects.set(num, { dict: text.slice(first + at, to), streamAt: -1 });
    }
  }
}

/**
 * Resolves every font resource a content stream can name to its ToUnicode map.
 *
 * Resource names are only unique within one page, and subset fonts on the same
 * page routinely assign different letters to the same code, so the resolution
 * has to be per stream rather than document wide.
 */
function buildFontIndex(
  buf: Buffer,
  latin: string,
  crypt: CryptInfo | null,
): FontIndex {
  const streamOwner = new Map<number, number>();
  const objects = indexObjects(latin, streamOwner);
  expandObjectStreams(objects, buf, latin, crypt);

  const maps = new Map<number, FontMap | null>();

  const fontMapFor = (num: number): FontMap | null => {
    const known = maps.get(num);
    if (known !== undefined) return known;
    maps.set(num, null);

    const font = objects.get(num);
    if (!font || !/\/Type\s*\/Font/.test(font.dict)) return null;

    const ref = refValue(font.dict, "ToUnicode");
    const cmap = ref === null ? null : objects.get(ref);
    if (!cmap || cmap.streamAt === -1) return null;

    const slice = readStream(buf, latin, cmap.streamAt, crypt);
    if (!slice?.payload) return null;
    const flat = inflate(slice.payload) ?? slice.payload;

    const codes = parseCMap(flat.toString("latin1"));
    if (codes.size === 0) return null;

    // Simple fonts address one byte per code by definition; only a composite
    // font packs two, which for these documents always means Identity-H.
    const map: FontMap = {
      codes,
      codeBytes: /\/Subtype\s*\/Type0/.test(font.dict) ? 2 : 1,
      guarded: false,
    };
    maps.set(num, map);
    return map;
  };

  for (const [num, obj] of objects) {
    if (/\/Type\s*\/Font/.test(obj.dict)) fontMapFor(num);
  }

  /** Resources of an object, following the page tree when a page omits them. */
  const resourcesOf = (num: number): string | null => {
    let at: number | null = num;
    for (let hops = 0; at !== null && hops < 8; hops++) {
      const obj: RawObject | undefined = objects.get(at);
      if (!obj) return null;
      const inline = inlineDict(obj.dict, "Resources");
      if (inline !== null) return inline;
      const ref = refValue(obj.dict, "Resources");
      if (ref !== null) return objects.get(ref)?.dict ?? null;
      at = refValue(obj.dict, "Parent");
    }
    return null;
  };

  const fontsOf = (resources: string): Map<string, FontMap> | null => {
    let entries = inlineDict(resources, "Font");
    if (entries === null) {
      const ref = refValue(resources, "Font");
      entries = ref === null ? null : (objects.get(ref)?.dict ?? null);
    }
    if (entries === null) return null;

    const named = new Map<string, FontMap>();
    for (const m of entries.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const map = fontMapFor(Number(m[2]));
      if (map) named.set(m[1], map);
    }
    return named.size > 0 ? named : null;
  };

  const byStream = new Map<number, Map<string, FontMap>>();
  for (const [num, obj] of objects) {
    const isPage = /\/Type\s*\/Page(?!s)/.test(obj.dict);
    // Form XObjects carry their own resources and are drawn as their own stream.
    const isForm = obj.streamAt !== -1 && /\/Subtype\s*\/Form/.test(obj.dict);
    if (!isPage && !isForm) continue;

    const resources = resourcesOf(num);
    const fonts = resources === null ? null : fontsOf(resources);
    if (!fonts) continue;

    if (isForm) byStream.set(num, fonts);
    for (const contents of refList(obj.dict, "Contents")) {
      byStream.set(contents, fonts);
    }
  }

  // Last resort for a stream whose page could not be identified. Subset fonts
  // in one document rarely disagree, and restricting the merge to codes that
  // are not already printable leaves working WinAnsi text untouched.
  let merged: FontMap | null = null;
  for (const map of maps.values()) {
    if (!map || map.codeBytes !== 1) continue;
    if (!merged) merged = { codes: new Map(), codeBytes: 1, guarded: true };
    for (const [code, text] of map.codes) {
      if (!merged.codes.has(code)) merged.codes.set(code, text);
    }
  }

  return { byStream, merged, streamOwner };
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
 * Translates one string operand through the font in force.
 *
 * Anything the font does not describe is emitted as the raw byte it already
 * was, so a document whose encodings need no translation reads identically
 * whether or not a CMap was found.
 */
function decodeWithFont(bytes: string, font: FontMap | null): string {
  if (!font) return bytes;

  let out = "";
  if (font.codeBytes === 2) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1);
      out += font.codes.get(code) ?? bytes.slice(i, i + 2);
    }
    if (bytes.length % 2 === 1) out += bytes[bytes.length - 1];
    return out;
  }

  for (let i = 0; i < bytes.length; i++) {
    const code = bytes.charCodeAt(i);
    if (font.guarded && code >= 0x20 && code <= 0x7e) {
      out += bytes[i];
      continue;
    }
    out += font.codes.get(code) ?? bytes[i];
  }
  return out;
}

/** The last name operand on the stack, which is what Tf and Do take. */
function lastName(stack: string[]): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].startsWith("/")) return stack[i].slice(1);
  }
  return null;
}

/**
 * Walks a content stream tracking the text matrix so runs can be grouped back
 * into visual lines. Without the Y coordinate, a table in a slide deck
 * collapses into one undifferentiated string and every row label is lost.
 *
 * `fonts` holds the maps this stream's resources name. When it is null the
 * stream could not be traced back to a page and `fallback` stands in.
 */
function parseContent(
  content: string,
  runs: Run[],
  page: number,
  fonts: Map<string, FontMap> | null,
  fallback: FontMap | null,
): void {
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

  let font: FontMap | null = null;
  const fontStack: Array<FontMap | null> = [];

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

      case "Tf": {
        const name = lastName(stack);
        font = name === null ? null : (fonts?.get(name) ?? null);
        break;
      }

      // The font belongs to the graphics state, so a save and restore pair
      // around a heading returns the body font without naming it again.
      case "q":
        fontStack.push(font);
        pending = [];
        break;

      case "Q":
        if (fontStack.length > 0) font = fontStack.pop() ?? null;
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
        // Each operand is translated on its own: the elements of a TJ array
        // are separately byte aligned, and a two-byte font would drift if the
        // array were joined first.
        const active = font ?? (fonts === null ? fallback : null);
        const text = pending.map((p) => decodeWithFont(p, active)).join("");
        // A run holding nothing but a space is still a word boundary. These
        // decks set one for every gap, in its own text object.
        if (text.length > 0) {
          runs.push({ page, x: tx, y: ty, text });
        }
        pending = [];
        break;
      }

      default:
        // Any other operator ends the current string accumulation so that
        // strings belonging to non-text operators are not absorbed.
        if (tok !== "Tc" && tok !== "Tw" && tok !== "Tz") {
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
        const pad = gap > 24 ? "   " : gap > 2 ? " " : "";
        // A drawn space already separates the two runs, so a word gap must not
        // be added on top of it: two spaces read as a column break downstream.
        const separated = /\s$/.test(line) || /^\s/.test(r.text);
        line += separated && pad === " " ? "" : pad;
      }
      line += r.text;
      // Rough advance estimate. Precise widths would need the font metrics,
      // which is more machinery than the grouping heuristic warrants.
      prevEnd = r.x + r.text.length * 5;
    }
    // Both ends: a decoded space run can now open a row, and a leading blank
    // would read as an empty leading column to anything splitting on runs of
    // whitespace.
    const trimmed = line.trim();
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

  let index = EMPTY_INDEX;
  try {
    index = buildFontIndex(buf, latin, crypt);
  } catch {
    // A font table that cannot be read costs the reader nothing: extraction
    // continues on raw character codes, which is what it did before.
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

    const slice = readStream(buf, latin, kw, crypt);
    if (!slice) break;
    streamsTotal++;

    if (slice.payload) {
      const flat = inflate(slice.payload) ?? slice.payload;
      const s = flat.toString("latin1");
      if (looksLikeContent(s)) {
        const owner = index.streamOwner.get(kw);
        const fonts =
          owner === undefined ? null : (index.byStream.get(owner) ?? null);
        parseContent(s, runs, streamsDecoded, fonts, index.merged);
        streamsDecoded++;
      }
    }

    idx = slice.stop + 9;
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
