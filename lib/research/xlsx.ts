import zlib from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const MAX_ROWS_PER_SHEET = 8000;
const MAX_TOTAL_CHARS = 900_000;

export class XlsxError extends Error {}

interface Entry {
  name: string;
  method: number;
  csize: number;
  local: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => {
      const code = Number(d);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&");
}

function entries(b: Buffer): Entry[] {
  let at = -1;
  const floor = Math.max(0, b.length - 22 - 65536);
  for (let i = b.length - 22; i >= floor; i--) {
    if (b.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new XlsxError("Not a spreadsheet container.");

  const count = b.readUInt16LE(at + 10);
  let off = b.readUInt32LE(at + 16);
  const out: Entry[] = [];

  for (let i = 0; i < count; i++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== CENTRAL) break;
    const method = b.readUInt16LE(off + 10);
    const csize = b.readUInt32LE(off + 20);
    const nlen = b.readUInt16LE(off + 28);
    const elen = b.readUInt16LE(off + 30);
    const clen = b.readUInt16LE(off + 32);
    const local = b.readUInt32LE(off + 42);
    out.push({
      name: b.toString("utf8", off + 46, off + 46 + nlen),
      method,
      csize,
      local,
    });
    off += 46 + nlen + elen + clen;
  }
  return out;
}

function read(b: Buffer, e: Entry): Buffer | null {
  if (e.local + 30 > b.length || b.readUInt32LE(e.local) !== LOCAL) return null;
  const nlen = b.readUInt16LE(e.local + 26);
  const elen = b.readUInt16LE(e.local + 28);
  const start = e.local + 30 + nlen + elen;
  const raw = b.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    try {
      return zlib.inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function xlsxText(input: Uint8Array): { text: string; sheets: number } {
  const b = Buffer.from(input);
  const all = entries(b);

  if (all.some((e) => e.name === "EncryptionInfo" || e.name === "encryption.xml")) {
    throw new XlsxError("The workbook is password protected and cannot be read.");
  }
  if (all.some((e) => e.name.startsWith("xl/") && e.method !== 0 && e.method !== 8)) {
    throw new XlsxError("The workbook uses an unsupported compression method.");
  }

  const shared: string[] = [];
  const ss = all.find((e) => e.name === "xl/sharedStrings.xml");
  if (ss) {
    const xml = read(b, ss)?.toString("utf8") ?? "";
    const si = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = si.exec(xml)) !== null) {
      const runs = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
      shared.push(decodeEntities(runs.join("")));
    }
  }

  const sheets = all
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, z) => a.name.localeCompare(z.name, "en", { numeric: true }));

  if (sheets.length === 0) {
    throw new XlsxError("No worksheets were found inside the workbook.");
  }

  const lines: string[] = [];
  let chars = 0;

  for (const sheet of sheets) {
    const xml = read(b, sheet)?.toString("utf8") ?? "";
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm: RegExpExecArray | null;
    let rows = 0;

    while ((rm = rowRe.exec(xml)) !== null && rows < MAX_ROWS_PER_SHEET) {
      const cells: string[] = [];
      const cellRe = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm: RegExpExecArray | null;

      while ((cm = cellRe.exec(rm[1])) !== null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1];

        let value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") {
          value = shared[Number(value)] ?? "";
        } else if (type === "inlineStr") {
          value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
            .map((x) => x[1])
            .join("");
        }
        value = decodeEntities(value).trim();
        if (value) cells.push(value);
      }

      if (cells.length > 0) {
        const line = cells.join(" | ");
        lines.push(line);
        chars += line.length + 1;
        if (chars > MAX_TOTAL_CHARS) break;
      }
      rows++;
    }
    if (chars > MAX_TOTAL_CHARS) break;
  }

  if (lines.length === 0) {
    throw new XlsxError("The workbook carried no readable cell values.");
  }

  return { text: lines.join("\n"), sheets: sheets.length };
}
