const ALLOWED_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "feeds.finance.yahoo.com",
  "api.frankfurter.dev",
  "api.frankfurter.app",
  "open.er-api.com",
  "news.google.com",
  "www.sec.gov",
  "sec.gov",
  "data.sec.gov",
  "www.tcs.com",
  "tcs.com",
  "www.infosys.com",
  "infosys.com",
  "www.hcltech.com",
  "hcltech.com",
  "www.wipro.com",
  "wipro.com",
  "www.mphasis.com",
  "mphasis.com",
  "www.techmahindra.com",
  "techmahindra.com",
  "insights.techmahindra.com",
  "www.airtel.in",
  "airtel.in",
  "assets.airtel.in",
  "www.ril.com",
  "ril.com",
  "rilstaticasset.akamaized.net",
  "www.ltimindtree.com",
  "ltimindtree.com",
  "www.coforge.com",
  "coforge.com",
  "www.persistent.com",
  "persistent.com",
  "investors.capgemini.com",
  "www.capgemini.com",
  "capgemini.com",
  "investors.coforge.com",
  "www.experianplc.com",
  "experianplc.com",
  "www.alten.com",
  "alten.com",
  "www.zensar.com",
  "zensar.com",
  "assets.ctfassets.net",
  "www.birlasoft.com",
  "birlasoft.com",
  "www.mastek.com",
  "mastek.com",
  "www.datamatics.com",
  "datamatics.com",
  "www.rsystems.com",
  "rsystems.com",
  "media.rsystems.com",
  "www.happiestminds.com",
  "happiestminds.com",
  "www.saksoft.com",
  "saksoft.com",
  "www.kellton.com",
  "kellton.com",
  "cdn.kellton.com",
  "www.cgi.com",
  "cgi.com",
  "investors.globant.com",
  "d1io3yog0oux5.cloudfront.net",
  "s201.q4cdn.com",
  "ir.iqvia.com",
] as const;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class UpstreamError extends Error {
  readonly status: number | null;
  readonly host: string;

  constructor(message: string, host: string, status: number | null = null) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.host = host;
  }
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

function isPrivateLiteral(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT = 12_000;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

export async function safeFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamError(`Malformed URL: ${url}`, "unknown");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UpstreamError(
      `Blocked protocol ${parsed.protocol}`,
      parsed.hostname,
    );
  }

  if (isPrivateLiteral(parsed.hostname)) {
    throw new UpstreamError(
      `Blocked private address ${parsed.hostname}`,
      parsed.hostname,
    );
  }

  if (!hostAllowed(parsed.hostname)) {
    throw new UpstreamError(
      `Host not on allowlist: ${parsed.hostname}`,
      parsed.hostname,
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? 1;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(400 * attempt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(parsed.toString(), {
        method: opts.method ?? "GET",
        body: opts.body,
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          ...opts.headers,
        },
      });

      if (!res.ok) {
        if (res.status < 500 && res.status !== 429) {
          throw new UpstreamError(
            `${parsed.hostname} returned ${res.status}`,
            parsed.hostname,
            res.status,
          );
        }
        lastErr = new UpstreamError(
          `${parsed.hostname} returned ${res.status}`,
          parsed.hostname,
          res.status,
        );
        continue;
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        throw new UpstreamError(
          `${parsed.hostname} response exceeds ${maxBytes} bytes`,
          parsed.hostname,
          res.status,
        );
      }

      return res;
    } catch (err) {
      if (err instanceof UpstreamError && err.status !== null && err.status < 500) {
        throw err;
      }
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof UpstreamError) throw lastErr;
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new UpstreamError(
    `${parsed.hostname} unreachable: ${reason}`,
    parsed.hostname,
  );
}

export async function fetchJson<T>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const res = await safeFetch(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts.headers },
  });
  const text = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(
      `Response from ${new URL(url).hostname} was not valid JSON`,
      new URL(url).hostname,
    );
  }
}

export async function fetchText(
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const res = await safeFetch(url, opts);
  return readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES);
}

export async function fetchBuffer(
  url: string,
  opts: FetchOptions = {},
): Promise<Uint8Array> {
  const res = await safeFetch(url, opts);
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > max) {
    throw new UpstreamError(
      `Body exceeds ${max} bytes`,
      new URL(url).hostname,
      res.status,
    );
  }
  return buf;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamError(
        `Body exceeds ${maxBytes} bytes`,
        new URL(res.url || "https://unknown.invalid").hostname,
        res.status,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
