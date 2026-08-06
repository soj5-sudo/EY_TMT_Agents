import { INTENT_MODEL } from "@/lib/brain/intent-model";

export type Intent =
  | "metric"
  | "compare"
  | "rank"
  | "trend"
  | "explain"
  | "product"
  | "unknown";

export interface IntentModel {
  labels: string[];
  vocab: Record<string, number>;
  weights: number[][];
  bias: number[];
  meta: {
    trainedAt: string;
    trainingExamples: number;
    heldOutExamples: number;
    heldOutAccuracy: number;
    baselineAccuracy: number;
    combinedAccuracy: number;
    confidenceFloor: number;
    features: number;
    epochs: number;
  };
}

export interface Structure {
  companies: number;
  metrics: number;
}

const PUNCT = /[^\p{L}\p{N}\s<>]/gu;

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(PUNCT, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function features(text: string, s: Structure): string[] {
  const out: string[] = [];
  const words = tokenise(text);

  for (const w of words) out.push(`w:${w}`);
  for (let i = 0; i + 1 < words.length; i++) out.push(`b:${words[i]}_${words[i + 1]}`);

  for (const w of words) {
    if (w.startsWith("<")) continue;
    const padded = `^${w}$`;
    for (let n = 3; n <= 5; n++) {
      if (padded.length < n) break;
      for (let i = 0; i + n <= padded.length; i++) out.push(`c:${padded.slice(i, i + n)}`);
    }
  }

  if (words[0]) out.push(`first:${words[0]}`);
  if (words[1]) out.push(`first2:${words[0]}_${words[1]}`);

  out.push(`nco:${Math.min(s.companies, 3)}`);
  out.push(`nmet:${Math.min(s.metrics, 3)}`);
  if (s.companies >= 2) out.push("multi_company");
  if (s.companies === 0) out.push("no_company");
  if (s.metrics === 0) out.push("no_metric");
  if (/\?\s*$/.test(text)) out.push("qmark");
  if (words.length <= 4) out.push("short");
  if (words.length >= 12) out.push("long");

  return out;
}

export interface Prediction {
  intent: Intent;
  confidence: number;
  scores: Array<{ intent: Intent; p: number }>;
}

function softmax(z: number[]): number[] {
  const max = Math.max(...z);
  const exp = z.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

export function classifyIntent(
  text: string,
  structure: Structure,
  model: IntentModel = INTENT_MODEL as IntentModel,
): Prediction | null {
  if (!model?.labels?.length) return null;

  const feats = features(text, structure);
  const z = model.bias.slice();

  const cols: number[] = [];
  for (const f of feats) {
    const col = model.vocab[f];
    if (col !== undefined) cols.push(col);
  }
  const scale = cols.length > 0 ? 1 / Math.sqrt(cols.length) : 0;

  for (const col of cols) {
    for (let c = 0; c < model.labels.length; c++) z[c] += model.weights[c][col] * scale;
  }

  const p = softmax(z);
  const scores = model.labels
    .map((l, i) => ({ intent: l as Intent, p: p[i] }))
    .sort((a, b) => b.p - a.p);

  return { intent: scores[0].intent, confidence: scores[0].p, scores };
}

export const CONFIDENCE_FLOOR = 0.8;
