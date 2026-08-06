import { NextResponse } from "next/server";
import { annualise, ledgerFor, ledgerPeriodsPerYear, seriesFor } from "@/lib/brain/ledger";
import { METRICS, type MetricKey } from "@/lib/brain/intent";
import { findCompany, UNIVERSE, type Company } from "@/lib/data/universe";
import { cached } from "@/lib/core/cache";
import { nowIso, type Provenance } from "@/lib/core/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TTL_MS = 60 * 60 * 1000;

export interface BenchmarkMeasure {
  key: MetricKey;
  label: string;
  unit: string;
  betterHigh: boolean | null;
  subject: number | null;
  period: string | null;
  points: Array<{ label: string; value: number }>;
  cohortMedian: number | null;
  best: { short: string; value: number } | null;
  worst: { short: string; value: number } | null;
  rank: number | null;
  ranked: number;
  percentile: number | null;
  cohort: Array<{ short: string; value: number; isSubject: boolean }>;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("company") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "subsector";
  const region = url.searchParams.get("region") ?? "All";

  if (raw.length === 0) {
    return NextResponse.json({ error: "Name a company to position." }, { status: 400 });
  }

  const subject =
    UNIVERSE.find(
      (c) =>
        c.symbol.toLowerCase() === raw.toLowerCase() ||
        c.short.toLowerCase() === raw.toLowerCase(),
    ) ?? findCompany(raw);

  if (!subject) {
    return NextResponse.json(
      { error: `"${raw}" is not in the coverage universe, so there is no cohort to position it against.` },
      { status: 404 },
    );
  }

  const cohort = UNIVERSE.filter((c) => {
    if (scope === "sector") {
      if (c.sector !== subject.sector) return false;
    } else if (c.subsector !== subject.subsector) {
      return false;
    }
    if (region !== "All" && c.region !== region && c.symbol !== subject.symbol) return false;
    return true;
  });

  const key = `benchmark:${subject.symbol}:${scope}:${region}`;

  const res = await cached(key, TTL_MS, async () => {
    const ledgers = await Promise.all(
      cohort.map(async (c) => ({
        company: c,
        result: await ledgerFor(c).catch(() => null),
      })),
    );

    const seriesByCompany = new Map<string, Map<MetricKey, Array<{ label: string; value: number }>>>();
    const sources: Provenance[] = [];

    for (const { company, result } of ledgers) {
      const map = new Map<MetricKey, Array<{ label: string; value: number }>>();
      if (result?.ledger) {
        const ppy = ledgerPeriodsPerYear(result.ledger);
        for (const m of METRICS) {
          const points = seriesFor(result.ledger, m.key);
          if (points.length === 0) continue;
          map.set(
            m.key,
            ppy === 1
              ? points
              : points.map((p) => ({
                  label: p.label,
                  value: annualise(m.key, p.value, ppy),
                })),
          );
        }
        if (result.provenance) sources.push(result.provenance);
      }
      seriesByCompany.set(company.symbol, map);
    }

    const measures: BenchmarkMeasure[] = METRICS.map((m) => {
      const values: Array<{ short: string; value: number; isSubject: boolean }> = [];
      for (const c of cohort) {
        const points = seriesByCompany.get(c.symbol)?.get(m.key);
        const latest = points?.at(-1)?.value;
        if (latest === undefined || !Number.isFinite(latest)) continue;
        values.push({ short: c.short, value: latest, isSubject: c.symbol === subject.symbol });
      }

      const subjectPoints = seriesByCompany.get(subject.symbol)?.get(m.key) ?? [];
      const subjectValue = subjectPoints.at(-1)?.value ?? null;

      let rank: number | null = null;
      let percentile: number | null = null;
      if (subjectValue !== null && m.betterHigh !== null && values.length >= 2) {
        const ordered = [...values].sort((a, b) =>
          m.betterHigh ? b.value - a.value : a.value - b.value,
        );
        const at = ordered.findIndex((v) => v.isSubject);
        if (at >= 0) {
          rank = at + 1;
          percentile = ((values.length - rank) / (values.length - 1)) * 100;
        }
      }

      const sorted = [...values].sort((a, b) => a.value - b.value);
      const high = sorted.at(-1) ?? null;
      const low = sorted[0] ?? null;

      return {
        key: m.key,
        label: m.label,
        unit: m.unit,
        betterHigh: m.betterHigh,
        subject: subjectValue,
        period: subjectPoints.at(-1)?.label ?? null,
        points: subjectPoints,
        cohortMedian: median(values.map((v) => v.value)),
        best: m.betterHigh === null ? null : m.betterHigh ? high : low,
        worst: m.betterHigh === null ? null : m.betterHigh ? low : high,
        rank,
        ranked: values.length,
        percentile,
        cohort: values.sort((a, b) => b.value - a.value),
      };
    });

    return {
      measures,
      cohortNames: cohort.map((c) => c.short),
      withData: [...seriesByCompany.entries()].filter(([, v]) => v.size > 0).length,
      sources: sources.slice(0, 4),
    };
  });

  const v = res.value;

  const ranked = v.measures.filter((m) => m.rank !== null && m.ranked >= 3);
  const leading = ranked.filter((m) => m.rank === 1);
  const topQuartile = ranked.filter((m) => (m.percentile ?? 0) >= 75);
  const bottomQuartile = ranked.filter((m) => (m.percentile ?? 100) <= 25);

  return NextResponse.json(
    {
      subject: {
        symbol: subject.symbol,
        name: subject.name,
        short: subject.short,
        sector: subject.sector,
        subsector: subject.subsector,
        region: subject.region,
        themes: subject.themes,
      },
      scope,
      region,
      cohortNames: v.cohortNames,
      cohortSize: v.cohortNames.length,
      withData: v.withData,
      measures: v.measures,
      standing: {
        ranked: ranked.length,
        leads: leading.map((m) => m.label),
        strong: topQuartile.map((m) => m.label),
        weak: bottomQuartile.map((m) => m.label),
      },
      provenance: {
        kind: "filing",
        source: `Positioned against ${v.cohortNames.length} names in ${scope === "sector" ? subject.sector : subject.subsector}${region === "All" ? "" : `, ${region} listings only`}`,
        retrievedAt: new Date(res.storedAt).toISOString(),
        note:
          `${v.withData} of ${v.cohortNames.length} companies in the cohort report figures. ` +
          `A rank is only shown where at least three of them report the measure, and only where the direction is a judgement: research intensity has no better side. ` +
          `Companies publishing quarterly have their revenue and growth put on an annual footing before ranking, since a quarter set beside a full year is not a comparison. Periods are still not aligned across the cohort, because companies report to their own year ends.`,
      } satisfies Provenance,
      generatedAt: nowIso(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
