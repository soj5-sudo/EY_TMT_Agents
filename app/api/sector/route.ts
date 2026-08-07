import { NextResponse } from "next/server";
import { sectorRows } from "@/lib/brain/sector";
import { THEME_LABELS, type Theme } from "@/lib/data/universe";
import { PEER_TAKEN_AT, PEER_UNIVERSE } from "@/lib/data/peer-universe";

/** The workbook names its verticals its own way; two of them are ours. */
const PEER_SEGMENT: Record<string, string> = {
  "IT services": "IT services",
  "Enterprise software": "Software and platforms",
};

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const res = await sectorRows();
  const rows = res.rows;
  const withData = rows.filter((r) => r.revenue !== null);

  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const subsectors = [...new Set(rows.map((r) => r.subsector))].map((name) => {
    const members = withData.filter((r) => r.subsector === name);
    return {
      name,
      count: members.length,
      revenue: members.reduce((s, r) => s + (r.revenue ?? 0), 0),
      medianOperatingMargin: median(
        members.map((r) => r.operatingMargin).filter((v): v is number => v !== null),
      ),
      medianGrowth: median(
        members.map((r) => r.revenueGrowthPct).filter((v): v is number => v !== null),
      ),
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const themes = (Object.keys(THEME_LABELS) as Theme[]).map((t) => {
    const members = withData.filter((r) => r.themes.includes(t));
    return {
      theme: t,
      label: THEME_LABELS[t],
      count: members.length,
      revenue: members.reduce((s, r) => s + (r.revenue ?? 0), 0),
      medianGrowth: median(
        members.map((r) => r.revenueGrowthPct).filter((v): v is number => v !== null),
      ),
      medianOperatingMargin: median(
        members.map((r) => r.operatingMargin).filter((v): v is number => v !== null),
      ),
      members: members
        .sort((a, b) => (b.revenueGrowthPct ?? -999) - (a.revenueGrowthPct ?? -999))
        .map((r) => ({
          short: r.short,
          growth: r.revenueGrowthPct,
          margin: r.operatingMargin,
        })),
    };
  })
    .filter((t) => t.count > 0)
    .sort((a, b) => (b.medianGrowth ?? -999) - (a.medianGrowth ?? -999));

  const lastFiled = rows
    .map((r) => r.lastFiled)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1) ?? null;

  return NextResponse.json(
    {
      rows,
      subsectors,
      themes,
      peers: PEER_UNIVERSE.map((p) => ({
        name: p.name,
        segment: PEER_SEGMENT[p.vertical] ?? p.vertical,
        vertical: p.vertical,
        headquarters: p.headquarters,
        revenue: p.revenueUsdM === null ? null : p.revenueUsdM * 1e6,
        period: p.lastReported,
      })),
      peersTakenAt: PEER_TAKEN_AT,
      coverage: {
        total: rows.length,
        withData: withData.length,
        notCovered: rows
          .filter((r) => r.revenue === null)
          .map((r) => ({ short: r.short, reason: r.coverageNote ?? "No published source is wired for this name." })),
      },
      provenance: {
        kind: "filing",
        source: "SEC EDGAR XBRL company facts and published investor relations documents",
        url: "https://www.sec.gov/edgar",
        retrievedAt: new Date(res.storedAt).toISOString(),
        note: `${withData.length} of ${rows.length} names carry reported financials. Most recent filing in the set is ${lastFiled ?? "not set"}.`,
      },
      lastFiled,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
