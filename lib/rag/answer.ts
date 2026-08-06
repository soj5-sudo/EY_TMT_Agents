import { Bm25Index, type RagDoc, type ScoredDoc } from "@/lib/rag/bm25";
import { staticCorpus, newsDocs, quoteDocs } from "@/lib/rag/corpus";
import { computeAnswer } from "@/lib/brain/engine";
import { parseQuestion } from "@/lib/brain/intent";
import type { NewsItem, Provenance, Quote } from "@/lib/core/types";

export interface Citation {
  n: number;
  title: string;
  source: string;
  section: string;
  url?: string;
  untrusted: boolean;
}

export interface Answer {
  text: string;
  citations: Citation[];
  mode: "computed" | "extractive";
  confidence: "high" | "moderate" | "low";
  usedUntrusted: boolean;
  injectionNotice: string | null;
  providerLabel: string;
  table: Array<{ label: string; value: string; note?: string }> | null;
}

const ENGINE_LABEL = "In-house analytical engine";

export interface LiveContext {
  news?: NewsItem[];
  quotes?: Quote[];
  filingDocs?: RagDoc[];
}

export function buildIndex(live: LiveContext = {}): Bm25Index {
  const index = new Bm25Index();
  index.addAll(staticCorpus());
  if (live.news?.length) index.addAll(newsDocs(live.news));
  if (live.quotes?.length) index.addAll(quoteDocs(live.quotes));
  if (live.filingDocs?.length) index.addAll(live.filingDocs);
  index.finalise();
  return index;
}

const NEWS_INTENT =
  /\b(news|headline|latest|recent|report(ed|ing)?|announce\w*|acquisi\w*|acquire\w*|merger|deal|today|this week|happening|said|says)\b/i;

function rerank(hits: ScoredDoc[], question: string): ScoredDoc[] {
  const factor = NEWS_INTENT.test(question) ? 2.2 : 0.45;
  return [...hits]
    .map((h) => (h.doc.untrusted ? { ...h, score: h.score * factor } : h))
    .sort((a, b) => b.score - a.score);
}

function relevantSentences(body: string, terms: Set<string>, limit: number): string[] {
  const sentences = body
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  const scored = sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    let hits = 0;
    for (const t of terms) if (lower.includes(t)) hits++;
    const figures = (sentence.match(/\d/g) ?? []).length;
    return { sentence, score: hits * 10 + Math.min(figures, 12) };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((s) => s.score > 0).slice(0, limit);

  if (picked.length === 0) return sentences.slice(0, limit);

  return sentences.filter((s) => picked.some((p) => p.sentence === s));
}

function confidenceOf(hits: ScoredDoc[]): Answer["confidence"] {
  if (hits.length === 0) return "low";
  const top = hits[0].score;
  return top >= 9 ? "high" : top >= 4 ? "moderate" : "low";
}

const NO_ANSWER =
  "I could not find that in the console's data. This assistant answers from the coverage universe, " +
  "the filed statements behind it, the live feeds, and the console's own documentation. " +
  "Try naming a company and a measure, such as the operating margin of a name in the universe.";

const DOC_SECTIONS = new Set(["Product", "Diligence method"]);

export function answerExtractive(
  index: Bm25Index,
  question: string,
  documentationOnly = false,
): Answer {
  let hits = rerank(index.search(question, 20), question);
  if (documentationOnly) {
    hits = hits.filter((h) => !h.doc.untrusted && DOC_SECTIONS.has(h.doc.section));

    if (hits.length === 0) {
      const overview = index.bySection("Product").slice(0, 3);
      hits = overview.map((doc) => ({ doc, score: 1, matchedTerms: [] }));
    }
  }
  hits = hits.slice(0, 10);

  const empty: Answer = {
    text: NO_ANSWER,
    citations: [],
    mode: "extractive",
    confidence: "low",
    usedUntrusted: false,
    injectionNotice: null,
    providerLabel: ENGINE_LABEL,
    table: null,
  };

  if (hits.length === 0) return empty;

  const terms = new Set(hits.flatMap((h) => h.matchedTerms));
  const citations: Citation[] = [];
  const paragraphs: string[] = [];
  let usedUntrusted = false;

  for (const hit of hits.slice(0, 3)) {
    const n = citations.length + 1;
    const sentences = relevantSentences(hit.doc.body, terms, 3);
    if (sentences.length === 0) continue;

    paragraphs.push(`${sentences.join(" ")} [${n}]`);
    citations.push({
      n,
      title: hit.doc.title,
      source: hit.doc.source,
      section: hit.doc.section,
      url: hit.doc.url,
      untrusted: hit.doc.untrusted,
    });
    if (hit.doc.untrusted) usedUntrusted = true;
  }

  if (paragraphs.length === 0) return empty;

  return {
    text: paragraphs.join("\n\n"),
    citations,
    mode: "extractive",
    confidence: confidenceOf(hits),
    usedUntrusted,
    injectionNotice: null,
    providerLabel: ENGINE_LABEL,
    table: null,
  };
}

export async function answerQuestion(index: Bm25Index, question: string): Promise<Answer> {
  const computed = await computeAnswer(question).catch(() => null);

  if (computed && computed.method === "computed") {
    return {
      text: computed.text,
      citations: computed.sources.map((s: Provenance, i) => ({
        n: i + 1,
        title: s.source,
        source: `${s.kind}, retrieved ${s.retrievedAt.slice(0, 10)}`,
        section: "Computed from filings",
        url: s.url,
        untrusted: false,
      })),
      mode: "computed",
      confidence: "high",
      usedUntrusted: false,
      injectionNotice: null,
      providerLabel: ENGINE_LABEL,
      table: computed.table,
    };
  }

  const parsed = parseQuestion(question);
  const retrieved = answerExtractive(index, question, parsed.intent === "product");

  if (computed && computed.method === "none" && retrieved.confidence === "low") {
    return {
      ...retrieved,
      text: computed.text,
      mode: "computed",
      citations: computed.sources.map((s: Provenance, i) => ({
        n: i + 1,
        title: s.source,
        source: `${s.kind}, retrieved ${s.retrievedAt.slice(0, 10)}`,
        section: "Computed from filings",
        url: s.url,
        untrusted: false,
      })),
    };
  }

  return retrieved;
}
