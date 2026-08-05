/**
 * Annual report text.
 *
 * The tagged financial data answers what the numbers are. It does not answer
 * who the customers are, what management says it competes against, what the
 * board discloses as its principal risks, or whether there is litigation worth
 * pricing. All of that is in the narrative sections of the annual report, which
 * is a public document served from the same register as the XBRL.
 *
 * This fetches the primary document of the latest annual filing, reduces it to
 * text while preserving block structure, and cuts it into the numbered items.
 * Sectioning is done by span rather than by first match: every annual report
 * names its items twice, once in the contents table and once at the section
 * itself, and taking the first match yields a two-line section every time. The
 * longest span between consecutive item markers is the real section.
 *
 * Extraction is conservative. A signal is only reported when the sentence that
 * carries it is retained alongside it, so every statement an agent makes from
 * this can be traced back to the filed sentence it came from.
 */

import { fetchJson, fetchText } from "@/lib/core/fetcher";
import { cached } from "@/lib/core/cache";
import type { Provenance } from "@/lib/core/types";

const TTL_MS = 12 * 60 * 60 * 1000;

const HEADERS = {
  "User-Agent": "EY TMT Intelligence Console soj5@cornell.edu",
};

/**
 * What a section is about, independent of how the form numbers it.
 *
 * A domestic annual report puts the business description in Item 1 and the
 * risk factors in Item 1A. A foreign private issuer puts them in Item 4 and
 * Item 3 of a 20-F. Agents ask for the role, so neither they nor the
 * extraction rules below need to know which form they are reading.
 */
export type SectionRole =
  | "business"
  | "risk"
  | "legal"
  | "mdna"
  | "properties"
  | "market"
  | "cyber"
  | "controls"
  | "directors"
  | "compensation"
  | "ownership"
  | "other";

export interface FilingSection {
  item: string;
  role: SectionRole;
  title: string;
  text: string;
  chars: number;
}

export interface TextSignal {
  /** What was found. */
  label: string;
  /** The sentence from the filing that carries it, quoted verbatim. */
  sentence: string;
  /** Item the sentence came from. */
  item: string;
}

export interface FilingText {
  form: string;
  filingDate: string;
  periodEnd: string | null;
  url: string;
  chars: number;
  sections: FilingSection[];
  /** Individual principal-risk headings from the risk factors item. */
  riskHeadings: string[];
  signals: {
    customerConcentration: TextSignal[];
    competition: TextSignal[];
    employees: TextSignal[];
    geography: TextSignal[];
    litigation: TextSignal[];
    regulation: TextSignal[];
    climate: TextSignal[];
    keyPerson: TextSignal[];
    governance: TextSignal[];
    supplyChain: TextSignal[];
    cyber: TextSignal[];
    acquisitions: TextSignal[];
  };
  provenance: Provenance;
}

/* ------------------------------------------------------------------ *
 * HTML to text
 * ------------------------------------------------------------------ */

const BLOCK = /<\/(p|div|tr|h[1-6]|li|table|section)>/gi;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block ends become newlines so paragraph structure survives, which is
    // what makes risk headings recoverable further down.
    .replace(BLOCK, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:rsquo|lsquo|apos);/gi, "'")
    .replace(/&(?:rdquo|ldquo);/gi, '"')
    .replace(/&(?:mdash|ndash);/gi, ", ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ *
 * Sectioning
 * ------------------------------------------------------------------ */

interface ItemDef {
  title: string;
  role: SectionRole;
}

/** Item numbering of an annual report on the domestic forms. */
const ITEMS_10K: Record<string, ItemDef> = {
  "1": { title: "Business", role: "business" },
  "1A": { title: "Risk Factors", role: "risk" },
  "1B": { title: "Unresolved Staff Comments", role: "other" },
  "1C": { title: "Cybersecurity", role: "cyber" },
  "2": { title: "Properties", role: "properties" },
  "3": { title: "Legal Proceedings", role: "legal" },
  "5": { title: "Market for Registrant's Common Equity", role: "market" },
  "7": { title: "Management's Discussion and Analysis", role: "mdna" },
  "7A": { title: "Quantitative and Qualitative Disclosures About Market Risk", role: "other" },
  "8": { title: "Financial Statements and Supplementary Data", role: "other" },
  "9A": { title: "Controls and Procedures", role: "controls" },
  "10": { title: "Directors and Executive Officers", role: "directors" },
  "11": { title: "Executive Compensation", role: "compensation" },
  "12": { title: "Security Ownership", role: "ownership" },
  "13": { title: "Certain Relationships and Related Transactions", role: "other" },
};

/** Item numbering of an annual report on Form 20-F, which is different. */
const ITEMS_20F: Record<string, ItemDef> = {
  "3": { title: "Key Information and Risk Factors", role: "risk" },
  "4": { title: "Information on the Company", role: "business" },
  "4A": { title: "Unresolved Staff Comments", role: "other" },
  "5": { title: "Operating and Financial Review and Prospects", role: "mdna" },
  "6": { title: "Directors, Senior Management and Employees", role: "directors" },
  "7": { title: "Major Shareholders and Related Party Transactions", role: "ownership" },
  "8": { title: "Financial Information and Legal Proceedings", role: "legal" },
  "9": { title: "The Offer and Listing", role: "market" },
  "10": { title: "Additional Information", role: "other" },
  "11": { title: "Quantitative and Qualitative Disclosures About Market Risk", role: "other" },
  "15": { title: "Controls and Procedures", role: "controls" },
  "16C": { title: "Principal Accountant Fees and Services", role: "other" },
  "16K": { title: "Cybersecurity", role: "cyber" },
};

/**
 * Cuts the document into items.
 *
 * Two things defeat a naive split. Every annual report names its items twice,
 * once in the contents table and once at the section, so the first match is
 * always a two-line stub. And the body cross-references other items in the
 * middle of sentences, so an unguarded marker cuts a section short at its own
 * internal reference.
 *
 * The contents table is handled by taking the longest span per item. The
 * cross references are handled by only accepting a marker that begins a block,
 * since a reference inside a sentence never does.
 */
function sectionise(text: string, form: string): FilingSection[] {
  const map = form.startsWith("20-F") || form.startsWith("40-F") ? ITEMS_20F : ITEMS_10K;

  // (^|\n) anchors the marker to the start of a block, which is what
  // distinguishes a heading from "as described in Item 1A" inside a sentence.
  const marker = /(?:^|\n)\s*Item\s+(\d{1,2}[A-K]?)\s*[.:—–-]?\s*/gi;
  const marks: Array<{ item: string; at: number; after: number }> = [];

  for (const m of text.matchAll(marker)) {
    marks.push({
      item: m[1].toUpperCase(),
      at: m.index ?? 0,
      after: (m.index ?? 0) + m[0].length,
    });
  }
  if (marks.length === 0) return [];

  // Filers print a running page header naming the current item, which puts the
  // same marker at the start of a line on every page of that section. Left
  // alone, each repeat opens a new span and the section collapses to one page.
  // Consecutive markers for the same item are one section, so runs are merged.
  const runs: typeof marks = [];
  for (const m of marks) {
    if (runs.length > 0 && runs[runs.length - 1].item === m.item) continue;
    runs.push(m);
  }

  const best = new Map<string, { start: number; end: number }>();

  for (let i = 0; i < runs.length; i++) {
    if (!map[runs[i].item]) continue;
    const start = runs[i].at;
    const end = i + 1 < runs.length ? runs[i + 1].at : text.length;
    const held = best.get(runs[i].item);
    if (!held || end - start > held.end - held.start) {
      best.set(runs[i].item, { start, end });
    }
  }

  const out: FilingSection[] = [];
  for (const [item, { start, end }] of best) {
    const body = text.slice(start, end).trim();
    // A real section carries substance. Anything shorter is a stub entry.
    if (body.length < 600) continue;
    const def = map[item];
    out.push({ item, role: def.role, title: def.title, text: body, chars: body.length });
  }

  return out.sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }));
}

/* ------------------------------------------------------------------ *
 * Risk headings
 * ------------------------------------------------------------------ */

/**
 * Risk factor headings are their own paragraph and read as a claim rather than
 * a sentence of prose. They are recoverable because a heading line is short,
 * stands alone, and is followed by a longer block.
 */
function riskHeadings(riskText: string): string[] {
  const lines = riskText.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (line.length < 30 || line.length > 260) continue;
    if (!/^[A-Z"']/.test(line)) continue;
    if (/^Item\s/i.test(line)) continue;
    if (/^\s*\|/.test(line) || line.includes(" | ")) continue;
    if (/^(Table of Contents|PART|Page)\b/i.test(line)) continue;
    // A heading is followed by substantially more text than itself.
    if (lines[i + 1].length < line.length) continue;
    // Headings in this item are risk claims, which read with a modal or a
    // consequence verb. This is what excludes ordinary prose lines.
    if (!/\b(may|could|might|will|risk|failure|inability|depend|adverse|if we|our business|subject to)\b/i.test(line))
      continue;
    out.push(line.replace(/\s+/g, " "));
    if (out.length >= 40) break;
  }

  return [...new Set(out)];
}

/* ------------------------------------------------------------------ *
 * Signal extraction
 * ------------------------------------------------------------------ */

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 40 && s.length < 700);
}

interface Rule {
  label: string;
  /** Section roles to search, in order of preference. */
  roles: SectionRole[];
  re: RegExp;
  max: number;
}

const RULES: Record<keyof FilingText["signals"], Rule> = {
  customerConcentration: {
    label: "Customer concentration",
    roles: ["business", "risk", "mdna"],
    re: /\b(no (?:single )?(?:client|customer)|largest (?:client|customer)s?|top (?:ten|10|five|5|twenty|20) (?:client|customer)s?|(?:client|customer) accounted for|accounted for (?:approximately )?\d+(?:\.\d+)?% of (?:our )?(?:net )?revenue)\b/i,
    max: 4,
  },
  competition: {
    label: "Competition",
    roles: ["business", "risk"],
    re: /\b(we compete|our competitors|competitive landscape|principal competitors|compete (?:with|against)|highly competitive)\b/i,
    max: 4,
  },
  employees: {
    label: "Human capital",
    roles: ["business", "risk", "directors"],
    re: /\b(?:we (?:had|employed)|had approximately|as of \w+ \d+,? \d{4},? we had)\s[^.]{0,60}?\b\d[\d,]{3,}\b[^.]{0,60}\b(?:employees|people|professionals|personnel)\b/i,
    max: 3,
  },
  geography: {
    label: "Geographic exposure",
    roles: ["business", "mdna", "risk"],
    re: /\b(?:operations in|offices in|present in|customers in|delivery centers? in|revenue(?:s)? (?:from|in) (?:the )?(?:Americas|EMEA|APAC|Europe|Asia|North America))\b/i,
    max: 3,
  },
  litigation: {
    label: "Legal proceedings",
    roles: ["legal", "risk"],
    re: /\b(lawsuit|class action|complaint (?:was )?filed|arbitration|litigation|court|plaintiff|alleg(?:es|ed|ing)|settlement agreement|consent decree)\b/i,
    max: 5,
  },
  regulation: {
    label: "Regulatory exposure",
    roles: ["business", "risk"],
    re: /\b(regulat\w+|GDPR|data protection law|antitrust|export control|sanctions|compliance with law|licensing requirement|privacy law)\b/i,
    max: 4,
  },
  climate: {
    label: "Climate and environment",
    roles: ["business", "risk"],
    re: /\b(climate change|greenhouse gas|carbon (?:neutral|emission|footprint)|net zero|renewable energy|environmental regulation|sustainability)\b/i,
    max: 4,
  },
  keyPerson: {
    label: "Key person dependency",
    roles: ["risk", "directors"],
    re: /\b(?:depend(?:ent|s)? (?:on|upon)|loss of|retain|attract and retain)\b[^.]{0,80}\b(?:key personnel|senior management|executive officers|key employees|founders?|chief executive)\b/i,
    max: 3,
  },
  governance: {
    label: "Governance structure",
    roles: ["risk", "ownership", "market", "directors"],
    re: /\b(dual[- ]class|Class B common stock|controlled company|our (?:founder|chairman) (?:controls|beneficially owns)|voting control|super[- ]?voting)\b/i,
    max: 3,
  },
  supplyChain: {
    label: "Supply chain",
    roles: ["business", "risk"],
    re: /\b(supply chain|sole source|single source|third[- ]party manufactur\w+|foundr\w+|contract manufactur\w+|component shortage|supplier concentration)\b/i,
    max: 4,
  },
  cyber: {
    label: "Cybersecurity",
    roles: ["cyber", "risk"],
    re: /\b(cyber ?security|cyber ?attack|data breach|ransomware|unauthorized access|information security (?:program|incident))\b/i,
    max: 4,
  },
  acquisitions: {
    label: "Acquisitions",
    roles: ["business", "mdna", "risk"],
    re: /\b(we (?:completed|acquired)|acquisition of|business combination|integration of acquired|purchase price allocation)\b/i,
    max: 4,
  },
};

function extractSignals(sections: FilingSection[]): FilingText["signals"] {
  const byRole = new Map<SectionRole, FilingSection[]>();
  for (const s of sections) {
    const held = byRole.get(s.role);
    if (held) held.push(s);
    else byRole.set(s.role, [s]);
  }
  const out = {} as FilingText["signals"];

  for (const [key, rule] of Object.entries(RULES) as Array<
    [keyof FilingText["signals"], Rule]
  >) {
    const hits: TextSignal[] = [];
    const seen = new Set<string>();

    for (const role of rule.roles) {
      for (const section of byRole.get(role) ?? []) {
      for (const s of sentences(section.text)) {
        if (hits.length >= rule.max) break;
        if (!rule.re.test(s)) continue;
        // Contents-table debris and page furniture repeat; drop duplicates on
        // a normalised key rather than on the raw sentence.
        const k = s.slice(0, 90).toLowerCase().replace(/[^a-z]/g, "");
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ label: rule.label, sentence: s, item: section.item });
      }
      }
      if (hits.length >= rule.max) break;
    }

    out[key] = hits;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */

interface SubmissionsDoc {
  filings: {
    recent: {
      form: string[];
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      primaryDocument: string[];
    };
  };
}

const ANNUAL = ["10-K", "20-F", "40-F"];

/**
 * Reads the narrative sections of the most recent annual report.
 *
 * Returns null rather than throwing when the filer has no annual report on the
 * register, because that is an ordinary condition for a recent registrant and
 * the agents downstream handle absence by raising a request.
 */
export async function getFilingText(cik: string): Promise<FilingText | null> {
  const padded = cik.padStart(10, "0");

  const res = await cached(`filing:text:${padded}`, TTL_MS, async () => {
    const subs = await fetchJson<SubmissionsDoc>(
      `https://data.sec.gov/submissions/CIK${padded}.json`,
      { headers: HEADERS, timeoutMs: 25_000, retries: 1 },
    );

    const r = subs.filings?.recent;
    if (!r?.form) return null;

    let idx = -1;
    for (let i = 0; i < r.form.length; i++) {
      if (ANNUAL.some((f) => r.form[i] === f)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return null;

    const accession = r.accessionNumber[idx].replace(/-/g, "");
    const doc = r.primaryDocument[idx];
    if (!doc) return null;

    const url = `https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${accession}/${doc}`;
    const html = await fetchText(url, {
      headers: HEADERS,
      timeoutMs: 60_000,
      retries: 1,
      maxBytes: 24 * 1024 * 1024,
    });

    const text = htmlToText(html);
    const sections = sectionise(text, r.form[idx]);
    const risk = sections.find((s) => s.role === "risk");

    return {
      form: r.form[idx],
      filingDate: r.filingDate[idx],
      periodEnd: r.reportDate?.[idx] ?? null,
      url,
      chars: text.length,
      sections: sections.map((s) => ({ ...s, text: s.text.slice(0, 400_000) })),
      riskHeadings: risk ? riskHeadings(risk.text) : [],
      signals: extractSignals(sections),
    };
  });

  if (!res.value) return null;

  return {
    ...res.value,
    provenance: {
      kind: res.fresh ? "filing" : "cached",
      source: `${res.value.form} filed ${res.value.filingDate}, narrative sections`,
      url: res.value.url,
      retrievedAt: new Date(res.storedAt).toISOString(),
      sourceDatedAt: res.value.periodEnd ?? undefined,
      note: `${res.value.sections.length} items sectioned from ${res.value.chars.toLocaleString("en-US")} characters.`,
    },
  };
}

/** Convenience read used by agents, by role rather than by item number. */
export function section(f: FilingText | null, role: SectionRole): FilingSection | null {
  return f?.sections.find((s) => s.role === role) ?? null;
}
