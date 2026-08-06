import { NextResponse } from "next/server";
import { cached } from "@/lib/core/cache";
import type { Provenance } from "@/lib/core/types";
import {
  TRACKER,
  TRACKER_PERIODS,
  TRACKER_TAKEN_AT,
  type TrackerCompany,
} from "@/lib/data/sector-tracker";
import { PEER_TAKEN_AT, PEER_UNIVERSE, type PeerCompany } from "@/lib/data/peer-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The quarterly tracker, and the cohort arithmetic on top of it.
 *
 * Two things are served here that the filings dashboards cannot produce. The
 * first is what management said about a quarter and why a measure moved, which
 * no filing publishes in a machine readable form. The second is the cohort
 * position: a company's attrition means little until it is set against the
 * tier it competes with for the same people.
 *
 * The cohort figures are weighted by revenue rather than averaged. Twelve
 * companies in this set run from a few tens of millions of dollars a quarter
 * to several billion, and an unweighted mean hands each of them the same vote,
 * which produces a cohort margin no client of that cohort would recognise.
 */

const TTL_MS = 6 * 60 * 60 * 1000;

type Tier = TrackerCompany["tier"];

/** Tiers and verticals in the order the datasets list them, not a second copy. */
const TIERS: Tier[] = [...new Set(TRACKER.map((c) => c.tier))];
const VERTICALS: string[] = [...new Set(PEER_UNIVERSE.map((p) => p.vertical))];

/**
 * Measure keys and their units, read off the dataset in first seen order so a
 * measure added by the next ingest reaches the dashboard without this route
 * naming it.
 */
const METRIC_KEYS: string[] = [];
const METRIC_UNITS: Record<string, string> = {};
for (const company of TRACKER) {
  for (const [key, measure] of Object.entries(company.metrics)) {
    if (METRIC_KEYS.includes(key)) continue;
    METRIC_KEYS.push(key);
    METRIC_UNITS[key] = measure.unit;
  }
}

/**
 * Names for the provenance sentence only. The response carries the raw keys
 * and the dashboard titles its own columns; this is here so a reader is not
 * handed "ebitdaMarginPct" in the middle of a sentence.
 */
const METRIC_LABELS: Record<string, string> = {
  revenueUsdM: "revenue",
  ebitMarginPct: "EBIT margin",
  ebitdaMarginPct: "EBITDA margin",
  headcountK: "headcount",
  attritionPct: "attrition",
  utilisationPct: "utilisation",
};

function label(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

const EUROPE = new Set([
  "France",
  "Ireland",
  "United Kingdom",
  "Luxembourg",
  "Germany",
  "Netherlands",
  "Denmark",
  "Finland",
  "Switzerland",
  "Spain",
]);

const NAMED_REGIONS = ["India", "United States", "Europe"] as const;

/** Buckets outside the three named regions, so every peer lands somewhere. */
const OTHER_REGION = "Other";

/**
 * The catch-all is a selectable region, not just a row in the breakdown. The
 * dashboard builds its region chips straight from `byRegion`, so a bucket that
 * is published there and refused here is a chip that can only ever fail.
 */
const REGIONS = [...NAMED_REGIONS, OTHER_REGION] as const;
type Region = (typeof REGIONS)[number];

function regionOf(headquarters: string): string {
  if (headquarters === "India") return "India";
  // The workbook writes the same country both ways. Left alone, the row filed
  // under "USA" would fall into Other and the United States count would be one
  // company short of the truth.
  if (headquarters === "United States" || headquarters === "USA") return "United States";
  if (EUROPE.has(headquarters)) return "Europe";
  return OTHER_REGION;
}

export interface TrackerMovement {
  prior: number | null;
  latest: number | null;
  /** Percentage change. Money and headcount only. */
  deltaPct: number | null;
  /** Change in basis points. Margins, attrition and utilisation only. */
  deltaBps: number | null;
  status: string;
  reason: string;
  source: string;
  unit: string;
}

export interface TrackerRow {
  name: string;
  tier: Tier;
  measures: Record<string, TrackerMovement>;
}

export interface CohortMeasure {
  prior: number | null;
  latest: number | null;
  /** How many of the cohort's companies stand behind those two figures. */
  reporting: number;
  basis: "total" | "revenue weighted" | "simple mean";
  /** Members that do not report the measure, named rather than quietly dropped. */
  missing: string[];
}

export interface CohortRow {
  tier: Tier;
  count: number;
  measures: Record<string, CohortMeasure>;
}

export interface PeerVerticalGroup {
  vertical: string;
  count: number;
  revenueUsdM: number;
}

export interface PeerRegionGroup {
  region: string;
  count: number;
  revenueUsdM: number;
}

export interface PeerSection {
  total: number;
  shown: number;
  byVertical: PeerVerticalGroup[];
  byRegion: PeerRegionGroup[];
  rows: PeerCompany[];
}

/**
 * Trims the binary floating point tail. Subtracting 0.129 from 0.132 lands at
 * 30.000000000000004 basis points, and a figure carrying fourteen decimals of
 * noise reads as false precision on a slide.
 */
function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * A rate and a level do not move in the same arithmetic. An EBIT margin going
 * from 24.5 to 24.9 per cent has risen 40 basis points, not 1.6 per cent, and
 * quoting the second overstates the move to anyone reading quickly. So shares
 * carry a basis point delta and nothing else, and levels carry a percentage
 * delta and nothing else.
 */
function movement(
  prior: number | null,
  latest: number | null,
  unit: string,
): { deltaPct: number | null; deltaBps: number | null } {
  if (prior === null || latest === null) return { deltaPct: null, deltaBps: null };
  if (unit === "share") return { deltaPct: null, deltaBps: round((latest - prior) * 10000, 1) };
  if (prior === 0) return { deltaPct: null, deltaBps: null };
  return { deltaPct: round(((latest - prior) / prior) * 100, 2), deltaBps: null };
}

function buildRow(company: TrackerCompany): TrackerRow {
  const measures: Record<string, TrackerMovement> = {};
  for (const key of METRIC_KEYS) {
    const m = company.metrics[key];
    if (!m) continue;
    measures[key] = {
      prior: m.prior,
      latest: m.latest,
      ...movement(m.prior, m.latest, m.unit),
      status: m.status,
      reason: m.reason,
      source: m.source,
      unit: m.unit,
    };
  }
  return { name: company.name, tier: company.tier, measures };
}

/**
 * One cohort figure for one measure.
 *
 * A member reporting only one of the two quarters is left out of both columns.
 * A cohort whose membership changes between prior and latest shows movement
 * that is composition rather than performance, and the reader has no way to
 * see it happen.
 */
function aggregate(members: TrackerCompany[], key: string): CohortMeasure {
  const unit = METRIC_UNITS[key] ?? "";
  const isShare = unit === "share";

  const contributors: Array<{
    prior: number;
    latest: number;
    weightPrior: number | null;
    weightLatest: number | null;
  }> = [];
  const missing: string[] = [];

  for (const company of members) {
    const m = company.metrics[key];
    if (!m || m.prior === null || m.latest === null) {
      missing.push(company.name);
      continue;
    }
    const revenue = company.metrics.revenueUsdM;
    contributors.push({
      prior: m.prior,
      latest: m.latest,
      weightPrior: revenue?.prior ?? null,
      weightLatest: revenue?.latest ?? null,
    });
  }

  if (contributors.length === 0) {
    return {
      prior: null,
      latest: null,
      reporting: 0,
      basis: isShare ? "revenue weighted" : "total",
      missing,
    };
  }

  if (!isShare) {
    // Revenue and headcount are cohort totals. A mean of twelve revenues
    // answers no question anyone asks of a sector page.
    const dp = 3;
    return {
      prior: round(contributors.reduce((s, c) => s + c.prior, 0), dp),
      latest: round(contributors.reduce((s, c) => s + c.latest, 0), dp),
      reporting: contributors.length,
      basis: "total",
      missing,
    };
  }

  // Weights are each company's revenue in the same quarter as the rate, so the
  // prior column is not weighted by the latest quarter's mix.
  const weighted = contributors.every(
    (c) =>
      c.weightPrior !== null && c.weightPrior > 0 && c.weightLatest !== null && c.weightLatest > 0,
  );

  if (!weighted) {
    // Only when a contributing company reports the rate but no revenue to
    // weight it by. Stated on the measure and again in the provenance, because
    // a mean and a weighted mean are different numbers with the same label.
    return {
      prior: round(contributors.reduce((s, c) => s + c.prior, 0) / contributors.length, 6),
      latest: round(contributors.reduce((s, c) => s + c.latest, 0) / contributors.length, 6),
      reporting: contributors.length,
      basis: "simple mean",
      missing,
    };
  }

  const priorWeight = contributors.reduce((s, c) => s + (c.weightPrior ?? 0), 0);
  const latestWeight = contributors.reduce((s, c) => s + (c.weightLatest ?? 0), 0);

  return {
    prior: round(
      contributors.reduce((s, c) => s + c.prior * (c.weightPrior ?? 0), 0) / priorWeight,
      6,
    ),
    latest: round(
      contributors.reduce((s, c) => s + c.latest * (c.weightLatest ?? 0), 0) / latestWeight,
      6,
    ),
    reporting: contributors.length,
    basis: "revenue weighted",
    missing,
  };
}

function buildCohort(tier: Tier): CohortRow {
  const members = TRACKER.filter((c) => c.tier === tier);
  const measures: Record<string, CohortMeasure> = {};
  for (const key of METRIC_KEYS) measures[key] = aggregate(members, key);
  return { tier, count: members.length, measures };
}

function buildPeers(vertical: string | null, region: Region | null): PeerSection {
  const rows = PEER_UNIVERSE.filter(
    (p) =>
      (vertical === null || p.vertical === vertical) &&
      (region === null || regionOf(p.headquarters) === region),
  );

  const sum = (subset: PeerCompany[]) =>
    round(
      subset.reduce((s, p) => s + (p.revenueUsdM ?? 0), 0),
      3,
    );

  // The breakdowns describe the set on screen, not the whole universe, so the
  // counts always add up to `shown` and a filtered view stays internally
  // consistent. `total` is what tells the reader how much was filtered away.
  const byVertical = VERTICALS.map((v) => {
    const subset = rows.filter((p) => p.vertical === v);
    return { vertical: v, count: subset.length, revenueUsdM: sum(subset) };
  })
    .filter((g) => g.count > 0)
    .sort((a, b) => b.revenueUsdM - a.revenueUsdM);

  const byRegion = REGIONS.map((r) => {
    const subset = rows.filter((p) => regionOf(p.headquarters) === r);
    return { region: r, count: subset.length, revenueUsdM: sum(subset) };
  })
    .filter((g) => g.count > 0)
    .sort((a, b) => b.revenueUsdM - a.revenueUsdM);

  return { total: PEER_UNIVERSE.length, shown: rows.length, byVertical, byRegion, rows };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tierParam = (url.searchParams.get("tier") ?? "all").trim();
  const verticalParam = (url.searchParams.get("vertical") ?? "all").trim();
  const regionParam = (url.searchParams.get("region") ?? "all").trim();

  // Filters are matched against the values the datasets actually carry, and a
  // value outside them is refused rather than silently emptying the page. The
  // error names the accepted values and never echoes what was sent.
  let tier: Tier | null = null;
  if (tierParam.toLowerCase() !== "all") {
    const match = TIERS.find((t) => t.toLowerCase() === tierParam.toLowerCase());
    if (!match) {
      return NextResponse.json(
        { error: `Tier must be one of: all, ${TIERS.join(", ")}.` },
        { status: 400 },
      );
    }
    tier = match;
  }

  let vertical: string | null = null;
  if (verticalParam.toLowerCase() !== "all") {
    const match = VERTICALS.find((v) => v.toLowerCase() === verticalParam.toLowerCase());
    if (!match) {
      return NextResponse.json(
        { error: `Vertical must be one of: all, ${VERTICALS.join(", ")}.` },
        { status: 400 },
      );
    }
    vertical = match;
  }

  let region: Region | null = null;
  if (regionParam.toLowerCase() !== "all") {
    const match = REGIONS.find((r) => r.toLowerCase() === regionParam.toLowerCase());
    if (!match) {
      return NextResponse.json(
        { error: `Region must be one of: all, ${REGIONS.join(", ")}.` },
        { status: 400 },
      );
    }
    region = match;
  }

  // The datasets are checked in, so the cache is not sparing an upstream: it
  // holds the aggregation for a filter combination that the dashboard requests
  // on every chip click.
  const key = `tracker:${tier ?? "all"}:${vertical ?? "all"}:${region ?? "all"}`;
  const res = await cached(key, TTL_MS, async () => {
    const members = tier === null ? TRACKER : TRACKER.filter((c) => c.tier === tier);
    return {
      companies: members.map(buildRow),
      // Cohorts follow the tier filter, so a tier-1 view is not compared
      // against a cohort half of which is off screen.
      cohorts: (tier === null ? TIERS : [tier]).map(buildCohort),
      peers: buildPeers(vertical, region),
    };
  });

  const { companies, cohorts, peers } = res.value;

  const meaned = [
    ...new Set(
      cohorts.flatMap((c) =>
        Object.entries(c.measures)
          .filter(([, m]) => m.basis === "simple mean")
          .map(([k]) => k),
      ),
    ),
  ];

  const partial = cohorts.flatMap((c) =>
    Object.entries(c.measures)
      .filter(([, m]) => m.missing.length > 0)
      .map(([k, m]) => `${label(k)} on ${m.reporting} of ${c.count} in ${c.tier}`),
  );

  // The weighting argument is made with this cohort's own extremes rather than
  // in the abstract, so the reader can check it against the table below it.
  const revenues = companies
    .map((c) => ({ name: c.name, value: c.measures.revenueUsdM?.latest ?? null }))
    .filter((c): c is { name: string; value: number } => c.value !== null)
    .sort((a, b) => a.value - b.value);
  const smallest = revenues[0];
  const largest = revenues.at(-1);
  const usd = (v: number) => `${Math.round(v).toLocaleString("en-US")} million dollars`;

  const weightingNote =
    smallest && largest && smallest.name !== largest.name
      ? `Margins, attrition and utilisation are weighted by each company's revenue in the same quarter. Unweighted, ${smallest.name} at ${usd(smallest.value)} would move the cohort as far as ${largest.name} at ${usd(largest.value)}. Revenue and headcount are cohort totals.`
      : "Margins, attrition and utilisation are weighted by each company's revenue in the same quarter. Revenue and headcount are cohort totals.";

  const meanNote =
    meaned.length > 0
      ? ` A simple mean was used for ${meaned.map(label).join(", ")}, where a contributing company reports the measure but no revenue to weight it by.`
      : " No measure fell back to a simple mean; every contributing company reports revenue in both quarters.";

  const coverageNote =
    partial.length > 0
      ? ` Not every company reports every measure, and a cohort figure is only ever the companies behind it: ${partial.join("; ")}.`
      : "";

  // Both dates are stated even when they match, since the two workbooks are
  // ingested separately and can drift apart at the next refresh.
  const harvestNote = ` The tracker was read on ${TRACKER_TAKEN_AT.slice(0, 10)} and the peer universe on ${PEER_TAKEN_AT.slice(0, 10)}.`;

  return NextResponse.json(
    {
      periods: TRACKER_PERIODS,
      takenAt: TRACKER_TAKEN_AT,
      filters: {
        tier: tier ?? "all",
        vertical: vertical ?? "all",
        region: region ?? "all",
      },
      companies,
      cohorts,
      peers,
      provenance: {
        kind: "cached",
        source:
          "Quarterly sector tracker and peer universe workbooks, published for public read and taken as a dated harvest",
        retrievedAt: TRACKER_TAKEN_AT,
        note:
          `${TRACKER_PERIODS.latest} against ${TRACKER_PERIODS.prior}. ` +
          weightingNote +
          meanNote +
          coverageNote +
          harvestNote +
          ` Peer figures are as of each row's own last reported period, which differs by company and is carried on the row; they are not current and are not comparable with the tracker's quarters. Aggregated at ${new Date(res.storedAt).toISOString()}.`,
      } satisfies Provenance,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
