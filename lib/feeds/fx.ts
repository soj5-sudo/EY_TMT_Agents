import { cached } from "@/lib/core/cache";
import { fetchJson } from "@/lib/core/fetcher";
import type { Envelope, FxRates, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const USD = "USD";

const TTL_MS = 6 * 60 * 60 * 1000;

const HISTORICAL_TTL_MS = 24 * 60 * 60 * 1000;

export const FX_SUPPORTED_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

const SUPPORTED = new Set<string>(FX_SUPPORTED_CURRENCIES);

const MIN_RATES = 8;

export interface FxSnapshot {
  base: string;
  rates: Record<string, number>;
  asOf: string;
}

export interface FxConversion {
  amount: number;
  currency: string;
  usd: number;
  rate: number;
  rateDate: string | null;
  basis: string;
}

export interface FxConvertedSeries {
  currency: string;
  rate: number;
  rateDate: string | null;
  values: Array<number | null>;
  basis: string;
}

export interface FxTable {
  base: string;
  asOf: string;
  rates: Record<string, number>;
  provenance: Provenance;
  supports(currency: string): boolean;
  rateFor(currency: string): number | null;
  toUsd(amount: number, currency: string): number | null;
  convert(amount: number, currency: string): FxConversion | null;
  convertSeries(amounts: number[], currency: string): FxConvertedSeries | null;
}

const BASELINE_TAKEN = "2026-08-05T13:21:54.000Z";

const BASELINE: FxSnapshot = {
  base: USD,
  asOf: "2026-08-04",
  rates: {
    AUD: 1.4222, BRL: 5.0806, CAD: 1.4061, CHF: 0.80929, CNY: 6.7535,
    CZK: 21.016, DKK: 6.4919, EUR: 0.86843, GBP: 0.74372, HKD: 7.8433,
    HUF: 314.63, IDR: 17987, ILS: 3.0265, INR: 95.38, ISK: 123.32,
    JPY: 157.41, KRW: 1427.11, MXN: 17.2881, MYR: 4.0925, NOK: 9.5462,
    NZD: 1.6993, PHP: 61.001, PLN: 3.7397, RON: 4.5601, SEK: 9.5462,
    SGD: 1.2824, THB: 33.335, TRY: 47.556, USD: 1, ZAR: 16.4408,
  },
};

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

interface Resolved {
  snapshot: FxSnapshot;
  provenance: Provenance;
}

function normalizeCode(currency: string): string {
  return currency.trim().toUpperCase();
}

function normalizeTable(
  base: string,
  asOf: string,
  raw: Record<string, number>,
): FxSnapshot {
  const rates: Record<string, number> = {};
  for (const code of FX_SUPPORTED_CURRENCIES) {
    const value = raw[code];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates[code] = value;
    }
  }
  if (SUPPORTED.has(base)) rates[base] = 1;
  return { base, rates, asOf };
}

async function fromFrankfurter(base: string, date?: string): Promise<Resolved> {
  const path = date ?? "latest";
  const url = `https://api.frankfurter.dev/v1/${path}?base=${encodeURIComponent(base)}`;
  const json = await fetchJson<FrankfurterResponse>(url, {
    timeoutMs: 6000,
    retries: 0,
  });

  if (!json.rates || typeof json.date !== "string") {
    throw new Error("Frankfurter returned no dated rate table.");
  }

  const snapshot = normalizeTable(base, json.date, json.rates);
  if (Object.keys(snapshot.rates).length < MIN_RATES) {
    throw new Error("Frankfurter returned too few usable rates to trust.");
  }

  return {
    snapshot,
    provenance: {
      kind: "live",
      source: "Frankfurter, European Central Bank reference rates",
      url,
      retrievedAt: nowIso(),
      sourceDatedAt: json.date,
    },
  };
}

async function fromErApi(base: string): Promise<Resolved> {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const json = await fetchJson<ErApiResponse>(url, {
    timeoutMs: 6000,
    retries: 0,
  });

  if (json.result !== "success" || !json.rates) {
    throw new Error("open.er-api did not report a successful rate table.");
  }

  const dated = new Date(json.time_last_update_utc);
  const asOf = Number.isNaN(dated.getTime())
    ? nowIso().slice(0, 10)
    : dated.toISOString().slice(0, 10);

  const snapshot = normalizeTable(base, asOf, json.rates);
  if (Object.keys(snapshot.rates).length < MIN_RATES) {
    throw new Error("open.er-api returned too few usable rates to trust.");
  }

  return {
    snapshot,
    provenance: {
      kind: "live",
      source: "open.er-api.com, ExchangeRate-API open endpoint",
      url,
      retrievedAt: nowIso(),
      sourceDatedAt: json.time_last_update_utc,
    },
  };
}

function rebase(snapshot: FxSnapshot, base: string): FxSnapshot | null {
  if (snapshot.base === base) return snapshot;
  const divisor = snapshot.rates[base];
  if (typeof divisor !== "number" || divisor <= 0) return null;

  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(snapshot.rates)) {
    rates[code] = value / divisor;
  }
  return { base, rates, asOf: snapshot.asOf };
}

function baselineFor(base: string, reason: string): Resolved | null {
  const snapshot = rebase(BASELINE, base);
  if (!snapshot) return null;

  const restated =
    base === USD
      ? ""
      : ` The snapshot is published against USD and was restated to ${base} by division.`;

  return {
    snapshot,
    provenance: {
      kind: "baseline",
      source:
        "Frankfurter, European Central Bank reference rates, committed snapshot",
      retrievedAt: BASELINE_TAKEN,
      sourceDatedAt: BASELINE.asOf,
      note:
        `No exchange rate provider responded (${reason}). Showing the fixing of ` +
        `${BASELINE.asOf}, which is not today's rate.${restated}`,
    },
  };
}

function unavailable(
  base: string,
  reason: string,
  source = "Frankfurter and open.er-api",
): Resolved {
  return {
    snapshot: { base, rates: {}, asOf: nowIso().slice(0, 10) },
    provenance: {
      kind: "unavailable",
      source,
      retrievedAt: nowIso(),
      note: reason,
    },
  };
}

function aggregateReason(err: unknown): string {
  if (err instanceof AggregateError) {
    return err.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

async function resolveLatest(base: string): Promise<Resolved> {
  let fetchedNow = false;

  try {
    const result = await cached(`fx:rates:${base}`, TTL_MS, async () => {
      try {
        const won = await Promise.any([fromFrankfurter(base), fromErApi(base)]);
        fetchedNow = true;
        return won;
      } catch (err) {
        throw new Error(aggregateReason(err));
      }
    });

    if (fetchedNow) return result.value;

    const storedIso = new Date(result.storedAt).toISOString();
    return {
      snapshot: result.value.snapshot,
      provenance: {
        ...result.value.provenance,
        kind: "cached",
        retrievedAt: storedIso,
        note: result.fresh
          ? `Retrieved ${storedIso} and held for six hours; the fixing itself is dated ${result.value.snapshot.asOf}.`
          : `Both providers were unreachable on this request. Serving the rate retrieved at ${storedIso}.`,
      },
    };
  } catch (err) {
    const reason = aggregateReason(err);
    return (
      baselineFor(base, reason) ??
      unavailable(base, `No exchange rate provider responded. ${reason}`)
    );
  }
}

async function resolveOn(base: string, date: string): Promise<Resolved> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return unavailable(
      base,
      `"${date}" is not an ISO calendar date.`,
      "Frankfurter, European Central Bank reference rates",
    );
  }

  let fetchedNow = false;

  try {
    const result = await cached(
      `fx:rates:${base}@${date}`,
      HISTORICAL_TTL_MS,
      async () => {
        const won = await fromFrankfurter(base, date);
        fetchedNow = true;
        return won;
      },
    );

    if (fetchedNow) return result.value;

    return {
      snapshot: result.value.snapshot,
      provenance: {
        ...result.value.provenance,
        kind: "cached",
        retrievedAt: new Date(result.storedAt).toISOString(),
        note: `Historical fixing of ${result.value.snapshot.asOf}, held since it cannot change.`,
      },
    };
  } catch (err) {
    return unavailable(
      base,
      `No fixing could be retrieved for ${date}. ${aggregateReason(err)}`,
      "Frankfurter, European Central Bank reference rates",
    );
  }
}

export async function getRates(base: string = USD): Promise<Envelope<FxSnapshot>> {
  const resolved = await resolveLatest(normalizeCode(base));
  return { data: resolved.snapshot, provenance: resolved.provenance };
}

export async function getRatesOn(
  date: string,
  base: string = USD,
): Promise<Envelope<FxSnapshot>> {
  const resolved = await resolveOn(normalizeCode(base), date);
  return { data: resolved.snapshot, provenance: resolved.provenance };
}

function identityConversion(amount: number): FxConversion {
  return {
    amount,
    currency: USD,
    usd: amount,
    rate: 1,
    rateDate: null,
    basis: "Reported in US dollars. No conversion applied.",
  };
}

function basisLine(currency: string, rate: number, asOf: string): string {
  return `Converted at USD/${currency} ${rate}, the rate of ${asOf}.`;
}

function makeTable(snapshot: FxSnapshot, provenance: Provenance): FxTable {
  const rateFor = (currency: string): number | null => {
    const code = normalizeCode(currency);
    const rate = snapshot.rates[code];
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? rate
      : null;
  };

  const convert = (amount: number, currency: string): FxConversion | null => {
    if (!Number.isFinite(amount)) return null;
    const code = normalizeCode(currency);
    if (code === USD) return identityConversion(amount);

    const rate = rateFor(code);
    if (rate === null) return null;

    return {
      amount,
      currency: code,
      usd: amount / rate,
      rate,
      rateDate: snapshot.asOf,
      basis: basisLine(code, rate, snapshot.asOf),
    };
  };

  return {
    base: snapshot.base,
    asOf: snapshot.asOf,
    rates: snapshot.rates,
    provenance,
    supports: (currency) => normalizeCode(currency) === USD || rateFor(currency) !== null,
    rateFor,
    toUsd: (amount, currency) => convert(amount, currency)?.usd ?? null,
    convert,
    convertSeries: (amounts, currency) => {
      const code = normalizeCode(currency);
      const rate = code === USD ? 1 : rateFor(code);
      if (rate === null) return null;

      return {
        currency: code,
        rate,
        rateDate: code === USD ? null : snapshot.asOf,
        values: amounts.map((n) => (Number.isFinite(n) ? n / rate : null)),
        basis:
          code === USD
            ? "Reported in US dollars. No conversion applied."
            : basisLine(code, rate, snapshot.asOf),
      };
    },
  };
}

export async function getFxTable(): Promise<FxTable> {
  const env = await getRates(USD);
  return makeTable(env.data, env.provenance);
}

export async function getFxTableOn(date: string): Promise<FxTable> {
  const env = await getRatesOn(date, USD);
  return makeTable(env.data, env.provenance);
}

export async function convertToUsd(
  amount: number,
  currency: string,
): Promise<FxConversion | null> {
  if (!Number.isFinite(amount)) return null;
  if (normalizeCode(currency) === USD) return identityConversion(amount);

  const table = await getFxTable();
  return table.convert(amount, currency);
}

export async function getFxRates(): Promise<Envelope<FxRates>> {
  const env = await getRates(USD);
  if (Object.keys(env.data.rates).length === 0) {
    throw new Error(env.provenance.note ?? "No exchange rate provider responded.");
  }
  return {
    data: { base: env.data.base, date: env.data.asOf, rates: env.data.rates },
    provenance: env.provenance,
  };
}

export function inrToUsd(amountInr: number, usdInrRate: number): number {
  if (!Number.isFinite(usdInrRate) || usdInrRate <= 0) {
    throw new Error("A positive USD/INR rate is required.");
  }
  return amountInr / usdInrRate;
}
