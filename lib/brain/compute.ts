import { annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { getIrHistory } from "@/lib/feeds/ir";
import { ledgerFor, seriesFor } from "@/lib/brain/ledger";
import type { Company } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";
import type { MetricDef, MetricKey } from "@/lib/brain/intent";

export interface MetricValue {
  company: Company;
  metric: MetricDef;
  value: number | null;
  period: string | null;
  reading: string | null;
  provenance: Provenance | null;
  unavailable: string | null;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface TrendResult {
  company: Company;
  metric: MetricDef;
  points: TrendPoint[];
  cagrPct: number | null;
  spanYears: number | null;
  provenance: Provenance | null;
  unavailable: string | null;
}

const RATIO_LABEL: Partial<Record<MetricKey, string>> = {
  grossMargin: "Gross margin",
  operatingMargin: "Operating margin",
  netMargin: "Net margin",
  rndIntensity: "Research intensity",
  cashConversion: "Cash conversion",
  freeCashMargin: "Free cash margin",
  receivableDays: "Receivable days",
  returnOnEquity: "Return on equity",
  shareBasedComp: "Share-based comp",
};

export async function computeMetric(
  company: Company,
  metric: MetricDef,
): Promise<MetricValue> {
  const base: MetricValue = {
    company,
    metric,
    value: null,
    period: null,
    reading: null,
    provenance: null,
    unavailable: null,
  };

  if (!company.secFiler) {
    return computeFromIr(company, metric, base);
  }

  const sec = await resolveCik(company.symbol).catch(() => null);
  if (!sec) {
    return { ...base, unavailable: `${company.short} is not in the SEC register.` };
  }

  const statements = await getStatements(sec.cik);
  const { period, ratios } = annualRatios(statements.data);

  const ratioLabel = RATIO_LABEL[metric.key];
  if (ratioLabel) {
    const hit = ratios.find((r) => r.label === ratioLabel);
    if (!hit || hit.value === null) {
      return {
        ...base,
        period,
        provenance: statements.provenance,
        unavailable: `${company.short} does not report ${metric.label.toLowerCase()} in a form that can be computed for ${period ?? "the latest period"}.`,
      };
    }
    return {
      ...base,
      value: hit.value,
      period,
      reading: hit.reading,
      provenance: statements.provenance,
    };
  }

  if (metric.key === "revenue") {
    const rev = statements.data.lines.revenue?.annual.at(-1);
    return rev
      ? { ...base, value: rev.value, period: rev.label, provenance: statements.provenance }
      : { ...base, unavailable: `No revenue is tagged for ${company.short}.` };
  }

  if (metric.key === "revenueGrowth") {
    const series = statements.data.lines.revenue?.annual ?? [];
    if (series.length < 2) {
      return { ...base, unavailable: `Fewer than two annual periods are on file for ${company.short}.` };
    }
    const first = series[0].value;
    const last = series.at(-1)!.value;
    const years = series.length - 1;
    const cagr = first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null;
    return {
      ...base,
      value: cagr,
      period: `${series[0].label} to ${series.at(-1)!.label}`,
      reading:
        cagr === null
          ? null
          : cagr >= 15
            ? "Growing well above the sector norm."
            : cagr >= 5
              ? "Growing steadily."
              : cagr >= 0
                ? "Broadly flat; the case rests on margin or multiple, not the top line."
                : "Contracting.",
      provenance: statements.provenance,
    };
  }

  return {
    ...base,
    unavailable: `${metric.label} is not carried in the regulatory statements; it comes from company disclosures instead.`,
  };
}

async function computeFromIr(
  company: Company,
  metric: MetricDef,
  base: MetricValue,
): Promise<MetricValue> {
  const fromLedger = await ledgerFor(company).catch(() => null);
  if (fromLedger?.ledger) {
    const series = seriesFor(fromLedger.ledger, metric.key);
    const last = series.at(-1);
    if (last) {
      return {
        ...base,
        value: last.value,
        period: last.label,
        provenance: fromLedger.provenance,
      };
    }
  }

  const ir = await getIrHistory(company.symbol, 8).catch(() => null);
  const quarters = ir?.data.quarters ?? [];
  if (quarters.length === 0) {
    return {
      ...base,
      provenance: fromLedger?.provenance ?? null,
      unavailable:
        fromLedger?.ledger
          ? `${company.short} publishes results files, but none of them states ${metric.label.toLowerCase()}.`
          : `No published results file could be read for ${company.short}.`,
    };
  }

  const latest = quarters[quarters.length - 1];
  const prov = ir!.provenance;

  const direct: Partial<Record<MetricKey, number | null>> = {
    operatingMargin: latest.operatingMarginPct,
    netMargin: latest.netMarginPct,
    attrition: latest.attritionLtmPct,
    headcount: latest.headcount,
    revenue: latest.revenueUsdMn === null ? null : latest.revenueUsdMn * 1e6,
  };

  if (metric.key in direct) {
    const v = direct[metric.key] ?? null;
    return v === null
      ? {
          ...base,
          period: latest.label,
          provenance: prov,
          unavailable: `${company.short} did not report ${metric.label.toLowerCase()} in the ${latest.label} document.`,
        }
      : { ...base, value: v, period: latest.label, provenance: prov };
  }

  if (metric.key === "revenueGrowth") {
    const withRev = quarters.filter((q) => q.revenueUsdMn !== null);
    if (withRev.length < 2) {
      return { ...base, provenance: prov, unavailable: `Too few periods to compute growth for ${company.short}.` };
    }
    const first = withRev[0].revenueUsdMn!;
    const last = withRev.at(-1)!.revenueUsdMn!;
    const years = (withRev.length - 1) * 0.25;
    const cagr = first > 0 && years > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : null;
    return {
      ...base,
      value: cagr,
      period: `${withRev[0].label} to ${withRev.at(-1)!.label}`,
      reading:
        cagr === null
          ? null
          : "Computed from the dollar series the company publishes, which strips the currency effect present in its rupee reporting.",
      provenance: prov,
    };
  }

  return {
    ...base,
    period: latest.label,
    provenance: prov,
    unavailable: `${metric.label} is not carried in ${company.short}'s published quarterly documents.`,
  };
}

function metricAtYear(
  key: MetricKey,
  at: (line: string, end: string) => number | null,
  end: string,
  revenue: number,
  priorRevenue: number | null,
): number | null {
  const usable = (d: number | null) =>
    d !== null && Number.isFinite(d) && d !== 0 && Math.abs(d) >= Math.abs(revenue) * 0.02;

  const over = (numerator: number | null, denominator: number | null, scale: number) =>
    numerator !== null && usable(denominator) ? (numerator / denominator!) * scale : null;

  switch (key) {
    case "revenue":
      return revenue;

    case "revenueGrowth":
      return priorRevenue !== null && priorRevenue > 0
        ? ((revenue - priorRevenue) / priorRevenue) * 100
        : null;

    case "grossMargin": {
      const cost = at("costOfRevenue", end);
      const gross = at("grossProfit", end) ?? (cost !== null ? revenue - cost : null);
      return over(gross, revenue, 100);
    }

    case "operatingMargin":
      return over(at("operatingIncome", end), revenue, 100);

    case "netMargin":
      return over(at("netIncome", end), revenue, 100);

    case "rndIntensity":
      return over(at("rnd", end), revenue, 100);

    case "shareBasedComp":
      return over(at("shareBasedComp", end), revenue, 100);

    case "cashConversion":
      return over(at("operatingCashFlow", end), at("netIncome", end), 100);

    case "freeCashMargin": {
      const ocf = at("operatingCashFlow", end);
      const capex = at("capex", end);
      if (ocf === null) return null;
      return over(ocf - Math.abs(capex ?? 0), revenue, 100);
    }

    case "receivableDays":
      return over(at("receivables", end), revenue, 365);

    case "returnOnEquity":
      return over(at("netIncome", end), at("equity", end), 100);

    case "headcount":
    case "attrition":
      return null;

    default:
      return null;
  }
}

export async function computeTrend(
  company: Company,
  metric: MetricDef,
): Promise<TrendResult> {
  const base: TrendResult = {
    company,
    metric,
    points: [],
    cagrPct: null,
    spanYears: null,
    provenance: null,
    unavailable: null,
  };

  if (!company.secFiler) {
    const fromLedger = await ledgerFor(company).catch(() => null);
    if (fromLedger?.ledger) {
      const series = seriesFor(fromLedger.ledger, metric.key);
      if (series.length >= 2) {
        const span = series.length - 1;
        const cagr =
          metric.unit === "USD" && series[0].value > 0
            ? (Math.pow(series.at(-1)!.value / series[0].value, 1 / span) - 1) * 100
            : null;
        return {
          ...base,
          points: series,
          cagrPct: cagr,
          spanYears: span,
          provenance: fromLedger.provenance,
        };
      }
    }

    const ir = await getIrHistory(company.symbol, 8).catch(() => null);
    const quarters = ir?.data.quarters ?? [];
    if (quarters.length === 0) {
      return {
        ...base,
        provenance: fromLedger?.provenance ?? null,
        unavailable: `No published documents could be read for ${company.short}.`,
      };
    }
    const pick = (q: (typeof quarters)[number]): number | null =>
      metric.key === "revenue"
        ? q.revenueUsdMn === null ? null : q.revenueUsdMn * 1e6
        : metric.key === "operatingMargin"
          ? q.operatingMarginPct
          : metric.key === "netMargin"
            ? q.netMarginPct
            : metric.key === "headcount"
              ? q.headcount
              : metric.key === "attrition"
                ? q.attritionLtmPct
                : null;

    const points = quarters
      .map((q) => ({ label: q.label, value: pick(q) }))
      .filter((p): p is TrendPoint => p.value !== null);

    if (points.length < 2) {
      return { ...base, provenance: ir!.provenance, unavailable: `${company.short} does not publish ${metric.label.toLowerCase()} across enough periods.` };
    }
    const span = (points.length - 1) * 0.25;
    const cagr =
      metric.unit === "USD" && points[0].value > 0
        ? (Math.pow(points.at(-1)!.value / points[0].value, 1 / span) - 1) * 100
        : null;
    return { ...base, points, cagrPct: cagr, spanYears: span, provenance: ir!.provenance };
  }

  const sec = await resolveCik(company.symbol).catch(() => null);
  if (!sec) return { ...base, unavailable: `${company.short} is not in the SEC register.` };

  const statements = await getStatements(sec.cik);
  const rev = statements.data.lines.revenue?.annual ?? [];
  if (rev.length < 2) {
    return { ...base, provenance: statements.provenance, unavailable: `Fewer than two annual periods are on file for ${company.short}.` };
  }

  const at = (key: string, end: string) =>
    statements.data.lines[key]?.annual.find((p) => p.end === end)?.value ?? null;

  const points: TrendPoint[] = [];
  for (let i = 0; i < rev.length; i++) {
    const y = rev[i];
    const prior = i > 0 ? rev[i - 1] : null;
    const v = metricAtYear(metric.key, at, y.end, y.value, prior?.value ?? null);
    if (v !== null) points.push({ label: y.label, value: v });
  }

  if (points.length < 2) {
    return {
      ...base,
      provenance: statements.provenance,
      unavailable: `${company.short} does not tag ${metric.label.toLowerCase()} across enough annual periods.`,
    };
  }

  const span = points.length - 1;
  const cagr =
    metric.unit === "USD" && points[0].value > 0
      ? (Math.pow(points.at(-1)!.value / points[0].value, 1 / span) - 1) * 100
      : null;

  return { ...base, points, cagrPct: cagr, spanYears: span, provenance: statements.provenance };
}

export async function computeRanking(
  cohort: Company[],
  metric: MetricDef,
  limit = 8,
): Promise<MetricValue[]> {
  const out: MetricValue[] = [];
  for (const c of cohort.slice(0, limit)) {
    try {
      out.push(await computeMetric(c, metric));
    } catch {
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out.filter((v) => v.value !== null);
}
