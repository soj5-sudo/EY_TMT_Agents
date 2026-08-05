/**
 * Layer 1a: the trained intent classifier.
 *
 * The parser resolves companies and measures from exact tables, because those
 * have to be right rather than probable. Routing the question is a different
 * problem: "how has margin moved", "what has margin done lately" and "margin
 * trajectory please" all mean the same thing, and a rule that recognises them
 * is a list of phrasings someone has to keep extending forever.
 *
 * So routing is learned. This is a multinomial logistic regression over lexical
 * and structural features, trained by scripts/train-intent on a labelled corpus
 * and evaluated on template families held out entirely from training, so the
 * reported accuracy measures generalisation to unseen phrasing rather than
 * memorisation. The weights are checked in; there is no model server and no key.
 *
 * Company and measure mentions are replaced by placeholders before features are
 * taken. Without that the model learns that questions about Accenture are
 * ranking questions purely because the training corpus happened to rank
 * Accenture, and it would fail on any name it had not seen.
 */

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
  /** Class order. Weight rows follow this order. */
  labels: string[];
  /** Feature name to column index. */
  vocab: Record<string, number>;
  /** labels.length rows of vocab size, row-major. */
  weights: number[][];
  bias: number[];
  meta: {
    trainedAt: string;
    trainingExamples: number;
    heldOutExamples: number;
    heldOutAccuracy: number;
    baselineAccuracy: number;
    /** Accuracy of the shipped policy: model above the floor, rules below. */
    combinedAccuracy: number;
    confidenceFloor: number;
    features: number;
    epochs: number;
  };
}

/* ------------------------------------------------------------------ *
 * Feature extraction
 *
 * Shared by training and inference. Any divergence between the two silently
 * destroys accuracy, so there is exactly one implementation and both import it.
 * ------------------------------------------------------------------ */

export interface Structure {
  /** How many coverage-universe companies the question names. */
  companies: number;
  /** How many measures it names. */
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

/**
 * Builds the feature list for one question.
 *
 * `text` is expected to already carry placeholders in place of company and
 * measure mentions, which is what makes the model generalise across the
 * universe instead of learning names.
 */
export function features(text: string, s: Structure): string[] {
  const out: string[] = [];
  const words = tokenise(text);

  for (const w of words) out.push(`w:${w}`);
  for (let i = 0; i + 1 < words.length; i++) out.push(`b:${words[i]}_${words[i + 1]}`);

  // Character n-grams, so a word the model never saw still contributes.
  // Without these, "track" and "trajectory" share nothing with "trend" and an
  // unseen verb leaves the classifier with only the structural features, which
  // cannot separate a trend question from a plain metric lookup.
  for (const w of words) {
    if (w.startsWith("<")) continue;
    const padded = `^${w}$`;
    for (let n = 3; n <= 5; n++) {
      if (padded.length < n) break;
      for (let i = 0; i + n <= padded.length; i++) out.push(`c:${padded.slice(i, i + n)}`);
    }
  }

  // The first two words carry most of the routing signal in a question.
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

/* ------------------------------------------------------------------ *
 * Inference
 * ------------------------------------------------------------------ */

export interface Prediction {
  intent: Intent;
  /** Softmax probability of the chosen class. */
  confidence: number;
  /** Every class with its probability, for reporting and for tie handling. */
  scores: Array<{ intent: Intent; p: number }>;
}

function softmax(z: number[]): number[] {
  const max = Math.max(...z);
  const exp = z.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}

/**
 * Routes a question. Returns null when the model has no opinion worth acting
 * on, which lets the caller fall back to the deterministic rules rather than
 * act on a coin flip.
 */
export function classifyIntent(
  text: string,
  structure: Structure,
  model: IntentModel = INTENT_MODEL as IntentModel,
): Prediction | null {
  if (!model?.labels?.length) return null;

  const feats = features(text, structure);
  const z = model.bias.slice();

  // Each example is scaled to unit length. A question yields roughly fifty
  // character n-grams against ten word features, so without this the character
  // features dominate the dot product purely by being numerous, and a longer
  // question scores higher on every class for no reason connected to meaning.
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

/**
 * Confidence below which the deterministic rules are used instead.
 *
 * Chosen against the held out set: the rules remain better than the model on
 * plain measure lookups, which are the most common question, while the model is
 * far better on everything else. Handing the uncertain cases back to the rules
 * scores higher than either alone.
 */
export const CONFIDENCE_FLOOR = 0.8;
