export interface RagDoc {
  id: string;
  title: string;
  body: string;
  section: string;
  source: string;
  url?: string;
  untrusted: boolean;
}

export interface ScoredDoc {
  doc: RagDoc;
  score: number;
  matchedTerms: string[];
}

const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 2.5;

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "was", "were", "be", "been", "it", "its", "this", "that", "these", "those",
  "as", "at", "by", "with", "from", "what", "which", "who", "how", "do", "does",
  "did", "can", "could", "would", "should", "please", "tell", "me", "show",
]);

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const out: string[] = [];

  const re = /-?\d[\d,.]*%?|[a-z][a-z&'/-]*/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(lowered)) !== null) {
    let t = m[0];
    if (/^-?\d/.test(t)) {
      const bare = t.replace(/,/g, "").replace(/%$/, "");
      out.push(bare);
      if (bare !== t) out.push(t.replace(/,/g, ""));
      continue;
    }
    t = t.replace(/^[-']+|[-']+$/g, "");
    if (t.length < 2 || STOP.has(t)) continue;
    out.push(t);
    if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) {
      out.push(t.slice(0, -1));
    }
  }

  return out;
}

interface IndexedDoc {
  doc: RagDoc;
  tf: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLength = 0;

  add(doc: RagDoc): void {
    const titleTokens = tokenize(doc.title);
    const bodyTokens = tokenize(doc.body);

    const tf = new Map<string, number>();
    for (const t of titleTokens) {
      tf.set(t, (tf.get(t) ?? 0) + TITLE_BOOST);
    }
    for (const t of bodyTokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    const length = titleTokens.length * TITLE_BOOST + bodyTokens.length;
    this.docs.push({ doc, tf, length });

    for (const term of tf.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
  }

  addAll(docs: RagDoc[]): void {
    for (const d of docs) this.add(d);
  }

  finalise(): void {
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length > 0 ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  bySection(section: string): RagDoc[] {
    return this.docs.filter((d) => d.doc.section === section).map((d) => d.doc);
  }

  search(query: string, limit = 8): ScoredDoc[] {
    if (this.docs.length === 0) return [];
    if (this.avgLength === 0) this.finalise();

    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const N = this.docs.length;
    const results: ScoredDoc[] = [];

    for (const indexed of this.docs) {
      let score = 0;
      const matched: string[] = [];

      for (const term of terms) {
        const f = indexed.tf.get(term);
        if (!f) continue;

        const n = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));

        const denom =
          f + K1 * (1 - B + (B * indexed.length) / this.avgLength);
        score += idf * ((f * (K1 + 1)) / denom);
        matched.push(term);
      }

      if (score > 0) {
        results.push({ doc: indexed.doc, score, matchedTerms: matched });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
