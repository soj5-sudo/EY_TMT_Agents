import { NextResponse } from "next/server";
import { annualise, ledgerFor, ledgerPeriodsPerYear, seriesFor } from "@/lib/brain/ledger";
import { METRICS, type MetricKey } from "@/lib/brain/intent";
import { findCompany, UNIVERSE, type Company } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_COMPANIES = 6;

export interface CompareSeries {
  key: MetricKey;
  label: string;
  unit: string;
  betterHigh: boolean | null;
  points: Array<{ label: string; value: number }>;
  latest: number | null;
  period: string | null;
}

export interface CompareCompany {
  symbol: string;
  name: string;
  short: string;
  sector: string;
  subsector: string;
  region: string;
  themes: string[];
  measures: CompareSeries[];
  provenance: Provenance | null;
  unavailable: string | null;
}

function resolve(raw: string): Company | null {
  const q = raw.trim();
  if (q.length === 0) return null;
  const direct = UNIVERSE.find(
    (c) =>
      c.symbol.toLowerCase() === q.toLowerCase() ||
      c.short.toLowerCase() === q.toLowerCase(),
  );
  return direct ?? findCompany(q);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("companies") ?? "").split(",").filter(Boolean);

  if (raw.length < 2) {
    return NextResponse.json(
      { error: "Name at least two companies to compare, separated by commas." },
      { status: 400 },
    );
  }

  const wanted: Company[] = [];
  const unresolved: string[] = [];

  for (const name of raw.slice(0, MAX_COMPANIES)) {
    const hit = resolve(name);
    if (!hit) {
      unresolved.push(name.trim());
      continue;
    }
    if (!wanted.some((c) => c.symbol === hit.symbol)) wanted.push(hit);
  }

  if (wanted.length < 2) {
    return NextResponse.json(
      {
        error:
          unresolved.length > 0
            ? `Not in the coverage universe: ${unresolved.join(", ")}. Two tracked names are needed.`
            : "Two distinct tracked companies are needed.",
        unresolved,
      },
      { status: 400 },
    );
  }

  const companies: CompareCompany[] = await Promise.all(
    wanted.map(async (c): Promise<CompareCompany> => {
      const base: CompareCompany = {
        symbol: c.symbol,
        name: c.name,
        short: c.short,
        sector: c.sector,
        subsector: c.subsector,
        region: c.region,
        themes: [...c.themes],
        measures: [],
        provenance: null,
        unavailable: null,
      };

      try {
        const { ledger, provenance, unavailable } = await ledgerFor(c);
        if (!ledger) {
          return { ...base, provenance, unavailable: unavailable ?? c.coverageNote ?? null };
        }

        const ppy = ledgerPeriodsPerYear(ledger);

        const measures: CompareSeries[] = [];
        for (const m of METRICS) {
          const raw = seriesFor(ledger, m.key);
          if (raw.length === 0) continue;
          const points =
            ppy === 1
              ? raw
              : raw.map((p) => ({ label: p.label, value: annualise(m.key, p.value, ppy) }));
          measures.push({
            key: m.key,
            label: m.label,
            unit: m.unit,
            betterHigh: m.betterHigh,
            points,
            latest: points.at(-1)?.value ?? null,
            period: points.at(-1)?.label ?? null,
          });
        }

        return { ...base, measures, provenance, unavailable: measures.length === 0 ? "No measure could be computed from the record for this name." : null };
      } catch (err) {
        return {
          ...base,
          unavailable: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const rows = METRICS.filter((m) =>
    companies.some((c) => c.measures.some((x) => x.key === m.key)),
  ).map((m) => ({
    key: m.key,
    label: m.label,
    unit: m.unit,
    betterHigh: m.betterHigh,
  }));

  return NextResponse.json(
    {
      companies,
      rows,
      unresolved,
      note:
        "Every figure is the last point of the series computed from the company's own filed or published record. " +
        "A company publishing quarters has its revenue and growth put on an annual footing so the columns are comparable; ratios need no adjustment. " +
        "The period is shown against every figure, so a comparison across different year ends is not read as like for like when it is not.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
