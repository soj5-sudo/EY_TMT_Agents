/**
 * Layer 2: compute.
 *
 * Resolves a parsed question against the statement model and returns numbers,
 * not passages. This is what separates the assistant from a search box: asked
 * for NVIDIA's operating margin it computes the ratio from the filed statement
 * for the period where both lines exist, rather than finding a sentence that
 * mentions margins.
 *
 * Every value carries the period it covers and the source it came from, and a
 * measure the filer does not report returns null rather than a guess.
 */

import { annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { getIrHistory } from "@/lib/feeds/ir";
import type { Company } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";
import type { MetricDef, MetricKey } from "@/lib/brain/intent";

export interface MetricValue {
  company: Company;
  metric: MetricDef;
  value: number | null;
  /** Reporting period the value covers. */
  period: string | null;
  /** Plain reading of what the number indicates, from the statement model. */
  reading: string | null;
  provenance: Provenance | null;
  /** Set when the measure could not be produced, explaining why. */
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
  /** Compound annual rate where the span supports one. */
  cagrPct: number | null;
  spanYears: number | null;
  provenance: Provenance | null;
  unavailable: string | null;
}

/** Ratio labels in the statement model, keyed by our metric vocabulary. */
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

/* ---------------------------------------------------------------- *
 * Single company, single measure
 * ---------------------------------------------------------------- */

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

  // Companies outside the SEC register report through their own documents.
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

/** Measures for companies that publish through investor relations. */
async function computeFromIr(
  company: Company,
  metric: MetricDef,
  base: MetricValue,
): Promise<MetricValue> {
  const ir = await getIrHistory(company.symbol, 8).catch(() => null);
  const quarters = ir?.data.quarters ?? [];
  if (quarters.length === 0) {
    return {
      ...base,
      unavailable: `No published quarterly document could be read for ${company.short}.`,
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

/* ---------------------------------------------------------------- *
 * Trend
 * ---------------------------------------------------------------- */

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
    const ir = await getIrHistory(company.symbol, 8).catch(() => null);
    const quarters = ir?.data.quarters ?? [];
    if (quarters.length === 0) {
      return { ...base, unavailable: `No published documents could be read for ${company.short}.` };
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
  for (const y of rev) {
    let v: number | null = null;
    if (metric.key === "revenue") v = y.value;
    else if (metric.key === "operatingMargin") {
      const op = at("operatingIncome", y.end);
      v = op !== null && y.value > 0 ? (op / y.value) * 100 : null;
    } else if (metric.key === "netMargin") {
      const ni = at("netIncome", y.end);
      v = ni !== null && y.value > 0 ? (ni / y.value) * 100 : null;
    } else if (metric.key === "rndIntensity") {
      const rd = at("rnd", y.end);
      v = rd !== null && y.value > 0 ? (rd / y.value) * 100 : null;
    } else if (metric.key === "grossMargin") {
      const gp = at("grossProfit", y.end) ?? (at("costOfRevenue", y.end) !== null ? y.value - at("costOfRevenue", y.end)! : null);
      v = gp !== null && y.value > 0 ? (gp / y.value) * 100 : null;
    }
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

/* ---------------------------------------------------------------- *
 * Cohort ranking
 * ---------------------------------------------------------------- */

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
      // A single unresolvable name must not fail the ranking.
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out.filter((v) => v.value !== null);
}
