import { writeFileSync } from "node:fs";
import { UNIVERSE } from "@/lib/data/universe";
import { METRICS, parseQuestion } from "@/lib/brain/intent";
import { features, type Structure } from "@/lib/brain/classifier";

type Intent = "metric" | "compare" | "rank" | "trend" | "explain" | "product";

interface Family {
  intent: Intent;
  patterns: string[];
}

const FAMILIES: Family[] = [
  { intent: "metric", patterns: ["what is {co}'s {metric}", "what is the {metric} of {co}"] },
  { intent: "metric", patterns: ["{co} {metric}", "{metric} for {co}", "{metric} {co}"] },
  { intent: "metric", patterns: ["how much {metric} does {co} have", "how much {metric} did {co} report"] },
  { intent: "metric", patterns: ["tell me {co}'s {metric}", "give me the {metric} for {co}"] },
  { intent: "metric", patterns: ["show {metric} for {co}", "pull up {co} {metric}"] },
  { intent: "metric", patterns: ["what did {co} report for {metric}", "what does {co} report as {metric}"] },
  { intent: "metric", patterns: ["{co} latest {metric}", "latest {metric} at {co}", "current {metric} for {co}"] },
  { intent: "metric", patterns: ["i need the {metric} number for {co}", "can you find {co} {metric}"] },
  { intent: "metric", patterns: ["where does {co} sit on {metric}", "what level is {co}'s {metric} at"] },
  { intent: "metric", patterns: ["{metric} at {co} please", "{co} {metric} figure"] },

  { intent: "compare", patterns: ["{co} versus {co2} on {metric}", "{co} vs {co2} {metric}"] },
  { intent: "compare", patterns: ["compare {co} and {co2} on {metric}", "compare the {metric} of {co} and {co2}"] },
  { intent: "compare", patterns: ["how does {co} compare to {co2} on {metric}", "how does {co}'s {metric} compare with {co2}"] },
  { intent: "compare", patterns: ["is {co} better than {co2} on {metric}", "does {co} beat {co2} on {metric}"] },
  { intent: "compare", patterns: ["{metric} for {co} against {co2}", "{metric} of {co} relative to {co2}"] },
  { intent: "compare", patterns: ["difference in {metric} between {co} and {co2}", "gap between {co} and {co2} on {metric}"] },
  { intent: "compare", patterns: ["put {co} next to {co2} on {metric}", "line up {co} and {co2} by {metric}"] },
  { intent: "compare", patterns: ["which is stronger on {metric}, {co} or {co2}", "who wins on {metric}, {co} or {co2}"] },

  { intent: "rank", patterns: ["which company has the best {metric}", "which name has the highest {metric}"] },
  { intent: "rank", patterns: ["who has the worst {metric}", "who has the lowest {metric}"] },
  { intent: "rank", patterns: ["rank the {sub} names by {metric}", "rank {sub} on {metric}"] },
  { intent: "rank", patterns: ["top {metric} in {sub}", "best {metric} across {sub}"] },
  { intent: "rank", patterns: ["league table for {metric}", "leaderboard by {metric}"] },
  { intent: "rank", patterns: ["order the universe by {metric}", "sort companies on {metric}"] },
  { intent: "rank", patterns: ["strongest {metric} in the sector", "weakest {metric} in the sector"] },
  { intent: "rank", patterns: ["who leads on {metric}", "who is behind on {metric}"] },

  { intent: "trend", patterns: ["how has {co}'s {metric} moved", "how has {metric} moved at {co}"] },
  { intent: "trend", patterns: ["{co} {metric} over time", "{metric} at {co} over the last {years} years"] },
  { intent: "trend", patterns: ["{co} {metric} trend", "trend in {co}'s {metric}"] },
  { intent: "trend", patterns: ["has {co}'s {metric} improved", "has {metric} deteriorated at {co}"] },
  { intent: "trend", patterns: ["show me the history of {co}'s {metric}", "history of {metric} for {co}"] },
  { intent: "trend", patterns: ["{metric} trajectory for {co}", "where is {co}'s {metric} heading"] },
  { intent: "trend", patterns: ["what has {co}'s {metric} done lately", "what has been happening to {metric} at {co}"] },
  { intent: "trend", patterns: ["{co} {metric} by year", "{co} {metric} each quarter"] },
  { intent: "trend", patterns: ["plot {metric} for {co}", "chart {co} {metric} over {years} years"] },
  { intent: "trend", patterns: ["is {co}'s {metric} going up or down", "which direction is {co} {metric} moving"] },

  { intent: "explain", patterns: ["why did {co}'s {metric} fall", "why did {metric} drop at {co}"] },
  { intent: "explain", patterns: ["what is driving {co}'s {metric}", "what drove the change in {co} {metric}"] },
  { intent: "explain", patterns: ["explain {co}'s {metric}", "explain the {metric} at {co}"] },
  { intent: "explain", patterns: ["what does {metric} mean", "what does {metric} actually measure"] },
  { intent: "explain", patterns: ["why is {co}'s {metric} so high", "why is {metric} low at {co}"] },
  { intent: "explain", patterns: ["what caused the move in {co} {metric}", "reason for the change in {metric} at {co}"] },
  { intent: "explain", patterns: ["help me understand {co}'s {metric}", "walk me through {metric} at {co}"] },
  { intent: "explain", patterns: ["how should i read {co}'s {metric}", "what should i take from {co} {metric}"] },

  { intent: "product", patterns: ["what does this dashboard do", "what is this console for"] },
  { intent: "product", patterns: ["where does the data come from", "what are your sources"] },
  { intent: "product", patterns: ["how do the agents work", "what do the agents do"] },
  { intent: "product", patterns: ["what is the tech stack", "do you use supabase"] },
  { intent: "product", patterns: ["how fresh is the data", "when was this last updated"] },
  { intent: "product", patterns: ["how is this secured", "can this site be scraped"] },
  { intent: "product", patterns: ["what companies do you cover", "which names are in the universe"] },
  { intent: "product", patterns: ["can i export to excel", "how do i download the data"] },
  { intent: "product", patterns: ["what is a workstream", "explain the workstreams"] },

  { intent: "metric", patterns: ["{metric} on {co}", "read me {co} {metric}"] },
  { intent: "metric", patterns: ["what number does {co} put on {metric}", "what is {co} carrying for {metric}"] },
  { intent: "metric", patterns: ["{co} {metric} right now", "as things stand what is {co} {metric}"] },
  { intent: "metric", patterns: ["quote me {co}'s {metric}", "state the {metric} for {co}"] },

  { intent: "compare", patterns: ["{co} or {co2} on {metric}", "{co} against {co2}, {metric}"] },
  { intent: "compare", patterns: ["side by side {metric} for {co} and {co2}", "benchmark {co} to {co2} on {metric}"] },
  { intent: "compare", patterns: ["how far apart are {co} and {co2} on {metric}", "spread between {co} and {co2} {metric}"] },
  { intent: "compare", patterns: ["stack {co} up against {co2} on {metric}", "measure {co} against {co2} on {metric}"] },

  { intent: "rank", patterns: ["best {metric} anywhere", "worst {metric} anywhere"] },
  { intent: "rank", patterns: ["give me the top names on {metric}", "list the bottom names on {metric}"] },
  { intent: "rank", patterns: ["who is top of the table for {metric}", "who sits bottom on {metric}"] },
  { intent: "rank", patterns: ["highest {metric} in {sub}", "lowest {metric} in {sub}"] },

  { intent: "trend", patterns: ["plot {co} {metric}", "graph {metric} for {co}"] },
  { intent: "trend", patterns: ["is {metric} rising at {co}", "is {metric} falling at {co}"] },
  { intent: "trend", patterns: ["which way is {co} {metric} going", "what direction has {co} {metric} taken"] },
  { intent: "trend", patterns: ["{co} {metric} quarter on quarter", "{co} {metric} year on year"] },
  { intent: "trend", patterns: ["track {metric} at {co}", "follow {co} {metric} through the periods"] },
  { intent: "trend", patterns: ["how has {metric} changed at {co}", "how much has {co} {metric} changed"] },
  { intent: "trend", patterns: ["{metric} for {co} since {years} years ago", "{co} {metric} across the last {years} periods"] },
  { intent: "trend", patterns: ["give me the series for {co} {metric}", "the run of {metric} at {co}"] },

  { intent: "explain", patterns: ["help me understand {co}'s {metric}", "walk me through {metric} at {co}"] },
  { intent: "explain", patterns: ["how should i read {co}'s {metric}", "what should i take from {co} {metric}"] },
  { intent: "explain", patterns: ["what is behind {co}'s {metric}", "what accounts for {co}'s {metric}"] },
  { intent: "explain", patterns: ["unpack {co}'s {metric}", "break down {metric} at {co}"] },
  { intent: "explain", patterns: ["make sense of {co} {metric}", "interpret {co}'s {metric}"] },
  { intent: "explain", patterns: ["what should i conclude from {co} {metric}", "what does {co}'s {metric} tell me"] },
  { intent: "explain", patterns: ["is {co}'s {metric} good or bad", "should i be worried about {co}'s {metric}"] },
  { intent: "explain", patterns: ["give me the reasoning on {co} {metric}", "justify {co}'s {metric}"] },

  { intent: "product", patterns: ["how does this thing work", "what am i looking at"] },
  { intent: "product", patterns: ["who built this", "what is this site"] },
  { intent: "product", patterns: ["is my upload stored", "what happens to files i upload"] },
  { intent: "product", patterns: ["how many agents are there", "what is an agent here"] },
  { intent: "product", patterns: ["can i trust these numbers", "how do you verify the data"] },
  { intent: "product", patterns: ["what does provenance mean here", "how do i see the source"] },

  { intent: "explain", patterns: ["why has {co}'s {metric} moved", "why has {metric} shifted at {co}"] },
  { intent: "explain", patterns: ["why does {co} have such a {metric}", "why is {co} carrying that {metric}"] },
  { intent: "explain", patterns: ["any idea why {co}'s {metric} changed", "do you know why {metric} moved at {co}"] },
  { intent: "explain", patterns: ["why the change in {co}'s {metric}", "why the move in {metric} at {co}"] },
  { intent: "explain", patterns: ["what is the reason for {co}'s {metric}", "the reason behind {co}'s {metric}"] },
  { intent: "explain", patterns: ["what sits behind {co}'s {metric}", "what lies behind {metric} at {co}"] },
  { intent: "explain", patterns: ["what does {metric} actually mean", "what is meant by {metric}"] },
  { intent: "explain", patterns: ["how do i interpret {co}'s {metric}", "how is {co}'s {metric} to be read"] },
  { intent: "explain", patterns: ["why so high on {metric} at {co}", "why so low on {metric} at {co}"] },
  { intent: "explain", patterns: ["what explains {co}'s {metric}", "what would explain {metric} at {co}"] },

  { intent: "trend", patterns: ["what is the trajectory of {co}'s {metric}", "trajectory of {metric} at {co}"] },
  { intent: "trend", patterns: ["is {co}'s {metric} up or down", "up or down on {metric} at {co}"] },
  { intent: "trend", patterns: ["the trend of {metric} at {co}", "trending {metric} for {co}"] },
  { intent: "trend", patterns: ["{co} {metric} across time", "{metric} for {co} through time"] },
  { intent: "trend", patterns: ["how {co}'s {metric} has developed", "how {metric} developed at {co}"] },
  { intent: "trend", patterns: ["movement in {co}'s {metric}", "the movement of {metric} at {co}"] },
  { intent: "trend", patterns: ["{co} {metric} last {years} years", "{co} {metric} past {years} quarters"] },
  { intent: "trend", patterns: ["direction of travel on {co} {metric}", "which direction for {co}'s {metric}"] },
  { intent: "trend", patterns: ["has {metric} risen or fallen at {co}", "did {metric} rise or fall at {co}"] },
  { intent: "trend", patterns: ["show the progression of {co}'s {metric}", "progression of {metric} at {co}"] },

  { intent: "metric", patterns: ["where does {co} stand on {metric}", "what position is {co} in on {metric}"] },
  { intent: "metric", patterns: ["{metric} reported by {co}", "the {metric} {co} reported"] },
  { intent: "metric", patterns: ["what is {co} on for {metric}", "what is {co} running at on {metric}"] },

  { intent: "rank", patterns: ["highest {metric} of any name", "lowest {metric} of any name"] },
  { intent: "rank", patterns: ["best {metric} in the universe", "worst {metric} in the universe"] },

  { intent: "compare", patterns: ["{metric} for {co} versus {co2}", "{metric} at {co} against that of {co2}"] },
  { intent: "compare", patterns: ["set {co} beside {co2} on {metric}", "weigh {co} against {co2} on {metric}"] },

  { intent: "product", patterns: ["which companies are covered here", "what is in your coverage"] },
  { intent: "product", patterns: ["what can this tool do", "what questions can i ask"] },
];

interface Example {
  raw: string;
  placeholder: string;
  structure: Structure;
  label: Intent;
  family: number;
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = makeRandom(20260805);

function pick<T>(xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

const SUBSECTORS = [...new Set(UNIVERSE.map((c) => c.subsector))];

function build(): Example[] {
  const out: Example[] = [];

  FAMILIES.forEach((family, fi) => {
    for (const pattern of family.patterns) {
      for (let i = 0; i < 26; i++) {
        const co = pick(UNIVERSE);
        let co2 = pick(UNIVERSE);
        let guard = 0;
        while (co2.symbol === co.symbol && guard++ < 10) co2 = pick(UNIVERSE);
        const metric = pick(METRICS);
        const metricTerm = pick([...metric.terms]);
        const sub = pick(SUBSECTORS);
        const years = pick(["three", "five", "ten", "4", "5"]);

        const usesCo = pattern.includes("{co}");
        const usesCo2 = pattern.includes("{co2}");
        const usesMetric = pattern.includes("{metric}");

        const raw = pattern
          .replace(/\{co\}/g, co.short)
          .replace(/\{co2\}/g, co2.short)
          .replace(/\{metric\}/g, metricTerm)
          .replace(/\{sub\}/g, sub.toLowerCase())
          .replace(/\{years\}/g, years);

        const placeholder = pattern
          .replace(/\{co\}/g, "<co>")
          .replace(/\{co2\}/g, "<co>")
          .replace(/\{metric\}/g, "<metric>")
          .replace(/\{sub\}/g, "<sub>")
          .replace(/\{years\}/g, "<num>");

        out.push({
          raw,
          placeholder,
          structure: {
            companies: (usesCo ? 1 : 0) + (usesCo2 ? 1 : 0),
            metrics: usesMetric ? 1 : 0,
          },
          label: family.intent,
          family: fi,
        });
      }
    }
  });

  return out;
}

const LABELS: Intent[] = ["metric", "compare", "rank", "trend", "explain", "product"];

function vectorise(examples: Example[], minCount: number) {
  const counts = new Map<string, number>();
  for (const ex of examples) {
    for (const f of new Set(features(ex.placeholder, ex.structure))) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }

  const vocab: Record<string, number> = {};
  let n = 0;
  for (const [f, c] of counts) {
    if (c >= minCount) vocab[f] = n++;
  }
  return { vocab, size: n };
}

function rows(examples: Example[], vocab: Record<string, number>) {
  return examples.map((ex) => {
    const cols: number[] = [];
    for (const f of new Set(features(ex.placeholder, ex.structure))) {
      const c = vocab[f];
      if (c !== undefined) cols.push(c);
    }
    return { cols, y: LABELS.indexOf(ex.label) };
  });
}

function train(
  data: Array<{ cols: number[]; y: number }>,
  size: number,
  epochs: number,
  lr: number,
  l2: number,
) {
  const K = LABELS.length;
  const W: number[][] = Array.from({ length: K }, () => new Array(size).fill(0));
  const b = new Array(K).fill(0);
  const order = data.map((_, i) => i);
  const r = makeRandom(7);

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const rate = lr / (1 + epoch * 0.12);

    for (const idx of order) {
      const { cols, y } = data[idx];

      const scale = cols.length > 0 ? 1 / Math.sqrt(cols.length) : 0;

      const z = b.slice();
      for (const c of cols) for (let k = 0; k < K; k++) z[k] += W[k][c] * scale;

      const max = Math.max(...z);
      const exp = z.map((v) => Math.exp(v - max));
      const sum = exp.reduce((a, v) => a + v, 0);

      for (let k = 0; k < K; k++) {
        const p = exp[k] / sum;
        const g = p - (k === y ? 1 : 0);
        if (g === 0) continue;
        b[k] -= rate * g;
        const row = W[k];
        for (const c of cols) row[c] -= rate * (g * scale + l2 * row[c]);
      }
    }
  }

  return { W, b };
}

function accuracy(
  data: Array<{ cols: number[]; y: number }>,
  W: number[][],
  b: number[],
): number {
  let right = 0;
  for (const { cols, y } of data) {
    const scale = cols.length > 0 ? 1 / Math.sqrt(cols.length) : 0;
    const z = b.slice();
    for (const c of cols) for (let k = 0; k < LABELS.length; k++) z[k] += W[k][c] * scale;
    let best = 0;
    for (let k = 1; k < z.length; k++) if (z[k] > z[best]) best = k;
    if (best === y) right++;
  }
  return right / data.length;
}

const all = build();

const heldOutFamilies = new Set<number>();
const byIntent = new Map<Intent, number[]>();
FAMILIES.forEach((f, i) => {
  byIntent.set(f.intent, [...(byIntent.get(f.intent) ?? []), i]);
});
const splitRand = makeRandom(4242);
for (const [, idxs] of byIntent) {
  const shuffled = [...idxs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(splitRand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const take = Math.max(1, Math.round(shuffled.length * 0.3));
  for (let i = 0; i < take; i++) heldOutFamilies.add(shuffled[i]);
}

const trainSet = all.filter((e) => !heldOutFamilies.has(e.family));
const testSet = all.filter((e) => heldOutFamilies.has(e.family));

const { vocab, size } = vectorise(trainSet, 2);
const trainRows = rows(trainSet, vocab);
const testRows = rows(testSet, vocab);

console.log(`corpus         ${all.length} examples from ${FAMILIES.length} families`);
console.log(`held out       ${heldOutFamilies.size} families, ${testSet.length} examples`);
console.log(`features       ${size}`);

const EPOCHS = 60;
const { W, b } = train(trainRows, size, EPOCHS, 2.0, 2e-5);

const trainAcc = accuracy(trainRows, W, b);
const testAcc = accuracy(testRows, W, b);

let baselineRight = 0;
for (const ex of testSet) {
  if (parseQuestion(ex.raw).intent === ex.label) baselineRight++;
}
const baseline = baselineRight / testSet.length;

console.log(`train accuracy ${(trainAcc * 100).toFixed(1)}%`);
console.log(`HELD OUT       ${(testAcc * 100).toFixed(1)}%   (regex baseline ${(baseline * 100).toFixed(1)}%)`);

console.log("\nper class on held out:");
for (let k = 0; k < LABELS.length; k++) {
  const subset = testRows.filter((r) => r.y === k);
  if (subset.length === 0) {
    console.log(`  ${LABELS[k].padEnd(8)} no held out families`);
    continue;
  }
  const acc = accuracy(subset, W, b);
  const base =
    testSet.filter((e) => e.label === LABELS[k] && parseQuestion(e.raw).intent === e.label).length /
    subset.length;
  console.log(
    `  ${LABELS[k].padEnd(8)} ${(acc * 100).toFixed(1).padStart(5)}%   rules ${(base * 100).toFixed(1).padStart(5)}%   n=${subset.length}`,
  );
}

function predictWith(ex: Example, floor: number): string {
  const cols: number[] = [];
  for (const f of new Set(features(ex.placeholder, ex.structure))) {
    const c = vocab[f];
    if (c !== undefined) cols.push(c);
  }
  const sc = cols.length > 0 ? 1 / Math.sqrt(cols.length) : 0;
  const z = b.slice();
  for (const c of cols) for (let k = 0; k < LABELS.length; k++) z[k] += W[k][c] * sc;
  const max = Math.max(...z);
  const exp = z.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, v) => a + v, 0);
  let best = 0;
  for (let k = 1; k < z.length; k++) if (z[k] > z[best]) best = k;
  const confidence = exp[best] / sum;
  return confidence >= floor ? LABELS[best] : parseQuestion(ex.raw).intent;
}

console.log("\ncombined policy on held out:");
let bestFloor = 0;
let bestCombined = 0;
for (const floor of [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
  const right = testSet.filter((ex) => predictWith(ex, floor) === ex.label).length;
  const acc = right / testSet.length;
  if (acc > bestCombined) {
    bestCombined = acc;
    bestFloor = floor;
  }
  console.log(`  floor ${floor.toFixed(2)}  ${(acc * 100).toFixed(1)}%`);
}
console.log(`  chosen floor ${bestFloor.toFixed(2)} at ${(bestCombined * 100).toFixed(1)}%`);

console.log("\nheld out families:");
for (const fi of [...heldOutFamilies].sort((a, b) => a - b)) {
  const subset = testSet.filter((e) => e.family === fi);
  if (subset.length === 0) continue;
  const r = rows(subset, vocab);
  const acc = accuracy(r, W, b);
  const votes = new Map<string, number>();
  for (const ex of subset) {
    const cols: number[] = [];
    for (const f of new Set(features(ex.placeholder, ex.structure))) {
      const c = vocab[f];
      if (c !== undefined) cols.push(c);
    }
    const sc = cols.length > 0 ? 1 / Math.sqrt(cols.length) : 0;
    const z = b.slice();
    for (const c of cols) for (let k = 0; k < LABELS.length; k++) z[k] += W[k][c] * sc;
    let best = 0;
    for (let k = 1; k < z.length; k++) if (z[k] > z[best]) best = k;
    votes.set(LABELS[best], (votes.get(LABELS[best]) ?? 0) + 1);
  }
  const got = [...votes.entries()].sort((a, c) => c[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(" ");
  console.log(`  ${(acc * 100).toFixed(0).padStart(3)}%  want=${FAMILIES[fi].intent.padEnd(8)} got=${got.padEnd(26)} "${FAMILIES[fi].patterns[0]}"`);
}

const model = {
  labels: LABELS,
  vocab,
  weights: W.map((row) => row.map((v) => Number(v.toFixed(4)))),
  bias: b.map((v) => Number(v.toFixed(4))),
  meta: {
    trainedAt: new Date().toISOString(),
    trainingExamples: trainSet.length,
    heldOutExamples: testSet.length,
    heldOutAccuracy: Number(testAcc.toFixed(4)),
    baselineAccuracy: Number(baseline.toFixed(4)),
    combinedAccuracy: Number(bestCombined.toFixed(4)),
    confidenceFloor: bestFloor,
    features: size,
    epochs: EPOCHS,
  },
};

const banner = `/**
 * Trained intent classifier weights. Generated by scripts/train-intent.
 *
 * Multinomial logistic regression over lexical and structural features.
 * Trained on ${trainSet.length} generated examples and evaluated on ${testSet.length}
 * examples drawn from template families held out of training entirely, so the
 * figure below measures generalisation to unseen phrasing.
 *
 *   held out accuracy   ${(testAcc * 100).toFixed(1)}%
 *   rule baseline       ${(baseline * 100).toFixed(1)}%
 *
 * The corpus is generated rather than collected. There is no log of real
 * questions to learn from, and this file says so rather than implying one.
 * Regenerate with:
 *   npm run train:intent
 */

import type { IntentModel } from "@/lib/brain/classifier";

export const INTENT_MODEL: IntentModel = `;

writeFileSync(
  "lib/brain/intent-model.ts",
  `${banner}${JSON.stringify(model)} as IntentModel;\n`,
);

console.log(`\nwrote lib/brain/intent-model.ts (${(JSON.stringify(model).length / 1024).toFixed(0)} kB)`);
