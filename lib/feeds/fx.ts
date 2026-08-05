/**
 * Foreign exchange.
 *
 * The coverage universe reports in INR, EUR, GBP and USD. Any figure compared
 * across those companies has to be translated at a real, dated rate, and the
 * date has to travel with the number: a March quarter converted at today's
 * fixing is a legitimate view only if the screen says that is what it is. Every
 * conversion this module performs therefore returns the rate and the rate's own
 * date alongside the result.
 *
 * Two independent providers, both free and neither requiring a key. Both were
 * curl-tested before being wired in. Frankfurter is the primary because it
 * publishes ECB reference rates with an explicit date; open.er-api is the
 * fallback because it is a different operator, so a single provider outage
 * does not take the console's currency conversion with it.
 *
 * Note on frankfurter: the .app domain 301s to .dev for every path, so it is
 * not a second rung, only a redirect hop to the same service. The .dev host is
 * used directly and open.er-api is the real fallback.
 */

import { cached } from "@/lib/core/cache";
import { fetchJson } from "@/lib/core/fetcher";
import type { Envelope, FxRates, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const USD = "USD";

// Six hours, not the thirty minutes this module started with. These are ECB
// daily reference fixings, published once per business day around 16:00 CET; a
// shorter window spends requests re-reading a number that cannot have moved.
const TTL_MS = 6 * 60 * 60 * 1000;

// A dated fixing is immutable once published, so a historical lookup only ever
// needs re-fetching across a process restart.
const HISTORICAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The currency set both providers are narrowed to.
 *
 * Frankfurter publishes exactly these; open.er-api publishes about 160. Both
 * are filtered to one list so that `supports` answers identically no matter
 * which provider happened to win the race, and a call site never sees its
 * coverage change between two requests a second apart.
 */
export const FX_SUPPORTED_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

const SUPPORTED = new Set<string>(FX_SUPPORTED_CURRENCIES);

// A provider that answers 200 with a hollowed-out table is worse than one that
// times out, because the race would hand back the hollow answer. Requiring most
// of the list to be present sends a degraded response to the other provider
// instead of into the cache.
const MIN_RATES = 8;

/**
 * Rates for one base on one date.
 *
 * `rates[X]` is units of X per one unit of `base`, which is the direction both
 * providers publish. `asOf` is the date the provider stamps on the fixing, not
 * the date it was requested: ask Frankfurter for a Sunday and it answers with
 * Friday's table and says so.
 */
export interface FxSnapshot {
  base: string;
  rates: Record<string, number>;
  asOf: string;
}

/** One conversion, carrying the evidence needed to label it on screen. */
export interface FxConversion {
  /** The input, unchanged. */
  amount: number;
  currency: string;
  usd: number;
  /** Units of `currency` per one US dollar. */
  rate: number;
  /** Date the applied rate is dated. Null when the figure was already in USD. */
  rateDate: string | null;
  /** Ready to render next to the number. */
  basis: string;
}

/** A series converted at a single rate, which is why the rate is stated once. */
export interface FxConvertedSeries {
  currency: string;
  rate: number;
  rateDate: string | null;
  /** One entry per input. A non-finite input yields null rather than NaN. */
  values: Array<number | null>;
  basis: string;
}

/**
 * A resolved rate table bound to USD.
 *
 * Handed to call sites so the network cost is paid once per render rather than
 * once per figure, and so a page that converts forty rows quotes one rate on
 * all forty.
 */
export interface FxTable {
  base: string;
  /** Date of the fixing the table carries. */
  asOf: string;
  rates: Record<string, number>;
  /** Where the table came from. Attach this to anything derived from it. */
  provenance: Provenance;
  supports(currency: string): boolean;
  /** Units of `currency` per one US dollar, or null when unknown. */
  rateFor(currency: string): number | null;
  /** The converted number alone. Null when the currency is not in the table. */
  toUsd(amount: number, currency: string): number | null;
  /** The converted number with the rate and its date. Null when unknown. */
  convert(amount: number, currency: string): FxConversion | null;
  /** Null rather than a partly converted series when the currency is unknown. */
  convertSeries(amounts: number[], currency: string): FxConvertedSeries | null;
}

/**
 * Checked-in reference rates.
 *
 * Retrieved from Frankfurter on 2026-08-05 and committed verbatim; the table
 * itself is the fixing of 2026-08-04. This is the last rung before
 * "unavailable". It is real published data, but it is that date's data, and the
 * provenance note says so every time it is served.
 */
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

/**
 * Filters a provider table to the supported list and drops anything that is
 * not a usable positive number, so a null or a zero from upstream becomes an
 * absent currency rather than a division by zero downstream.
 */
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
  // Providers omit the base from their own table. Adding it keeps the identity
  // case inside the table instead of a branch at every call site.
  if (SUPPORTED.has(base)) rates[base] = 1;
  return { base, rates, asOf };
}

async function fromFrankfurter(base: string, date?: string): Promise<Resolved> {
  const path = date ?? "latest";
  const url = `https://api.frankfurter.dev/v1/${path}?base=${encodeURIComponent(base)}`;
  // No retry. When two independent providers are raced, retrying a slow one
  // only delays the answer the other already has.
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

  // This provider dates its table with an RFC 1123 timestamp rather than a
  // plain day, so it is reduced to the day for comparability with Frankfurter.
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

/**
 * Restates a USD-based snapshot against another base by division.
 *
 * Used only for the committed baseline, where there is no second base to
 * fetch. Arithmetic on one dated table is still that table's data, so the
 * result keeps the same date and the same baseline label.
 */
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
  // Named rather than fixed, because the historical path only ever contacts
  // Frankfurter and should not report having tried a provider it did not.
  source = "Frankfurter and open.er-api",
): Resolved {
  return {
    // An empty table converts nothing, which is the point: every call site
    // reports absence rather than reaching for a stand-in rate. asOf carries
    // the date of the attempt, since there is no fixing to date.
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
  // AggregateError carries each provider's failure. Surfacing both makes the
  // cause diagnosable instead of "rate unavailable".
  if (err instanceof AggregateError) {
    return err.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

async function resolveLatest(base: string): Promise<Resolved> {
  // Tracks whether this call actually went out to a provider. The cache reports
  // a within-TTL hit as fresh, which is not the same thing: with a six hour
  // window a hit can be hours old, and calling that "live" would overstate it.
  let fetchedNow = false;

  try {
    const result = await cached(`fx:rates:${base}`, TTL_MS, async () => {
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
        const won = await Promise.any([fromFrankfurter(base), fromErApi(base)]);
        // Set only on success. A failed producer can still be answered from a
        // stale entry, and that answer must not be labelled live.
        fetchedNow = true;
        return won;
      } catch (err) {
        // Rethrown as the bare reasons. The lead-in is added once by whichever
        // fallback ends up serving, so a note never says it twice.
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
        // Frankfurter alone here. open.er-api's free tier publishes only the
        // latest table, and the committed baseline is one specific day, so
        // substituting either for a requested date would return a rate that is
        // not the rate asked for.
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
    // Deliberately no baseline rung. The committed snapshot is one specific
    // day, and answering a request for another day with it would return a rate
    // that was never the rate asked for.
    return unavailable(
      base,
      `No fixing could be retrieved for ${date}. ${aggregateReason(err)}`,
      "Frankfurter, European Central Bank reference rates",
    );
  }
}

/**
 * Latest rates for one base.
 *
 * Never throws and never returns an invented number. When nothing resolves the
 * table is empty and the provenance says why, which leaves the caller to render
 * absence rather than a plausible-looking figure.
 */
export async function getRates(base: string = USD): Promise<Envelope<FxSnapshot>> {
  const resolved = await resolveLatest(normalizeCode(base));
  return { data: resolved.snapshot, provenance: resolved.provenance };
}

/**
 * Rates as published on a given date, for restating an older quarter at the
 * rate that prevailed then.
 *
 * The date requested and the date returned are not always the same. Weekends
 * and target holidays have no fixing, and the provider answers with the last
 * business day before them, so read `asOf` rather than assuming the input.
 */
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
  // The table is always USD based because getFxTable pins the base; the field
  // is carried through rather than hardcoded so it stays honest if that changes.
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
        // A bad point becomes null rather than NaN, so one gap cannot poison an
        // axis or a total computed from the series.
        values: amounts.map((n) => (Number.isFinite(n) ? n / rate : null)),
        basis:
          code === USD
            ? "Reported in US dollars. No conversion applied."
            : basisLine(code, rate, snapshot.asOf),
      };
    },
  };
}

/**
 * The current USD table, resolved once and handed to the caller.
 *
 *   const fx = await getFxTable();
 *   const usd = fx.toUsd(1_000_000, "INR");
 */
export async function getFxTable(): Promise<FxTable> {
  const env = await getRates(USD);
  return makeTable(env.data, env.provenance);
}

/**
 * The USD table as published on a given date, for restating a figure at the
 * rate of its own period instead of today's.
 */
export async function getFxTableOn(date: string): Promise<FxTable> {
  const env = await getRatesOn(date, USD);
  return makeTable(env.data, env.provenance);
}

/**
 * One-off conversion for a call site with a single figure to translate.
 *
 * A USD amount returns immediately without contacting a provider, so a page
 * whose companies all report in dollars never pays for a rate it will not use.
 */
export async function convertToUsd(
  amount: number,
  currency: string,
): Promise<FxConversion | null> {
  if (!Number.isFinite(amount)) return null;
  if (normalizeCode(currency) === USD) return identityConversion(amount);

  const table = await getFxTable();
  return table.convert(amount, currency);
}

/**
 * The USD table in the shape the fx route has served since it was written.
 *
 * Kept because that route treats a throw as its 503 signal: an empty table
 * means both providers failed and the committed baseline could not stand in,
 * and that is worth a status code rather than a 200 carrying nothing.
 */
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
