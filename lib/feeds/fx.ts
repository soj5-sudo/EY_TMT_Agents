/**
 * Foreign exchange.
 *
 * Two independent providers, both free and neither requiring a key. Both were
 * curl-tested before being wired in. Frankfurter is the primary because it
 * publishes ECB reference rates with an explicit date; open.er-api is the
 * fallback because it is a different operator, so a single provider outage
 * does not take the console's currency conversion with it.
 *
 * Note on frankfurter: the .app domain now 301s to .dev. The .dev host is used
 * directly so no redirect hop is needed.
 */

import { cached } from "@/lib/core/cache";
import { fetchJson } from "@/lib/core/fetcher";
import type { Envelope, FxRates, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const TTL_MS = 30 * 60 * 1000;
const CURRENCIES = ["INR", "EUR", "GBP", "AUD", "CAD", "JPY", "SGD", "ZAR"];

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface ErApiResponse {
  result: string;
  time_last_update_utc: string;
  base_code: string;
  rates: Record<string, number>;
}

async function fromFrankfurter(): Promise<{ rates: FxRates; prov: Provenance }> {
  const url = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CURRENCIES.join(",")}`;
  // No retry. When two independent providers are raced, retrying a slow one
  // only delays the answer the other already has.
  const json = await fetchJson<FrankfurterResponse>(url, {
    timeoutMs: 6000,
    retries: 0,
  });

  if (!json.rates || typeof json.rates.INR !== "number") {
    throw new Error("Frankfurter response did not carry an INR rate.");
  }

  return {
    rates: { base: "USD", date: json.date, rates: json.rates },
    prov: {
      kind: "live",
      source: "Frankfurter, European Central Bank reference rates",
      url: "https://api.frankfurter.dev/v1/latest",
      retrievedAt: nowIso(),
      sourceDatedAt: json.date,
    },
  };
}

async function fromErApi(): Promise<{ rates: FxRates; prov: Provenance }> {
  const json = await fetchJson<ErApiResponse>(
    "https://open.er-api.com/v6/latest/USD",
    { timeoutMs: 6000, retries: 0 },
  );

  if (json.result !== "success" || typeof json.rates?.INR !== "number") {
    throw new Error("open.er-api response did not carry an INR rate.");
  }

  const filtered: Record<string, number> = {};
  for (const c of CURRENCIES) {
    if (typeof json.rates[c] === "number") filtered[c] = json.rates[c];
  }

  const dated = new Date(json.time_last_update_utc);
  return {
    rates: {
      base: "USD",
      date: Number.isNaN(dated.getTime())
        ? nowIso().slice(0, 10)
        : dated.toISOString().slice(0, 10),
      rates: filtered,
    },
    prov: {
      kind: "live",
      source: "open.er-api.com, ExchangeRate-API open endpoint",
      url: "https://open.er-api.com/v6/latest/USD",
      retrievedAt: nowIso(),
      sourceDatedAt: json.time_last_update_utc,
    },
  };
}

export async function getFxRates(): Promise<Envelope<FxRates>> {
  const result = await cached("fx:usd", TTL_MS, async () => {
    // Raced rather than tried in sequence.
    //
    // Both providers are free, keyless and independent, so there is no reason
    // to prefer one enough to wait for it. Frankfurter was observed responding
    // in under a second on one day and taking 38 seconds on another; a
    // sequential fallback inherits that worst case in full, while a race
    // returns whichever answered and only fails if both do.
    //
    // Promise.any resolves on the first success and rejects only when every
    // input rejects, which is exactly the semantics wanted here.
    try {
      return await Promise.any([fromFrankfurter(), fromErApi()]);
    } catch (err) {
      // AggregateError carries each provider's failure. Surfacing both makes
      // the cause diagnosable instead of "rate unavailable".
      const reasons =
        err instanceof AggregateError
          ? err.errors
              .map((e) => (e instanceof Error ? e.message : String(e)))
              .join("; ")
          : String(err);
      throw new Error(`No exchange rate provider responded. ${reasons}`);
    }
  });

  const provenance: Provenance = result.fresh
    ? result.value.prov
    : {
        ...result.value.prov,
        kind: "cached",
        note: `Both providers were unreachable. Serving the rate retrieved at ${new Date(
          result.storedAt,
        ).toISOString()}.`,
      };

  return { data: result.value.rates, provenance };
}

/**
 * Converts an INR amount to USD.
 *
 * Used only for figures the console derives itself. Company-reported USD
 * figures are never recomputed from a spot rate, because the filing translates
 * at its own average rate for the period and mixing the two would produce a
 * number that reconciles to neither.
 */
export function inrToUsd(amountInr: number, usdInrRate: number): number {
  if (!Number.isFinite(usdInrRate) || usdInrRate <= 0) {
    throw new Error("A positive USD/INR rate is required.");
  }
  return amountInr / usdInrRate;
}
