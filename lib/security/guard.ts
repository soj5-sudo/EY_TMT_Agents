const WINDOW_MS = 60_000;

export const LIMITS = {
  page: 120,
  api: 60,
  agent: 12,
  chat: 20,
  research: 10,
  upload: 8,
} as const;

export type LimitKind = keyof typeof LIMITS;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  if (buckets.size < 2000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

export function rateLimit(clientId: string, kind: LimitKind): RateResult {
  const now = Date.now();
  sweep(now);

  const key = `${kind}:${clientId}`;
  const limit = LIMITS[kind];
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetInSeconds: WINDOW_MS / 1000,
    };
  }

  existing.count++;
  const remaining = Math.max(0, limit - existing.count);
  return {
    allowed: existing.count <= limit,
    limit,
    remaining,
    resetInSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

export function clientId(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  const ip = forwarded || real || "local";
  const ua = headers.get("user-agent") ?? "none";

  let h = 2166136261;
  const s = `${ip}|${ua}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${ip}-${(h >>> 0).toString(36)}`;
}

const AUTOMATION_SIGNATURES = [
  "firecrawl",
  "scrapy",
  "scrapinghub",
  "apify",
  "diffbot",
  "puppeteer",
  "playwright",
  "headlesschrome",
  "phantomjs",
  "selenium",
  "httrack",
  "wget",
  "curl",
  "python-requests",
  "python-urllib",
  "aiohttp",
  "httpx",
  "go-http-client",
  "java/",
  "okhttp",
  "axios",
  "node-fetch",
  "got (",
  "libwww-perl",
  "mechanize",
  "colly",
  "guzzle",
  "restsharp",
  "bot",
  "spider",
  "crawler",
  "gptbot",
  "ccbot",
  "perplexitybot",
  "bytespider",
  "amazonbot",
  "dataforseo",
  "semrush",
  "ahrefs",
  "mj12bot",
  "dotbot",
  "petalbot",
  "serpstat",
  "screaming frog",
];

export interface ClientAssessment {
  automated: boolean;
  reason: string | null;
  signature: string | null;
}

export function assessClient(headers: Headers): ClientAssessment {
  const ua = (headers.get("user-agent") ?? "").toLowerCase();

  if (!ua) {
    return {
      automated: true,
      reason: "No user-agent header was sent.",
      signature: null,
    };
  }

  for (const sig of AUTOMATION_SIGNATURES) {
    if (ua.includes(sig)) {
      return {
        automated: true,
        reason: `User-agent declares an automated client.`,
        signature: sig,
      };
    }
  }

  const accept = headers.get("accept");
  const lang = headers.get("accept-language");
  if (!accept && !lang) {
    return {
      automated: true,
      reason: "Request carried neither Accept nor Accept-Language.",
      signature: null,
    };
  }

  return { automated: false, reason: null, signature: null };
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return false;
    return true;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function rateLimitHeaders(result: RateResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetInSeconds),
  };
}
