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

const TTL_MS = 6 * 60 * 60 * 1000;

type Tier = TrackerCompany["tier"];

const TIERS: Tier[] = [...new Set(TRACKER.map((c) => c.tier))];
const VERTICALS: string[] = [...new Set(PEER_UNIVERSE.map((p) => p.vertical))];

const METRIC_KEYS: string[] = [];
const METRIC_UNITS: Record<string, string> = {};
for (const company of TRACKER) {
  for (const [key, measure] of Object.entries(company.metrics)) {
    if (METRIC_KEYS.includes(key)) continue;
    METRIC_KEYS.push(key);
    METRIC_UNITS[key] = measure.unit;
  }
}

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

const OTHER_REGION = "Other";

const REGIONS = [...NAMED_REGIONS, OTHER_REGION] as const;
type Region = (typeof REGIONS)[number];

function regionOf(headquarters: string): string {
  if (headquarters === "India") return "India";
  if (headquarters === "United States" || headquarters === "USA") return "United States";
  if (EUROPE.has(headquarters)) return "Europe";
  return OTHER_REGION;
}

export interface TrackerMovement {
  prior: number | null;
  latest: number | null;
  deltaPct: number | null;
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
  reporting: number;
  basis: "total" | "revenue weighted" | "simple mean";
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

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

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
    const dp = 3;
    return {
      prior: round(contributors.reduce((s, c) => s + c.prior, 0), dp),
      latest: round(contributors.reduce((s, c) => s + c.latest, 0), dp),
      reporting: contributors.length,
      basis: "total",
      missing,
    };
  }

  const weighted = contributors.every(
    (c) =>
      c.weightPrior !== null && c.weightPrior > 0 && c.weightLatest !== null && c.weightLatest > 0,
  );

  if (!weighted) {
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

  const key = `tracker:${tier ?? "all"}:${vertical ?? "all"}:${region ?? "all"}`;
  const res = await cached(key, TTL_MS, async () => {
    const members = tier === null ? TRACKER : TRACKER.filter((c) => c.tier === tier);
    return {
      companies: members.map(buildRow),
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
