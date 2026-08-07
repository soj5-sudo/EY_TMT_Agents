import { annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { getIrHistory } from "@/lib/feeds/ir";
import type { FactKey } from "@/lib/research/facts";
import { ledgerFor } from "@/lib/brain/ledger";
import { UNIVERSE, type Theme } from "@/lib/data/universe";
import { cached } from "@/lib/core/cache";

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
  coverageNote?: string;
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
    coverageNote: c.coverageNote,
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

  const built = await ledgerFor(c).catch(() => null);
  const ledger = built?.ledger ?? null;
  const revenueLine = ledger?.series.revenue;

  if (ledger && revenueLine) {
    const annual = revenueLine.annual;
    const quarterly = revenueLine.quarterly;
    // Whichever basis reaches furthest forward. A company that has reported a
    // quarter since its last full year is shown on that quarter.
    const newestAnnual = annual.at(-1)?.end ?? "";
    const newestQuarter = quarterly.at(-1)?.end ?? "";
    const useAnnual = annual.length > 0 && newestAnnual >= newestQuarter;

    const revenue = useAnnual
      ? (annual.at(-1)?.value ?? null)
      : quarterly.at(-1)
        ? quarterly.at(-1)!.value * 4
        : null;

    const denominator = (useAnnual ? annual.at(-1)?.value : quarterly.at(-1)?.value) ?? null;
    const pctOf = (k: FactKey): number | null => {
      const line = ledger.series[k];
      if (!line || denominator === null || denominator === 0) return null;
      const v = useAnnual ? line.annual.at(-1)?.value : line.quarterly.at(-1)?.value;
      if (v === undefined || v === null) return null;
      return (v / denominator) * 100;
    };

    const basis = useAnnual && annual.length >= 2 ? annual : quarterly;
    let growth: number | null = null;
    if (basis.length >= 2) {
      const first = basis[0];
      const last = basis[basis.length - 1];
      // Measured on the calendar rather than on the number of points, so a
      // series that skips a quarter is not read as though it grew that fast.
      const years = (Date.parse(last.end) - Date.parse(first.end)) / (365.25 * 86_400_000);
      if (first.value > 0 && years >= 0.75) {
        growth = (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
      } else if (first.value > 0 && years > 0) {
        growth = ((last.value - first.value) / first.value) * 100;
      }
    }

    return {
      ...base,
      period: (useAnnual ? annual.at(-1) : quarterly.at(-1))?.label ?? null,
      revenue,
      operatingMargin: pctOf("operatingIncome"),
      netMargin: pctOf("netIncome"),
      grossMargin: pctOf("grossProfit"),
      rndIntensity: pctOf("rnd"),
      revenueGrowthPct: growth,
      lastFiled: (built?.provenance?.sourceDatedAt ?? built?.provenance?.retrievedAt ?? "").slice(0, 10) || null,
      source: "ir",
    };
  }

  const ir = await getIrHistory(c.symbol, 8).catch(() => null);
  const qs = ir?.data.quarters ?? [];
  if (qs.length === 0) return base;

  const latest = qs[qs.length - 1];
  const withRev = qs.filter((q) => q.revenueUsdMn !== null);
  let growth: number | null = null;
  if (withRev.length >= 2) {
    const first = withRev[0].revenueUsdMn!;
    const years = (withRev.length - 1) * 0.25;
    if (first > 0 && years >= 0.75) {
      growth = (Math.pow(withRev.at(-1)!.revenueUsdMn! / first, 1 / years) - 1) * 100;
    }
  }

  return {
    ...base,
    period: latest.label,
    revenue: latest.revenueUsdMn === null ? null : latest.revenueUsdMn * 1e6 * 4,
    operatingMargin: latest.operatingMarginPct,
    netMargin: latest.netMarginPct,
    revenueGrowthPct: growth,
    lastFiled: ir?.provenance.retrievedAt.slice(0, 10) ?? null,
    source: "ir",
  };
}


/**
 * Every company in the universe, on its own reported figures. One computation
 * shared by every panel that needs it, so two panels can never disagree.
 */
export async function sectorRows(): Promise<{ rows: SectorRow[]; storedAt: number }> {
  const res = await cached("sector:fundamentals", TTL_MS, async () => {
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
        }
        await new Promise((r) => setTimeout(r, SPACING_MS));
      }
    }

    await Promise.all([0, 1, 2, 3].map(lane));

    const order = new Map(UNIVERSE.map((c, i) => [c.symbol, i]));
    rows.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
    return rows;
  });

  return { rows: res.value, storedAt: res.storedAt };
}
