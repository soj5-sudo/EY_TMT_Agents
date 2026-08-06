import { parseQuestion, METRICS, type MetricDef, type ParsedQuestion } from "@/lib/brain/intent";
import {
  computeMetric,
  computeRanking,
  computeTrend,
  type MetricValue,
  type TrendResult,
} from "@/lib/brain/compute";
import { UNIVERSE, type Company } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";

export interface BrainAnswer {
  text: string;
  method: "computed" | "retrieved" | "none";
  sources: Provenance[];
  table: Array<{ label: string; value: string; note?: string }> | null;
}

function fmt(v: number, m: MetricDef): string {
  if (m.unit === "USD") {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)} billion US dollars`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(0)} million US dollars`;
    return `${v.toLocaleString("en-US")} US dollars`;
  }
  if (m.unit === "days") return `${v.toFixed(0)} days`;
  if (m.unit === "count") return v.toLocaleString("en-US");
  return `${v.toFixed(1)} percent`;
}

function short(v: number, m: MetricDef): string {
  if (m.unit === "USD") {
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(0)}m`;
    return v.toLocaleString("en-US");
  }
  if (m.unit === "days") return `${v.toFixed(0)} days`;
  if (m.unit === "count") return v.toLocaleString("en-US");
  return `${v.toFixed(1)}%`;
}

function dedupeSources(list: Array<Provenance | null>): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const p of list) {
    if (!p) continue;
    const key = `${p.kind}|${p.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function composeMetric(values: MetricValue[]): BrainAnswer {
  const usable = values.filter((v) => v.value !== null);
  const missing = values.filter((v) => v.value === null);

  if (usable.length === 0) {
    return {
      text:
        missing.map((m) => m.unavailable).filter(Boolean).join(" ") ||
        "That measure could not be computed from the filed record.",
      method: "none",
      sources: dedupeSources(values.map((v) => v.provenance)),
      table: null,
    };
  }

  const lines = usable.map((v) => {
    const head = `${v.company.name} reported ${v.metric.label.toLowerCase()} of ${fmt(v.value!, v.metric)}${v.period ? ` for ${v.period}` : ""}.`;
    return v.reading ? `${head} ${v.reading}` : head;
  });

  if (missing.length > 0) {
    lines.push(missing.map((m) => m.unavailable).filter(Boolean).join(" "));
  }

  return {
    text: lines.join(" "),
    method: "computed",
    sources: dedupeSources(values.map((v) => v.provenance)),
    table: usable.map((v) => ({
      label: `${v.company.short} · ${v.metric.label}`,
      value: short(v.value!, v.metric),
      note: v.period ?? undefined,
    })),
  };
}

function composeCompare(values: MetricValue[], metric: MetricDef): BrainAnswer {
  const usable = values.filter((v) => v.value !== null);
  if (usable.length < 2) return composeMetric(values);

  const sorted = [...usable].sort((a, b) =>
    metric.betterHigh === false ? a.value! - b.value! : b.value! - a.value!,
  );
  const lead = sorted[0];
  const last = sorted[sorted.length - 1];
  const gap = Math.abs(lead.value! - last.value!);

  const listing = sorted
    .map((v) => `${v.company.short} at ${fmt(v.value!, v.metric)}${v.period ? ` (${v.period})` : ""}`)
    .join(", ");

  const direction =
    metric.betterHigh === null
      ? `${lead.company.short} runs the higher figure`
      : `${lead.company.short} leads`;

  const spread =
    metric.unit === "%"
      ? `${gap.toFixed(1)} percentage points`
      : metric.unit === "USD"
        ? fmt(gap, metric)
        : `${gap.toFixed(0)}`;

  return {
    text:
      `On ${metric.label.toLowerCase()}: ${listing}. ${direction}, ahead of ${last.company.short} by ${spread}. ` +
      (metric.betterHigh === null
        ? "Direction is not a judgement for this measure; read it against what each business is buying with the spend."
        : "Both figures come from the same source and the same rules, so the comparison holds.") +
      (usable.some((v) => v.period !== sorted[0].period)
        ? " The periods differ, which is normal where fiscal years do not align, and the comparison should be read with that in mind."
        : ""),
    method: "computed",
    sources: dedupeSources(values.map((v) => v.provenance)),
    table: sorted.map((v) => ({
      label: v.company.short,
      value: short(v.value!, v.metric),
      note: v.period ?? undefined,
    })),
  };
}

function composeRank(values: MetricValue[], metric: MetricDef, want: "best" | "worst" | null): BrainAnswer {
  if (values.length === 0) {
    return {
      text: `No company in that cohort reports ${metric.label.toLowerCase()} in a form that can be computed.`,
      method: "none",
      sources: [],
      table: null,
    };
  }

  const highFirst = metric.betterHigh !== false;
  const sorted = [...values].sort((a, b) => (highFirst ? b.value! - a.value! : a.value! - b.value!));
  const top = want === "worst" ? sorted[sorted.length - 1] : sorted[0];

  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    text:
      `Across ${sorted.length} names, ${top.company.name} ${want === "worst" ? "sits lowest" : "leads"} on ${metric.label.toLowerCase()} at ${fmt(top.value!, top.metric)}${top.period ? ` for ${top.period}` : ""}. ` +
      `The cohort median is ${fmt(median.value!, metric)}. ` +
      `Every figure is computed from the same concept tags and the same period-matching rule, so the ranking is like for like.`,
    method: "computed",
    sources: dedupeSources(values.map((v) => v.provenance)),
    table: sorted.map((v) => ({
      label: v.company.short,
      value: short(v.value!, v.metric),
      note: v.period ?? undefined,
    })),
  };
}

function composeTrend(t: TrendResult): BrainAnswer {
  if (t.unavailable || t.points.length < 2) {
    return {
      text: t.unavailable ?? "There are not enough periods on file to describe a trend.",
      method: "none",
      sources: dedupeSources([t.provenance]),
      table: null,
    };
  }

  const first = t.points[0];
  const last = t.points[t.points.length - 1];
  const change = last.value - first.value;
  const rising = change > 0;

  let biggest = { from: t.points[0], to: t.points[1], delta: t.points[1].value - t.points[0].value };
  for (let i = 1; i < t.points.length - 1; i++) {
    const d = t.points[i + 1].value - t.points[i].value;
    if (Math.abs(d) > Math.abs(biggest.delta)) {
      biggest = { from: t.points[i], to: t.points[i + 1], delta: d };
    }
  }

  const movement =
    t.metric.unit === "%"
      ? `${Math.abs(change).toFixed(1)} percentage points`
      : t.metric.unit === "USD"
        ? fmt(Math.abs(change), t.metric)
        : t.metric.unit === "days"
          ? `${Math.abs(change).toFixed(0)} day${Math.abs(change) < 1.5 ? "" : "s"}`
          : `${Math.round(Math.abs(change)).toLocaleString("en-US")}`;

  return {
    text:
      `${t.company.name} moved from ${fmt(first.value, t.metric)} in ${first.label} to ${fmt(last.value, t.metric)} in ${last.label}, ` +
      `${rising ? "up" : "down"} ${movement} across ${t.points.length} periods` +
      (t.cagrPct !== null && t.spanYears
        ? `, a compound annual rate of ${t.cagrPct.toFixed(1)} percent over ${t.spanYears} years` : "") +
      `. The largest single move was ${biggest.delta >= 0 ? "up" : "down"} ` +
      `${
        t.metric.unit === "%"
          ? `${Math.abs(biggest.delta).toFixed(1)} points`
          : t.metric.unit === "days"
            ? `${Math.abs(biggest.delta).toFixed(0)} days`
            : short(Math.abs(biggest.delta), t.metric)
      } ` +
      `between ${biggest.from.label} and ${biggest.to.label}.`,
    method: "computed",
    sources: dedupeSources([t.provenance]),
    table: t.points.map((p) => ({ label: p.label, value: short(p.value, t.metric) })),
  };
}

const DEFAULT_METRIC = METRICS.find((m) => m.key === "operatingMargin")!;

function cohortFor(parsed: ParsedQuestion): Company[] {
  if (parsed.subsector) {
    return UNIVERSE.filter((c) => c.subsector.toLowerCase() === parsed.subsector!.toLowerCase());
  }
  if (parsed.companies.length > 0) {
    const sub = parsed.companies[0].subsector;
    return UNIVERSE.filter((c) => c.subsector === sub);
  }
  return UNIVERSE.filter((c) => c.subsector === "IT services");
}

export async function computeAnswer(question: string): Promise<BrainAnswer | null> {
  const parsed = parseQuestion(question);

  if (parsed.intent === "product" || parsed.intent === "unknown") return null;

  const metric = parsed.metrics[0] ?? DEFAULT_METRIC;

  try {
    if (parsed.intent === "rank") {
      const values = await computeRanking(cohortFor(parsed), metric);
      return composeRank(values, metric, parsed.superlative);
    }

    if (parsed.intent === "compare" && parsed.companies.length >= 2) {
      const values = await Promise.all(
        parsed.companies.slice(0, 4).map((c) => computeMetric(c, metric)),
      );
      return composeCompare(values, metric);
    }

    if (parsed.intent === "trend" && parsed.companies.length > 0) {
      return composeTrend(await computeTrend(parsed.companies[0], metric));
    }

    if (parsed.companies.length > 0 && parsed.metrics.length > 0) {
      const values: MetricValue[] = [];
      for (const c of parsed.companies.slice(0, 3)) {
        for (const m of parsed.metrics.slice(0, 3)) {
          values.push(await computeMetric(c, m));
        }
      }
      return composeMetric(values);
    }
  } catch {
    return null;
  }

  return null;
}
