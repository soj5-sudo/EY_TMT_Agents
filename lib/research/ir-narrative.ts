import type { IrMetric, IrUnit } from "@/lib/research/ir-scrape";

/**
 * Figures stated in a sentence rather than a table.
 *
 * Mid-cap results releases often carry no grid at all: the quarter is written
 * out in prose, one figure per bullet. This reads those bullets. A figure is
 * only taken when the sentence names the period, names the measure, and puts a
 * currency and a scale against the number, so nothing here rests on a guess.
 */

interface Hit {
  label: string;
  period: string;
  value: number;
  currency: string;
  scale: number;
  sentence: string;
}

const MEASURES: Array<[string, RegExp]> = [
  ["Revenue", /\brevenues?\b/gi],
  ["Net profit", /\b(?:net profit|profit after tax|PAT)\b/gi],
  ["Profit before tax", /\b(?:profit before tax|PBT)\b/gi],
  ["Operating income", /\b(?:operating (?:profit|income)|EBIT)\b/gi],
  ["Cash and cash equivalents", /\bcash (?:and|&) (?:cash )?(?:equivalents|investments)\b/gi],
  ["Order book", /\b(?:order ?book|order intake|order bookings?|total contract value|TCV)\b/gi],
];

const HEADCOUNT = /\b(?:headcount|total employees|employee (?:base|strength))\b/gi;

const MONEY =
  /(US\$|\$|₹|Rs\.?|INR|USD|EUR|€|GBP|£)\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million|billion|crore|lakh|Mn|mn|bn|cr|M|B)?\b/i;

const COUNT = /\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\b/;

const CURRENCY: Array<[RegExp, string]> = [
  [/^(?:US\$|\$|USD)$/i, "USD"],
  [/^(?:₹|Rs\.?|INR)$/i, "INR"],
  [/^(?:€|EUR)$/i, "EUR"],
  [/^(?:£|GBP)$/i, "GBP"],
];

const SCALE: Array<[RegExp, number]> = [
  [/^(?:billion|bn|B)$/i, 1e9],
  [/^(?:million|Mn|mn|M)$/i, 1e6],
  [/^(?:crore|cr)$/i, 1e7],
  [/^lakh$/i, 1e5],
];

function currencyOf(raw: string): string | null {
  for (const [re, code] of CURRENCY) if (re.test(raw.trim())) return code;
  return null;
}

function scaleOf(raw: string | undefined): number | null {
  if (!raw) return null;
  for (const [re, mult] of SCALE) if (re.test(raw.trim())) return mult;
  return null;
}

function periodsIn(sentence: string): Array<{ at: number; label: string }> {
  const out: Array<{ at: number; label: string }> = [];

  for (const m of sentence.matchAll(/\bQ([1-4])\s?[-']?\s?FY\s?['-]?\s?(\d{2,4})\b/gi)) {
    out.push({ at: m.index ?? 0, label: `Q${m[1]} FY${m[2]}` });
  }
  for (const m of sentence.matchAll(/\b([1-4])Q\s?FY\s?(\d{2,4})\b/gi)) {
    out.push({ at: m.index ?? 0, label: `Q${m[1]} FY${m[2]}` });
  }
  for (const m of sentence.matchAll(/\bFY\s?['-]?\s?(\d{2,4})\b/gi)) {
    const at = m.index ?? 0;
    if (out.some((p) => Math.abs(p.at - at) < 8)) continue;
    out.push({ at, label: `FY${m[1]}` });
  }

  return out.sort((a, b) => a.at - b.at);
}

function nearestPeriod(periods: Array<{ at: number; label: string }>, at: number): string | null {
  if (periods.length === 0) return null;
  let best = periods[0];
  for (const p of periods) {
    if (Math.abs(p.at - at) < Math.abs(best.at - at)) best = p;
  }
  return best.label;
}

/**
 * A layout engine sometimes strands one or two letters at the end of a line,
 * so "net cash" arrives as "net c" then "ash". A stranded fragment is welded
 * back on; an ordinary wrap keeps its space.
 */
function weld(lines: string[]): string {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    out += lines[i];
    if (i === lines.length - 1) break;
    const stranded = /\b[a-z]{1,2}$/.test(lines[i]) && /^[a-z]/.test(lines[i + 1]);
    out += stranded ? "" : " ";
  }
  return out;
}

function sentences(text: string): string[] {
  return weld(
    text
      .replace(/\r/g, "")
      .replace(/[•▪]/g, "\n• ")
      .split("\n")
      .map((l) => l.trim()),
  )
    .replace(/\s{2,}/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(“"'•])|\s•\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 600);
}

export function parseNarrativeMetrics(text: string): IrMetric[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences(text)) {
    const periods = periodsIn(sentence);
    if (periods.length === 0) continue;

    for (const [label, re] of MEASURES) {
      re.lastIndex = 0;
      for (const m of sentence.matchAll(re)) {
        const at = (m.index ?? 0) + m[0].length;
        const window = sentence.slice(at, at + 70);
        if (/^\s*(?:growth|decline|grew|declined|increase|decrease|of\s+\d+(?:\.\d+)?%)/i.test(window)) continue;

        const money = window.match(MONEY);
        if (!money || money.index === undefined) continue;
        if (window.slice(0, money.index).length > 34) continue;

        const currency = currencyOf(money[1]);
        const scale = scaleOf(money[3]);
        if (!currency || scale === null) continue;

        const value = Number(money[2].replace(/,/g, ""));
        if (!Number.isFinite(value) || value <= 0) continue;

        const period = nearestPeriod(periods, m.index ?? 0);
        if (!period) continue;

        const key = `${label}|${period}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ label, period, value, currency, scale, sentence: sentence.slice(0, 200) });
      }
    }

    HEADCOUNT.lastIndex = 0;
    for (const m of sentence.matchAll(HEADCOUNT)) {
      const at = (m.index ?? 0) + m[0].length;
      const window = sentence.slice(at, at + 40);
      const count = window.match(COUNT);
      if (!count) continue;
      const value = Number(count[1].replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 100 || value > 3e6) continue;
      const period = nearestPeriod(periods, m.index ?? 0);
      if (!period) continue;
      const key = `Total headcount|${period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        label: "Total headcount",
        period,
        value,
        currency: "count",
        scale: 1,
        sentence: sentence.slice(0, 200),
      });
    }
  }

  const byLabel = new Map<string, Hit[]>();
  for (const h of hits) byLabel.set(h.label, [...(byLabel.get(h.label) ?? []), h]);

  const metrics: IrMetric[] = [];
  for (const [label, group] of byLabel) {
    const votes = new Map<string, number>();
    for (const h of group) {
      const k = `${h.currency}|${h.scale}`;
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const kept = group.filter((h) => `${h.currency}|${h.scale}` === winner);
    const [currency, scaleRaw] = winner.split("|");

    const unit: IrUnit | null =
      currency === "count"
        ? null
        : {
            currency,
            scale: Number(scaleRaw),
            scaleStated: true,
            source: kept[0].sentence,
          };

    metrics.push({
      label,
      values: kept.map((h) => ({ period: h.period, value: h.value })),
      unit,
      unitFromLabel: true,
      derivedFrom: "stated in the results release",
    });
  }

  return metrics;
}
