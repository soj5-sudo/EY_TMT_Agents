import { NextResponse } from "next/server";
import { sectorRows } from "@/lib/brain/sector";
import { ledgerFor } from "@/lib/brain/ledger";
import { UNIVERSE } from "@/lib/data/universe";
import { PEER_UNIVERSE } from "@/lib/data/peer-universe";
import { TRACKER } from "@/lib/data/sector-tracker";
import { INDIA_LOCATION_NOTE, locationFor } from "@/lib/data/india-locations";
import { cached } from "@/lib/core/cache";
import { nowIso, type Provenance } from "@/lib/core/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TTL_MS = 6 * 60 * 60 * 1000;

type Origin = "filing" | "tracker" | "workbook";

export interface IndiaCompany {
  name: string;
  state: string;
  city: string;
  vertical: string;
  revenueUsdM: number | null;
  operatingMarginPct: number | null;
  headcount: number | null;
  period: string | null;
  origin: Origin;
}

export interface IndiaState {
  state: string;
  companies: number;
  revenueUsdM: number;
  cities: string[];
  names: string[];
}

export async function GET(request: Request) {
  const vertical = new URL(request.url).searchParams.get("vertical") ?? "all";

  const res = await cached(`india:map:${vertical}`, TTL_MS, async () => {
    const rows = new Map<string, IndiaCompany>();

    for (const p of PEER_UNIVERSE) {
      if (p.headquarters !== "India") continue;
      if (vertical !== "all" && p.vertical !== vertical) continue;
      const loc = locationFor(p.name);
      if (!loc) continue;
      rows.set(loc.company, {
        name: p.name,
        state: loc.state,
        city: loc.city,
        vertical: p.vertical,
        revenueUsdM: p.revenueUsdM,
        operatingMarginPct: p.ebitdaPct,
        headcount: null,
        period: p.lastReported || null,
        origin: "workbook",
      });
    }

    for (const t of TRACKER) {
      const loc = locationFor(t.name);
      if (!loc) continue;
      const held = rows.get(loc.company);
      const rev = t.metrics.revenueUsdM?.latest ?? null;
      const margin = t.metrics.ebitMarginPct?.latest ?? null;
      const head = t.metrics.headcountK?.latest ?? null;
      rows.set(loc.company, {
        name: held?.name ?? t.name,
        state: loc.state,
        city: loc.city,
        vertical: held?.vertical ?? "IT services",
        revenueUsdM: rev !== null ? rev * 4 : (held?.revenueUsdM ?? null),
        operatingMarginPct: margin !== null ? margin * 100 : (held?.operatingMarginPct ?? null),
        headcount: head !== null ? head * 1000 : null,
        period: "Dec'24, annualised",
        origin: "tracker",
      });
    }

    const sector = await sectorRows();
    // Where a company is registered, not where its shares happen to trade.
    // Infosys and Wipro file in New York and are headquartered in Bengaluru.
    const indian = new Map(UNIVERSE.map((c) => [c.symbol, c]));

    for (const r of sector.rows) {
      if (r.revenue === null) continue;
      const loc = locationFor(r.short) ?? locationFor(r.name);
      if (!loc) continue;
      const held = rows.get(loc.company);
      rows.set(loc.company, {
        name: held?.name ?? r.name,
        state: loc.state,
        city: loc.city,
        vertical: held?.vertical ?? r.subsector,
        revenueUsdM: r.revenue / 1e6,
        operatingMarginPct: r.operatingMargin ?? held?.operatingMarginPct ?? null,
        headcount: held?.headcount ?? null,
        period: r.period,
        origin: "filing",
      });
    }

    // Headcount is not on the sector row, so the newest figure in the ledger is
    // read for the names the filed record already answered for.
    await Promise.all(
      [...rows.entries()]
        .filter(([, c]) => c.origin === "filing" && c.headcount === null)
        .map(async ([key, c]) => {
          const company = [...indian.values()].find(
            (u) => (locationFor(u.short) ?? locationFor(u.name))?.company === key,
          );
          if (!company) return;
          try {
            const { ledger } = await ledgerFor(company);
            const line = ledger?.series.employees;
            if (!line) return;
            const head = [...line.annual, ...line.quarterly]
              .sort((a, b) => a.end.localeCompare(b.end))
              .at(-1)?.value;
            if (head !== undefined) rows.set(key, { ...c, headcount: head });
          } catch {
            // A name whose ledger will not open keeps the headcount it had.
          }
        }),
    );

    const companies = [...rows.values()].sort(
      (a, b) => (b.revenueUsdM ?? 0) - (a.revenueUsdM ?? 0),
    );

    const byState = new Map<string, IndiaState>();
    for (const c of companies) {
      const held = byState.get(c.state) ?? {
        state: c.state,
        companies: 0,
        revenueUsdM: 0,
        cities: [],
        names: [],
      };
      held.companies += 1;
      held.revenueUsdM += c.revenueUsdM ?? 0;
      if (!held.cities.includes(c.city)) held.cities.push(c.city);
      held.names.push(c.name);
      byState.set(c.state, held);
    }

    const states = [...byState.values()].sort((a, b) => b.revenueUsdM - a.revenueUsdM);
    return {
      companies,
      states,
      filed: companies.filter((c) => c.origin === "filing").length,
    };
  });

  const v = res.value;

  return NextResponse.json(
    {
      vertical,
      states: v.states,
      companies: v.companies,
      totals: {
        companies: v.companies.length,
        states: v.states.length,
        revenueUsdM: v.states.reduce((s, x) => s + x.revenueUsdM, 0),
        filed: v.filed,
      },
      verticals: [
        ...new Set(PEER_UNIVERSE.filter((p) => p.headquarters === "India").map((p) => p.vertical)),
      ],
      note: INDIA_LOCATION_NOTE,
      provenance: {
        kind: "filing",
        source: "Indian coverage by registered office, on figures computed from filings and published results",
        retrievedAt: new Date(res.storedAt).toISOString(),
        note:
          `${v.companies.length} Indian companies across ${v.states.length} states. ` +
          `${v.filed} carry figures computed from their own filed or published documents on this request. ` +
          `The rest carry the last reported figure from the quarterly tracker or the peer workbook, with the period shown on the row.`,
      } satisfies Provenance,
      generatedAt: nowIso(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
