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
    if (round > 512) break;
  }

  return K.subarray(0, 32);
}

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

function looksLikeContent(s: string): boolean {
  if (s.length < 8) return false;
  if (!s.includes("BT")) return false;
  return s.includes("Tj") || s.includes("TJ") || s.includes("Tf");
}

interface StreamSlice {
  payload: Buffer | null;
  stop: number;
}

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

function readStream(
  buf: Buffer,
  latin: string,
  kw: number,
  crypt: CryptInfo | null,
): StreamSlice | null {
  let start = kw + 6;
  if (latin[start] === "\r") start++;
  if (latin[start] === "\n") start++;

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

interface FontMap {
  codes: Map<number, string>;
  codeBytes: number;
  guarded: boolean;
}

interface RawObject {
  dict: string;
  streamAt: number;
}

interface FontIndex {
  byStream: Map<number, Map<string, FontMap>>;
  merged: FontMap | null;
  streamOwner: Map<number, number>;
}

const EMPTY_INDEX: FontIndex = {
  byStream: new Map(),
  merged: null,
  streamOwner: new Map(),
};

const DICT_LIMIT = 64 * 1024;

const NAME_END = /[\s/<>[\]()]/;

function keyAt(src: string, key: string): number {
  for (let from = 0; ; ) {
    const i = src.indexOf("/" + key, from);
    if (i === -1) return -1;
    const after = src[i + key.length + 1];
    if (after === undefined || NAME_END.test(after)) return i + key.length + 1;
    from = i + 1;
  }
}

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

function refValue(src: string, key: string): number | null {
  const at = keyAt(src, key);
  if (at === -1) return null;
  const m = /^\s*(\d+)\s+\d+\s+R/.exec(src.slice(at, at + 40));
  return m ? Number(m[1]) : null;
}

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

function utf16beText(hex: string): string {
  if (hex.length === 0) return "";
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16));
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

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
      const head = base.slice(0, -1);
      const tail = base.charCodeAt(base.length - 1);
      for (let c = lo; c <= hi; c++) {
        codes.set(c, head + String.fromCharCode((tail + c - lo) & 0xffff));
      }
    }
  }

  return codes;
}

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
      if (objects.has(num)) continue;
      const next = i + 1 < count ? heads[2 * i + 3] : text.length - first;
      const to = Number.isFinite(next) ? first + next : text.length;
      objects.set(num, { dict: text.slice(first + at, to), streamAt: -1 });
    }
  }
}

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

interface Run {
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
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

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

function lastName(stack: string[]): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].startsWith("/")) return stack[i].slice(1);
  }
  return null;
}

function parseContent(
  content: string,
  runs: Run[],
  page: number,
  fonts: Map<string, FontMap> | null,
  fallback: FontMap | null,
): void {
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
        const active = font ?? (fonts === null ? fallback : null);
        const text = pending.map((p) => decodeWithFont(p, active)).join("");
        if (text.length > 0) {
          runs.push({ page, x: tx, y: ty, text });
        }
        pending = [];
        break;
      }

      default:
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

function runsToLines(runs: Run[]): string[] {
  const Y_TOLERANCE = 3;
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
        const separated = /\s$/.test(line) || /^\s/.test(r.text);
        line += separated && pad === " " ? "" : pad;
      }
      line += r.text;
      prevEnd = r.x + r.text.length * 5;
    }
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
  }

  const runs: Run[] = [];
  let streamsTotal = 0;
  let streamsDecoded = 0;

  let idx = 0;
  for (;;) {
    const kw = latin.indexOf("stream", idx);
    if (kw === -1) break;

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
