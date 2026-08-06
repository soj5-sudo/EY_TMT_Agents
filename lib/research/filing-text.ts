import { fetchJson, fetchText } from "@/lib/core/fetcher";
import { cached } from "@/lib/core/cache";
import type { Provenance } from "@/lib/core/types";

const TTL_MS = 12 * 60 * 60 * 1000;

const HEADERS = {
  "User-Agent": "EY TMT Intelligence Console soj5@cornell.edu",
};

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
  label: string;
  sentence: string;
  item: string;
}

export interface FilingText {
  form: string;
  filingDate: string;
  periodEnd: string | null;
  url: string;
  chars: number;
  sections: FilingSection[];
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

const BLOCK = /<\/(p|div|tr|h[1-6]|li|table|section)>/gi;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
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

interface ItemDef {
  title: string;
  role: SectionRole;
}

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

function sectionise(text: string, form: string): FilingSection[] {
  const map = form.startsWith("20-F") || form.startsWith("40-F") ? ITEMS_20F : ITEMS_10K;

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
    if (body.length < 600) continue;
    const def = map[item];
    out.push({ item, role: def.role, title: def.title, text: body, chars: body.length });
  }

  return out.sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }));
}

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
    if (lines[i + 1].length < line.length) continue;
    if (!/\b(may|could|might|will|risk|failure|inability|depend|adverse|if we|our business|subject to)\b/i.test(line))
      continue;
    out.push(line.replace(/\s+/g, " "));
    if (out.length >= 40) break;
  }

  return [...new Set(out)];
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 40 && s.length < 700);
}

interface Rule {
  label: string;
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

export function section(f: FilingText | null, role: SectionRole): FilingSection | null {
  return f?.sections.find((s) => s.role === role) ?? null;
}
