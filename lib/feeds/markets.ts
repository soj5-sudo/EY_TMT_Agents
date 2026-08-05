/**
 * Equity quotes and price history from the Yahoo chart endpoint.
 * query2 first, query1 as fallback: the limits are applied per host.
 */

import { cached } from "@/lib/core/cache";
import {
  MARKET_SNAPSHOT_QUOTES,
  MARKET_SNAPSHOT_SERIES,
  MARKET_SNAPSHOT_TAKEN,
} from "@/lib/data/market-snapshot";
import { fetchJson } from "@/lib/core/fetcher";
import type {
  Envelope,
  Provenance,
  Quote,
  SeriesPoint,
} from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

// Eight minutes rather than one. This is a diligence console, not a trading
// terminal: a quote a few minutes old changes no conclusion drawn here, and the
// free Yahoo endpoint rate limits hard enough on burst that a short TTL costs
// far more in blanked panels than it buys in freshness.
const QUOTE_TTL_MS = 8 * 60 * 1000;
const SERIES_TTL_MS = 60 * 60 * 1000;

/**
 * Last known good quote per symbol, never expired.
 *
 * Yahoo applies an IP-level rate limit that can persist for minutes. During
 * that window a stale figure labelled with its retrieval time beats an empty
 * table. Symbols that have never resolved have no entry and render "Not set".
 */
const lastGood = new Map<string, { quote: Quote; at: number }>();

interface YahooChart {
  chart: {
    result:
      | Array<{
          meta: {
            currency?: string;
            symbol?: string;
            shortName?: string;
            longName?: string;
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            fiftyTwoWeekHigh?: number;
            fiftyTwoWeekLow?: number;
            marketState?: string;
            fullExchangeName?: string;
            regularMarketTime?: number;
          };
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ close?: Array<number | null> }>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>
      | null;
    error: { code?: string; description?: string } | null;
  };
}

const HOSTS = [
  "https://query2.finance.yahoo.com",
  "https://query1.finance.yahoo.com",
];

async function chart(
  symbol: string,
  range: string,
  interval: string,
): Promise<YahooChart> {
  let lastErr: unknown = null;
  for (const host of HOSTS) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?range=${range}&interval=${interval}`;
      const json = await fetchJson<YahooChart>(url, {
        timeoutMs: 9000,
        retries: 0,
      });
      if (json.chart?.error) {
        throw new Error(
          json.chart.error.description ?? `Yahoo rejected ${symbol}`,
        );
      }
      if (!json.chart?.result?.length) {
        throw new Error(`Yahoo returned no result for ${symbol}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Unable to load ${symbol}`);
}

function toQuote(json: YahooChart, fallbackSymbol: string): Quote {
  const r = json.chart.result![0];
  const m = r.meta;
  const price = m.regularMarketPrice ?? 0;
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;

  return {
    symbol: m.symbol ?? fallbackSymbol,
    name: m.longName ?? m.shortName ?? fallbackSymbol,
    currency: m.currency ?? "USD",
    price,
    previousClose: prev,
    changePct:
      prev && prev > 0 ? Number((((price - prev) / prev) * 100).toFixed(2)) : null,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    marketState: m.marketState ?? null,
    exchange: m.fullExchangeName ?? null,
    asOf: m.regularMarketTime ?? null,
  };
}

function yahooProvenance(symbol: string, fresh: boolean, storedAt: number): Provenance {
  return {
    kind: fresh ? "live" : "cached",
    source: "Yahoo Finance chart endpoint",
    url: `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`,
    retrievedAt: new Date(storedAt).toISOString(),
    note: fresh
      ? undefined
      : "Upstream was unreachable on this request. Showing the last successful retrieval.",
  };
}

export async function getQuote(symbol: string): Promise<Envelope<Quote>> {
  try {
    const res = await cached(`quote:${symbol}`, QUOTE_TTL_MS, async () =>
      toQuote(await chart(symbol, "1d", "1d"), symbol),
    );
    if (res.fresh) {
      lastGood.set(symbol, { quote: res.value, at: Date.now() });
    }
    return {
      data: res.value,
      provenance: yahooProvenance(symbol, res.fresh, res.storedAt),
    };
  } catch (err) {
    const held = lastGood.get(symbol);
    if (held) {
      const ageMinutes = Math.round((Date.now() - held.at) / 60000);
      return {
        data: held.quote,
        provenance: {
          kind: "cached",
          source: "Yahoo Finance chart endpoint",
          url: `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`,
          retrievedAt: new Date(held.at).toISOString(),
          note:
            `Upstream refused this request (${err instanceof Error ? err.message : String(err)}). ` +
            `Showing the last successful retrieval, ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} old.`,
        },
      };
    }

    // Last tier: the committed snapshot, taken where the endpoint answered.
    // Labelled baseline and dated, never presented as a live price.
    const snap = MARKET_SNAPSHOT_QUOTES[symbol];
    if (snap && MARKET_SNAPSHOT_TAKEN) {
      return {
        data: snap,
        provenance: {
          kind: "baseline",
          source: "Yahoo Finance chart endpoint, committed snapshot",
          retrievedAt: MARKET_SNAPSHOT_TAKEN,
          note:
            "The endpoint rate-limits this network. Showing the snapshot taken " +
            `${MARKET_SNAPSHOT_TAKEN.slice(0, 10)}; the price is as of that date, not today.`,
        },
      };
    }
    throw err;
  }
}

export interface QuoteResult {
  symbol: string;
  quote: Quote | null;
  error: string | null;
}

/**
 * Bounded concurrency with a fixed gap between launches.
 * Yahoo rate limits on burst; serial with a half-second gap stays inside it.
 * Cost is paid once per cache period, not per page view.
 */
export async function throttledMap<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = 1,
  spacingMs = 500,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;

  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      if (index >= concurrency) {
        await new Promise((r) => setTimeout(r, spacingMs));
      }
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return results;
}

/**
 * Fetches many symbols. A symbol that fails yields a null quote with its error
 * text rather than collapsing the whole batch, so one delisted ticker cannot
 * blank the peer table.
 */
export async function getQuotes(symbols: string[]): Promise<{
  results: QuoteResult[];
  provenance: Provenance;
}> {
  const settled = await throttledMap(symbols, (s) => getQuote(s));

  const results: QuoteResult[] = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return { symbol: symbols[i], quote: outcome.value.data, error: null };
    }
    const reason = outcome.reason;
    return {
      symbol: symbols[i],
      quote: null,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  });

  const ok = results.filter((r) => r.quote !== null).length;

  return {
    results,
    provenance: {
      kind: ok === 0 ? "unavailable" : ok < symbols.length ? "cached" : "live",
      source: "Yahoo Finance chart endpoint",
      url: "https://query2.finance.yahoo.com",
      retrievedAt: nowIso(),
      note:
        ok === symbols.length
          ? undefined
          : `${ok} of ${symbols.length} symbols resolved on this request.`,
    },
  };
}

export async function getSeries(
  symbol: string,
  range = "1y",
  interval = "1d",
): Promise<Envelope<SeriesPoint[]>> {
  try {
    return await getSeriesLive(symbol, range, interval);
  } catch (err) {
    const snap = MARKET_SNAPSHOT_SERIES[symbol];
    if (snap && snap.length > 0 && MARKET_SNAPSHOT_TAKEN) {
      return {
        data: snap,
        provenance: {
          kind: "baseline",
          source: "Yahoo Finance chart endpoint, committed snapshot",
          retrievedAt: MARKET_SNAPSHOT_TAKEN,
          note: `History as of ${MARKET_SNAPSHOT_TAKEN.slice(0, 10)}. The endpoint rate-limits this network.`,
        },
      };
    }
    throw err;
  }
}

async function getSeriesLive(
  symbol: string,
  range: string,
  interval: string,
): Promise<Envelope<SeriesPoint[]>> {
  const res = await cached(
    `series:${symbol}:${range}:${interval}`,
    SERIES_TTL_MS,
    async () => {
      const json = await chart(symbol, range, interval);
      const r = json.chart.result![0];
      const ts = r.timestamp ?? [];
      const closes =
        r.indicators?.adjclose?.[0]?.adjclose ??
        r.indicators?.quote?.[0]?.close ??
        [];

      const points: SeriesPoint[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c === "number" && Number.isFinite(c)) {
          points.push({ t: ts[i], close: c });
        }
      }
      if (points.length === 0) {
        throw new Error(`No usable closes returned for ${symbol}`);
      }
      return points;
    },
  );

  return {
    data: res.value,
    provenance: yahooProvenance(symbol, res.fresh, res.storedAt),
  };
}

/**
 * Rebases a series to 100 at its first point so instruments priced in
 * different currencies can share one axis. Without this, plotting TCS at
 * ₹2,460 against Accenture at $166 makes the second line a flat floor.
 */
export function rebase(points: SeriesPoint[]): Array<{ t: number; v: number }> {
  if (points.length === 0) return [];
  const base = points[0].close;
  if (!base) return [];
  return points.map((p) => ({ t: p.t, v: (p.close / base) * 100 }));
}
