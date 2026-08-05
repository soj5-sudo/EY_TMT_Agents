import { NextResponse } from "next/server";
import { annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { getIrHistory } from "@/lib/feeds/ir";
import { UNIVERSE, THEME_LABELS, type Theme } from "@/lib/data/universe";
import { cached } from "@/lib/core/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sector fundamentals.
 *
 * The dashboard is built on filings rather than share prices. Quote endpoints
 * rate-limit shared hosting hard enough that a price-led page renders empty
 * from a deployment, and for a diligence tool the day's move is decoration
 * anyway: revenue, margin and research intensity are what the question is
 * actually about. The regulator's own API answers reliably from anywhere, so
 * this panel always has data.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const SPACING_MS = 110;

export interface SectorRow {
  symbol: string;
  short: string;
  name: string;
  sector: string;
  subsector: string;
  region: string;
  themes: Theme[];
  period: string | null;
  revenue: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  rndIntensity: number | null;
  cashConversion: number | null;
  revenueGrowthPct: number | null;
  lastFiled: string | null;
  source: "sec" | "ir" | null;
}

function pick(ratios: Array<{ label: string; value: number | null }>, label: string) {
  return ratios.find((r) => r.label === label)?.value ?? null;
}

async function buildRow(c: (typeof UNIVERSE)[number]): Promise<SectorRow> {
  const base: SectorRow = {
    symbol: c.symbol,
    short: c.short,
    name: c.name,
    sector: c.sector,
    subsector: c.subsector,
    region: c.region,
    themes: c.themes,
    period: null,
    revenue: null,
    grossMargin: null,
    operatingMargin: null,
    netMargin: null,
    rndIntensity: null,
    cashConversion: null,
    revenueGrowthPct: null,
    lastFiled: null,
    source: null,
  };

  if (c.secFiler) {
    const sec = await resolveCik(c.symbol).catch(() => null);
    if (!sec) return base;

    const st = await getStatements(sec.cik);
    const { period, ratios } = annualRatios(st.data);
    const annual = st.data.lines.revenue?.annual ?? [];
    const latest = annual.at(-1);

    let growth: number | null = null;
    if (annual.length >= 2) {
      const first = annual[0].value;
      const years = annual.length - 1;
      if (first > 0) growth = (Math.pow(latest!.value / first, 1 / years) - 1) * 100;
    }

    let filed: string | null = null;
    for (const line of Object.values(st.data.lines)) {
      for (const p of line.annual) if (p.filed && (!filed || p.filed > filed)) filed = p.filed;
    }

    return {
      ...base,
      period,
      revenue: latest?.value ?? null,
      grossMargin: pick(ratios, "Gross margin"),
      operatingMargin: pick(ratios, "Operating margin"),
      netMargin: pick(ratios, "Net margin"),
      rndIntensity: pick(ratios, "Research intensity"),
      cashConversion: pick(ratios, "Cash conversion"),
      revenueGrowthPct: growth,
      lastFiled: filed,
      source: "sec",
    };
  }

  // Outside the SEC register: the company's own published quarterlies.
  const ir = await getIrHistory(c.symbol, 8).catch(() => null);
  const qs = ir?.data.quarters ?? [];
  if (qs.length === 0) return base;

  const latest = qs[qs.length - 1];
  const withRev = qs.filter((q) => q.revenueUsdMn !== null);
  let growth: number | null = null;
  if (withRev.length >= 2) {
    const first = withRev[0].revenueUsdMn!;
    const years = (withRev.length - 1) * 0.25;
    if (first > 0 && years > 0) {
      growth = (Math.pow(withRev.at(-1)!.revenueUsdMn! / first, 1 / years) - 1) * 100;
    }
  }

  return {
    ...base,
    period: latest.label,
    // Quarterly revenue annualised, so the column compares with annual filers.
    revenue: latest.revenueUsdMn === null ? null : latest.revenueUsdMn * 1e6 * 4,
    operatingMargin: latest.operatingMarginPct,
    netMargin: latest.netMarginPct,
    revenueGrowthPct: growth,
    lastFiled: ir?.provenance.retrievedAt.slice(0, 10) ?? null,
    source: "ir",
  };
}

export async function GET() {
  const res = await cached("sector:fundamentals", TTL_MS, async () => {
    // Four lanes with a short stagger. The regulator permits ten requests a
    // second; serialising fifty six companies took thirty eight seconds, which
    // is the whole page's cold load. This stays well inside the limit and
    // brings it under ten.
    const rows: SectorRow[] = [];
    const queue = [...UNIVERSE];
    let cursor = 0;

    async function lane(offset: number) {
      await new Promise((r) => setTimeout(r, offset * SPACING_MS));
      for (;;) {
        const i = cursor++;
        if (i >= queue.length) return;
        try {
          rows.push(await buildRow(queue[i]));
        } catch {
          // One unresolvable name must not empty the sector view.
        }
        await new Promise((r) => setTimeout(r, SPACING_MS));
      }
    }

    await Promise.all([0, 1, 2, 3].map(lane));

    // Restore universe order, which the lanes do not preserve.
    const order = new Map(UNIVERSE.map((c, i) => [c.symbol, i]));
    rows.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
    return rows;
  });

  const rows = res.value;
  const withData = rows.filter((r) => r.revenue !== null);

  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // Subsector aggregates: total revenue and median margin.
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

  // Theme aggregates on fundamentals, not on the day's price move.
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
      coverage: { total: rows.length, withData: withData.length },
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
