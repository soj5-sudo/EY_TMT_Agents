/**
 * Agent analysis.
 *
 * One function per agent. Each reads the shared record and computes something
 * from it: a ratio, a comparison against the peer set, a disclosed sentence
 * from the annual report, a figure from a workbook the company published.
 *
 * The rule every function follows is that a finding must be derivable from a
 * retrieved value. Where the evidence for an agent's question is genuinely not
 * public, the agent raises a specific request naming the document and who holds
 * it, rather than restating its own remit in different words. A run in which
 * most agents say only that they reviewed the record is not a review, and the
 * request list is the honest output in that case.
 */

import type { CompanyDossier } from "@/lib/research/company";
import type { FactKey, FactLedger } from "@/lib/research/facts";
import type { FilingText, SectionRole, TextSignal } from "@/lib/research/filing-text";
import { findMetric } from "@/lib/research/ir-scrape";

export type Severity = "risk" | "attention" | "info";

export interface Emit {
  find(
    severity: Severity,
    headline: string,
    detail: string,
    metric?: { label: string; value: string },
  ): void;
  gap(item: string, blocks: string, requestFrom: string, priority?: "high" | "medium" | "low"): void;
}

export interface PriorFinding {
  agentName: string;
  severity: Severity;
  headline: string;
  detail: string;
  metric?: { label: string; value: string };
}

export type SeatFn = (d: CompanyDossier, e: Emit, prior: PriorFinding[]) => void;

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

function usd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}tn`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

function pct(v: number, dp = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

function pp(v: number, dp = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)} points`;
}

function n0(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/* ------------------------------------------------------------------ *
 * Reading the record
 * ------------------------------------------------------------------ */

function f(d: CompanyDossier, k: FactKey): number | null {
  return d.facts?.series[k]?.latest ?? null;
}

function fPrior(d: CompanyDossier, k: FactKey): number | null {
  return d.facts?.series[k]?.prior ?? null;
}

/** Balance sheet reads use the latest instant rather than a duration. */
function bal(d: CompanyDossier, k: FactKey): number | null {
  return d.facts?.series[k]?.instant ?? null;
}

function tag(d: CompanyDossier, k: FactKey): string {
  return d.facts?.series[k]?.tag ?? "";
}

function annual(d: CompanyDossier, k: FactKey) {
  return d.facts?.series[k]?.annual ?? [];
}

/**
 * The longest usable run of periods for a concept.
 *
 * Registrants file years, and a publisher outside the register usually
 * publishes quarters with at most one full year alongside. Reading only the
 * annual series therefore starves every trend test for the entire
 * non-registrant cohort, which is not an absence of evidence, only an absence
 * of that particular shape of it.
 */
function history(d: CompanyDossier, k: FactKey) {
  const s = d.facts?.series[k];
  if (!s) return [];
  if (s.annual.length >= 3) return s.annual;
  if (s.quarterly.length >= 3) return s.quarterly;
  return s.annual.length >= 2 ? s.annual : s.quarterly;
}

/**
 * Two concepts over the same periods, on whichever basis actually pairs.
 * Mixing an annual numerator with a quarterly denominator produces a ratio
 * that is wrong by a factor of four and carries no sign of it.
 */
function paired(d: CompanyDossier, a: FactKey, b: FactKey) {
  const sa = d.facts?.series[a];
  const sb = d.facts?.series[b];
  if (!sa || !sb) return [];
  for (const basis of ["annual", "quarterly"] as const) {
    const out = sa[basis]
      .map((p) => {
        const m = sb[basis].find((x) => x.end === p.end);
        return m ? { label: p.label, a: p.value, b: m.value } : null;
      })
      .filter((x): x is { label: string; a: number; b: number } => x !== null);
    if (out.length >= 2) return out;
  }
  return [];
}

/**
 * A ratio that refuses to divide by a denominator too small to carry meaning.
 * Without the floor a near-zero denominator prints a four-figure percentage
 * that reads as a finding and is arithmetic noise.
 */
function safeRatio(num: number | null, den: number | null, floor = 0): number | null {
  if (num === null || den === null) return null;
  if (den === 0 || Math.abs(den) <= floor) return null;
  return num / den;
}

function marginOf(d: CompanyDossier, k: FactKey): number | null {
  const r = safeRatio(f(d, k), f(d, "revenue"));
  return r === null ? null : r * 100;
}

/** Days a balance represents against an annual flow. */
function days(balance: number | null, flow: number | null): number | null {
  const r = safeRatio(balance, flow);
  return r === null ? null : r * 365;
}

function period(d: CompanyDossier): string {
  return d.facts?.series.revenue?.annual.at(-1)?.label ?? "the latest reported year";
}

function periodEnd(d: CompanyDossier): string | null {
  return d.facts?.series.revenue?.annual.at(-1)?.end ?? null;
}

function sect(d: CompanyDossier, role: SectionRole) {
  return d.filing?.sections.find((s) => s.role === role) ?? null;
}

function sig(d: CompanyDossier, key: keyof FilingText["signals"]): TextSignal[] {
  return d.filing?.signals[key] ?? [];
}

/** Trims a disclosed sentence to something quotable in a paper. */
function quote(s: string, max = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}

/** The first percentage in a sentence, when it states one. */
function firstPct(s: string): number | null {
  const m = s.match(/(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)/);
  return m ? Number(m[1]) : null;
}

/**
 * Headcount stated in a disclosure sentence.
 *
 * The number has to be taken from immediately before the noun it counts.
 * Taking the first large integer in the sentence instead reads the year out of
 * "As of August 31, 2025, we employed approximately 779,000 people" and then
 * divides revenue by it, which produces a revenue per head figure three orders
 * of magnitude wrong and entirely plausible looking.
 */
const HEADCOUNT =
  /\b(\d{1,3}(?:,\d{3})+|\d{4,})\b(?:\s+(?:full[- ]time|part[- ]time|permanent|regular))?\s+(?:employees|people|professionals|personnel|staff|colleagues)\b/i;

function employeeCount(d: CompanyDossier): { count: number; sentence: string } | null {
  // A publisher outside the register states headcount as a row in its own
  // results file rather than in a narrative sentence.
  const published = d.facts?.series.employees;
  const latest = published?.annual.at(-1) ?? published?.quarterly.at(-1);
  if (latest && latest.value >= 50) {
    return {
      count: Math.round(latest.value),
      sentence: `${published!.tag}, ${latest.label}: ${Math.round(latest.value).toLocaleString("en-US")}`,
    };
  }

  for (const s of sig(d, "employees")) {
    const m = s.sentence.match(HEADCOUNT);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ""));
    // A bare four digit number in this position is almost always a year.
    if (!Number.isFinite(n) || n < 50) continue;
    if (n >= 1900 && n <= 2100 && !m[1].includes(",")) continue;
    return { count: n, sentence: s.sentence };
  }
  return null;
}

/** Currency the investor relations figures are stated in. */
function irCurrency(d: CompanyDossier): string {
  return d.resolved.inUniverse?.currency ?? "local currency";
}

function irMetric(d: CompanyDossier, patterns: RegExp[]) {
  if (!d.ir || d.ir.metrics.length === 0) return null;
  return findMetric(d.ir.metrics, patterns);
}

/** Median of a set, used wherever a peer comparison is made. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}


/**
 * What the console actually holds for a subject outside the SEC register.
 *
 * These companies publish everything a registrant files, but as workbooks and
 * results releases on their own site rather than as a narrative annual report
 * with numbered items. An agent whose question is normally answered from that
 * narrative still has the published record in front of it, and saying what was
 * searched and what was found is a real answer. Reporting the agent as blocked
 * would be false: the documents are downloaded and parsed.
 */
function publishedBase(d: CompanyDossier): string | null {
  if (!d.ir || d.ir.metrics.length === 0) return null;
  const files = d.ir.read.filter((r) => r.ok).map((r) => r.doc.filename);
  let host = d.ir.indexUrl;
  try {
    host = new URL(d.ir.indexUrl).hostname;
  } catch {
    // Keep the raw string when the index URL is not parseable.
  }
  return (
    `${d.ir.metrics.length} published metric rows covering ${d.ir.periods.length} periods, ` +
    `read from ${files.join(" and ")} on ${host}`
  );
}

/** Where a non-registrant's equivalent narrative disclosure is actually filed. */
function narrativeHome(d: CompanyDossier): string {
  const region = d.resolved.inUniverse?.region;
  if (region === "India") return "the annual report and the stock exchange filings made to BSE and NSE";
  if (region === "Europe") return "the universal registration document filed with the national regulator";
  return "the annual report published on the company's own investor relations site";
}

/* ------------------------------------------------------------------ *
 * Shared request text
 * ------------------------------------------------------------------ */

const DATA_ROOM = "Company or vendor data room";
const IR_SITE = "Company investor relations site";

/** Names the source an agent already holds, so a request is not made twice. */
function held(d: CompanyDossier): string {
  const parts: string[] = [];
  if (d.facts) parts.push(`${d.facts.conceptsResolved} tagged concepts`);
  if (d.filing) parts.push(`${d.filing.sections.length} sections of the ${d.filing.form}`);
  if (d.ir && d.ir.metrics.length > 0) parts.push(`${d.ir.metrics.length} published metric rows`);
  if (d.documents.length > 0) parts.push(`${d.documents.length} supplied documents`);
  return parts.join(", ");
}

/* ================================================================== *
 * 00 Context and intake
 * ================================================================== */

const search: SeatFn = (d, e) => {
  if (d.resolved.cik) {
    e.find(
      "info",
      `Subject resolved to ${d.resolved.name}`,
      `Registrant number ${d.resolved.cik}` +
        (d.resolved.exchanges.length ? `, listed on ${d.resolved.exchanges.join(", ")}` : "") +
        (d.resolved.sicDescription ? `, classified as ${d.resolved.sicDescription}` : "") +
        `. The record assembled for this run holds ${d.filings.length} filings, ` +
        `${d.facts?.conceptsResolved ?? 0} tagged financial concepts of ${d.facts?.conceptsRequested ?? 0} requested, ` +
        (d.filing
          ? `the ${d.filing.form} filed ${d.filing.filingDate} sectioned into ${d.filing.sections.length} items, `
          : "no annual report narrative, ") +
        `and ${d.news.length} verified items of coverage.`,
      { label: "Concepts resolved", value: `${d.facts?.conceptsResolved ?? 0}` },
    );

    if (d.resolved.tickers.length > 1) {
      e.find(
        "info",
        `${d.resolved.tickers.length} listed instruments map to this registrant`,
        `Tickers on the register: ${d.resolved.tickers.join(", ")}. Confirm which line the mandate refers to before any per-share figure is used, since an ADR and an ordinary share do not carry the same ratio.`,
      );
    }
    return;
  }

  if (d.resolved.inUniverse) {
    const c = d.resolved.inUniverse;
    const files = d.ir?.read.filter((r) => r.ok).length ?? 0;
    e.find(
      "info",
      `Subject resolved to ${d.resolved.name}`,
      `Listed as ${c.symbol} (${c.region}), ${c.subsector.toLowerCase()} within ${c.sector.toLowerCase()}, reporting in ${c.currency}. ` +
        `Not a US registrant, so the reported record is the company's own published documents: ` +
        (d.ir
          ? `${d.ir.discovered} files found on ${new URL(d.ir.indexUrl).hostname}, ${files} downloaded and read, yielding ${d.ir.metrics.length} labelled metric rows across ${d.ir.periods.length} periods.`
          : "no investor relations index is wired for this name."),
      { label: "Metric rows read", value: String(d.ir?.metrics.length ?? 0) },
    );

    if (!d.ir || d.ir.metrics.length === 0) {
      e.gap(
        "Published quarterly results file",
        "The entity is identified, but without its published documents the reported record is empty and every financial agent below is reading nothing.",
        IR_SITE,
        "high",
      );
    }
    return;
  }

  e.gap(
    "Entity identification",
    "No later agent can be trusted until the subject is pinned to one legal entity. A wrong entity is the most expensive error in a review and the hardest to notice late.",
    "Confirm the registered name, or supply the certificate of incorporation",
    "high",
  );
};

const intake: SeatFn = (d, e) => {
  let reported = false;

  if (d.facts) {
    const resolved = d.facts.conceptsResolved;
    const missing = d.facts.conceptsRequested - resolved;
    e.find(
      missing > 12 ? "attention" : "info",
      `${resolved} of ${d.facts.conceptsRequested} diligence concepts normalised from the tagged record`,
      `The filer has tagged ${d.facts.conceptsTagged} concepts in total across ${d.facts.taxonomies.join(", ")}. ` +
        `Of the set this review asks for, ${resolved} resolved and ${missing} are not reported by this filer. ` +
        `Fiscal year ends ${d.facts.fiscalYearEnd ?? "not stated"}, which is what every period label in this run is derived from rather than the filing's own fiscal year field.`,
      { label: "Concepts normalised", value: `${resolved}/${d.facts.conceptsRequested}` },
    );
    reported = true;
  }

  if (d.filing) {
    e.find(
      "info",
      `${d.filing.sections.length} narrative sections read from the ${d.filing.form}`,
      `Filed ${d.filing.filingDate}` +
        (d.filing.periodEnd ? ` for the period ended ${d.filing.periodEnd}` : "") +
        `, reduced to ${n0(d.filing.chars)} characters and cut into items: ` +
        d.filing.sections.map((s) => `${s.title} (${n0(s.chars)} chars)`).slice(0, 6).join(", ") +
        `. ${d.filing.riskHeadings.length} principal risks were recovered as separate headings.`,
      { label: "Sections", value: String(d.filing.sections.length) },
    );
    reported = true;
  }

  if (d.ir && d.ir.metrics.length > 0) {
    const ok = d.ir.read.filter((r) => r.ok);
    e.find(
      "info",
      `${d.ir.metrics.length} metric rows read from ${ok.length} published file${ok.length === 1 ? "" : "s"}`,
      ok
        .map(
          (r) =>
            `${r.doc.filename} (${Math.round(r.bytes / 1024)} kB, ${r.sheets} sheets, ${r.metrics.length} rows)`,
        )
        .join("; ") +
        `. Periods covered: ${d.ir.periods.slice(0, 8).join(", ")}. Figures are as published, in ${irCurrency(d)}, with no interpolation between periods.`,
      { label: "Rows read", value: String(d.ir.metrics.length) },
    );
    reported = true;
  }

  if (d.documents.length > 0) {
    const figures = d.documents.reduce((s, x) => s + x.extracted.length, 0);
    e.find(
      "info",
      `${d.documents.length} supplied document${d.documents.length === 1 ? "" : "s"} normalised`,
      d.documents
        .map((x) => `${x.name}, ${x.pages ?? "unknown"} pages, ${x.extracted.length} tagged figures`)
        .join("; ") +
        `. ${figures} figures recovered with surrounding context retained, so any one of them can be traced back to where it was read.`,
      { label: "Tagged figures", value: String(figures) },
    );
    reported = true;
  }

  if (!reported) {
    e.gap(
      "Management pack, trial balance and KPI file",
      "Nothing was recovered from the public record for this subject, so the run has no reported base at all.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  if (d.documents.length === 0) {
    e.gap(
      "Management pack and supporting schedules",
      "The public record is assembled. A management pack would add the customer, contract and cost detail that published documents do not carry.",
      DATA_ROOM,
      "low",
    );
  }
};

const explain: SeatFn = (d, e) => {
  const business = sect(d, "business");
  const rev = f(d, "revenue");
  const op = marginOf(d, "operatingIncome");

  if (business) {
    // The opening paragraphs of the business item are the company's own
    // description of what it sells. Quoting it is what stops the reader
    // substituting their assumption about the business model.
    const opening = business.text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 120)
      .slice(0, 2)
      .join(" ");

    e.find(
      "info",
      `The subject describes itself in its own filing`,
      (opening ? `From the ${d.filing?.form ?? "annual report"}, ${business.title} item: "${quote(opening, 420)}" ` : "") +
        (rev !== null
          ? `Read against the numbers, that is ${usd(rev)} US dollars of revenue in ${period(d)}` +
            (op !== null ? ` at a ${op.toFixed(1)} percent operating margin.` : ".")
          : ""),
      rev !== null ? { label: "Revenue", value: `${usd(rev)} USD` } : undefined,
    );
    return;
  }

  if (rev !== null) {
    e.find(
      "info",
      `Reported scale is ${usd(rev)} US dollars of revenue in ${period(d)}`,
      (op !== null ? `Operating margin ${op.toFixed(1)} percent. ` : "") +
        `The narrative sections of the annual report were not available on this run, so this reading is from the tagged figures alone. ` +
        `Read the level with the trajectory rather than on its own: ${d.derived.revenueCagrPct !== null ? `compound growth over the filed history is ${pct(d.derived.revenueCagrPct)}` : "the filed history is too short to state a trajectory"}.`,
      { label: "Revenue", value: `${usd(rev)} USD` },
    );
    return;
  }

  e.gap(
    "A described business model with revenue by line",
    "Without either the narrative sections or a reported revenue figure there is nothing to interpret, and an interpretation invented here would propagate into every workstream below.",
    d.resolved.cik ? DATA_ROOM : IR_SITE,
    "high",
  );
};

/* ================================================================== *
 * 01 Screening and thesis
 * ================================================================== */

const screen: SeatFn = (d, e) => {
  const rev = d.derived.latestRevenueUsd;
  const cagr = d.derived.revenueCagrPct;

  if (rev === null) {
    e.gap(
      "Three years of audited revenue",
      "Scale and trajectory cannot be tested against the mandate band, which is the first gate in the process.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  e.find(
    cagr !== null && cagr < 0 ? "risk" : cagr !== null && cagr < 5 ? "attention" : "info",
    `Revenue ${usd(rev)} US dollars, compound growth ${cagr !== null ? pct(cagr) : "not established"}`,
    `Latest reported year against ${d.derived.years + 1} periods on file. ` +
      (cagr !== null && cagr < 5
        ? "Growth below five percent puts the case on multiple expansion or cost action rather than on the top line, which is a materially harder underwrite."
        : "Trajectory supports a growth case, subject to the commercial workstream separating market growth from share gain."),
    { label: "Revenue", value: `${usd(rev)} USD` },
  );

  // Scale relative to the sector the subject sits in.
  if (d.resolved.inUniverse) {
    e.find(
      "info",
      `Screened as ${d.resolved.inUniverse.subsector.toLowerCase()} within ${d.resolved.inUniverse.sector.toLowerCase()}`,
      `Exposed to ${d.resolved.inUniverse.themes.join(", ").replace(/-/g, " ")}. ` +
        `${d.peers.length} names in the coverage universe sit in the same subsector and are used as the comparison set by the agents below, ` +
        `so every judgement of position in this run is made against a stated peer group rather than against an unstated norm.`,
      { label: "Peer set", value: String(d.peers.length) },
    );
  }
};

const thesis: SeatFn = (d, e) => {
  const cagr = d.derived.revenueCagrPct;
  const op = marginOf(d, "operatingIncome");
  const opPrior = safeRatio(fPrior(d, "operatingIncome"), fPrior(d, "revenue"));
  const rnd = marginOf(d, "rnd");

  const levers: string[] = [];
  const missing: string[] = [];

  if (cagr !== null) {
    levers.push(
      cagr >= 10
        ? `growth is the primary lever at ${pct(cagr)} compound, and the case can be underwritten on volume`
        : cagr >= 4
          ? `growth at ${pct(cagr)} compound contributes but does not carry the case on its own`
          : `growth at ${pct(cagr)} is not a lever, so the return has to come from margin or from the entry multiple`,
    );
  } else missing.push("a revenue trajectory");

  if (op !== null && opPrior !== null) {
    const shift = op - opPrior * 100;
    levers.push(
      shift >= 0.5
        ? `margin is already expanding, ${pp(shift)} year on year to ${op.toFixed(1)} percent, so the operating case is being demonstrated rather than assumed`
        : shift <= -0.5
          ? `margin is contracting ${pp(shift)} to ${op.toFixed(1)} percent, which has to be arrested before any expansion is underwritten`
          : `margin is flat at ${op.toFixed(1)} percent, so any margin case is an assertion about what a new owner would change`,
    );
  } else if (op !== null) {
    levers.push(`margin stands at ${op.toFixed(1)} percent with no prior year to compare against`);
  } else missing.push("an operating margin");

  if (rnd !== null) {
    levers.push(
      rnd >= 12
        ? `research at ${rnd.toFixed(1)} percent of revenue means the forward position is being bought now, and cutting it is a lever that borrows from the terminal value`
        : `research at ${rnd.toFixed(1)} percent of revenue leaves little to cut without touching the product`,
    );
  }

  if (levers.length === 0) {
    e.gap(
      "Revenue and operating income for three years",
      "A thesis is a statement about which lever produces the return. With no trajectory and no margin there is no lever to name, and a thesis written now would be a preference rather than a finding.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  e.find(
    "info",
    `Value creation rests on ${cagr !== null && cagr >= 10 ? "the top line" : op !== null && op >= 20 ? "defending an already high margin" : "multiple and execution"}`,
    `What would have to be true, read from the filed record: ${levers.join("; ")}. ` +
      (missing.length > 0 ? `Not established on the public record: ${missing.join(", ")}. ` : "") +
      `Each of these is testable in the workstreams below, which is the point of writing them down before the diligence rather than after it.`,
    cagr !== null ? { label: "Compound growth", value: pct(cagr) } : undefined,
  );

  e.gap(
    "Management's own plan with the bridge from current to target",
    "The thesis above is derived from history. Testing it means comparing it against what management says it will do and why, which is not a public document.",
    DATA_ROOM,
    "medium",
  );
};

const redFlag: SeatFn = (d, e) => {
  let raised = 0;

  const amendments = d.filings.filter((x) => x.form.includes("/A"));
  if (amendments.length > 0) {
    raised++;
    e.find(
      "risk",
      `${amendments.length} amended filing${amendments.length === 1 ? "" : "s"} on the record`,
      `Amended forms: ${amendments.slice(0, 4).map((x) => `${x.form} filed ${x.filingDate}`).join(", ")}. ` +
        `An amendment restates something previously filed. The question is always what changed and whether it was disclosed, not whether an amendment exists.`,
      { label: "Amendments", value: String(amendments.length) },
    );
  }

  const impair = f(d, "impairment");
  if (impair !== null && impair > 0) {
    raised++;
    const share = safeRatio(impair, f(d, "revenue"));
    e.find(
      share !== null && share > 0.02 ? "risk" : "attention",
      `Impairment of ${usd(impair)} US dollars charged in ${period(d)}`,
      `Tagged as ${tag(d, "impairment")}` +
        (share !== null ? `, which is ${(share * 100).toFixed(1)} percent of revenue` : "") +
        `. An impairment is management writing down its own earlier acquisition case. It is the clearest public signal that a prior deal did not perform, and it should be read alongside the acquisition history before any roll-up thesis is underwritten.`,
      { label: "Impairment", value: `${usd(impair)} USD` },
    );
  }

  const restr = f(d, "restructuring");
  if (restr !== null && restr > 0) {
    raised++;
    const share = safeRatio(restr, f(d, "revenue"));
    e.find(
      share !== null && share > 0.03 ? "attention" : "info",
      `Restructuring charge of ${usd(restr)} US dollars in ${period(d)}`,
      (share !== null ? `That is ${(share * 100).toFixed(1)} percent of revenue. ` : "") +
        `Recurring restructuring is a contradiction: a charge presented as one-off in three consecutive years is part of the cost base and belongs in the earnings run rate rather than below it.`,
      { label: "Restructuring", value: `${usd(restr)} USD` },
    );
  }

  const eightK = d.filings.filter((x) => x.form.startsWith("8-K"));
  if (eightK.length >= 8) {
    raised++;
    e.find(
      "attention",
      `${eightK.length} current reports in the retained window`,
      `Current reports carry material events between periodic filings. A high count is not adverse in itself, but it indicates an eventful period that the commercial and legal workstreams should account for.`,
      { label: "Current reports", value: String(eightK.length) },
    );
  }

  const negative = d.news.filter((x) =>
    /\b(probe|lawsuit|investigat\w+|fine[ds]?|breach|resign\w*|short seller|downgrade|delay|restat\w+)\b/i.test(
      x.title,
    ),
  );
  if (negative.length > 0) {
    raised++;
    e.find(
      "attention",
      `${negative.length} coverage item${negative.length === 1 ? "" : "s"} carrying an adverse signal`,
      negative.slice(0, 3).map((x) => `"${x.title}" (${x.publisher})`).join("; ") +
        ". Reproduced from verified publishers and not independently confirmed.",
      { label: "Adverse items", value: String(negative.length) },
    );
  }

  if (raised === 0) {
    e.find(
      "info",
      "No early disqualifier found in the public record",
      `Tested: amended filings (${d.filings.filter((x) => x.form.includes("/A")).length}), impairment charges, restructuring charges, current-report cadence (${eightK.length} in the window) and adverse coverage (${d.news.length} items screened). ` +
        `None of these is raised. This clears the screening gate only; it is not a statement about matters that never reach the public record.`,
      { label: "Checks cleared", value: "5" },
    );
  }
};

const strategicFit: SeatFn = (d, e) => {
  const rev = d.derived.latestRevenueUsd;
  const op = marginOf(d, "operatingIncome");

  if (!d.resolved.inUniverse || d.peers.length === 0) {
    if (rev === null) {
      e.gap(
        "A stated mandate band and a comparable set",
        "Fit is a comparison. Without either a peer group or a size and return band to test against, any statement here would be an opinion rather than a finding.",
        "Investment committee mandate document",
        "medium",
      );
      return;
    }
    e.find(
      "info",
      `Subject sits outside the tracked coverage universe`,
      `Reported revenue of ${usd(rev)} US dollars` +
        (op !== null ? ` at a ${op.toFixed(1)} percent operating margin` : "") +
        `. No peer group is defined for this name in the console, so fit is stated against the mandate rather than against comparables. ` +
        `Supplying a comparable set would let this agent test position rather than level.`,
      { label: "Revenue", value: `${usd(rev)} USD` },
    );
    return;
  }

  const c = d.resolved.inUniverse;
  e.find(
    "info",
    `Fits the ${c.subsector.toLowerCase()} cohort, ${d.peers.length} tracked comparables`,
    `Comparable names: ${d.peers.slice(0, 8).map((p) => p.short).join(", ")}${d.peers.length > 8 ? ` and ${d.peers.length - 8} more` : ""}. ` +
      (rev !== null ? `The subject reports ${usd(rev)} US dollars of revenue` : "") +
      (op !== null ? ` at a ${op.toFixed(1)} percent operating margin. ` : ". ") +
      `Thematic exposure is ${c.themes.join(", ").replace(/-/g, " ")}, which is what determines whether this sits in the same underwriting bucket as the rest of a portfolio or diversifies it.`,
    { label: "Comparables", value: String(d.peers.length) },
  );
};

/* ================================================================== *
 * 02 Commercial
 * ================================================================== */

const market: SeatFn = (d, e) => {
  const geo = sig(d, "geography");
  const cagr = d.derived.revenueCagrPct;
  let said = false;

  if (geo.length > 0) {
    e.find(
      "info",
      `Geographic exposure stated in the ${d.filing?.form ?? "annual report"}`,
      geo.slice(0, 2).map((g) => `"${quote(g.sentence, 260)}"`).join(" ") +
        ` Read from item ${geo[0].item}. Where a business earns determines which macro series actually drives it, and it is the first thing a forecast built on a single country index gets wrong.`,
      { label: "Disclosures", value: String(geo.length) },
    );
    said = true;
  }

  if (cagr !== null) {
    e.find(
      cagr < 0 ? "risk" : "info",
      `Demand read from ${d.derived.years + 1} filed periods: ${pct(cagr)} compound`,
      `The filed series is the only demand evidence on the public record. It measures the subject, not its market, so it cannot separate market growth from share gain on its own. ` +
        `The industry agent below sets the market rate from the peer cohort, and the difference between the two is the share movement.`,
      { label: "Compound growth", value: pct(cagr) },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Market sizing with the served segment defined",
      "Neither a geographic disclosure nor a revenue trajectory was recovered, so there is nothing from which to read demand.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Third-party market sizing for the served segment",
    "Filed revenue shows what the subject captured, never the size of what it was competing for. Sizing the pool is what turns a growth number into a share statement.",
    "Independent market research, or the vendor's own commissioned study",
    "medium",
  );
};

const industry: SeatFn = (d, e) => {
  if (!d.resolved.inUniverse || d.peers.length === 0) {
    e.gap(
      "A defined comparable cohort",
      "Industry structure is a statement about a group. The subject is not mapped to a tracked cohort, so no cohort statistic can be computed for it.",
      "Confirm the comparable set with the deal team",
      "medium",
    );
    return;
  }

  const c = d.resolved.inUniverse;
  e.find(
    "info",
    `${c.subsector} cohort holds ${d.peers.length + 1} tracked names`,
    `Cohort: ${[c, ...d.peers].map((p) => p.short).join(", ")}. ` +
      `Regions represented: ${[...new Set([c, ...d.peers].map((p) => p.region))].join(", ")}. ` +
      `Thematic exposure across the cohort: ${[...new Set([c, ...d.peers].flatMap((p) => p.themes))].join(", ").replace(/-/g, " ")}. ` +
      `A cohort spanning several regions and one theme concentrates on the theme rather than diversifying it, which matters when the same driver is already held elsewhere in a portfolio.`,
    { label: "Cohort size", value: String(d.peers.length + 1) },
  );

  const rev = d.derived.latestRevenueUsd;
  if (rev !== null) {
    e.find(
      "info",
      `Subject scale within the cohort`,
      `The subject reports ${usd(rev)} US dollars. Cohort revenue is not fetched inside a single-company run, so relative scale is stated on the sector dashboard rather than computed here. ` +
        `What this agent establishes is the comparison set itself, which is the input every later comparative judgement in this run depends on.`,
    );
  }
};

const competitor: SeatFn = (d, e) => {
  const comp = sig(d, "competition");

  if (comp.length > 0) {
    e.find(
      "attention",
      `Competitive position as the company itself describes it`,
      comp.slice(0, 3).map((x) => `"${quote(x.sentence, 240)}"`).join(" ") +
        ` Recovered from item ${comp[0].item} of the ${d.filing?.form ?? "annual report"}. ` +
        `A filer's own competition disclosure is written to satisfy a regulator rather than to inform a buyer, so it understates rather than overstates. Treat named threats as a floor.`,
      { label: "Disclosures", value: String(comp.length) },
    );
  } else {
    e.gap(
      "The company's competition disclosure or a named competitor set",
      "No competition statement was recovered from the filed narrative, so there is no disclosed threat set to test the position against.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "medium",
    );
  }

  if (d.peers.length > 0) {
    e.find(
      "info",
      `${d.peers.length} tracked comparables carry the same subsector exposure`,
      `${d.peers.map((p) => p.short).slice(0, 10).join(", ")}. ` +
        `These are the names a buyer would be underwriting against, whether or not the filing lists them. ` +
        `Any of them can be run through this same workstream for a like-for-like read, which is what makes a relative judgement defensible rather than impressionistic.`,
      { label: "Comparables", value: String(d.peers.length) },
    );
  }

  e.gap(
    "Win and loss data by competitor",
    "Filed disclosures name competitors but never say who wins. Rate movement by named competitor is the only evidence that settles a position argument.",
    DATA_ROOM,
    "high",
  );
};

const customer: SeatFn = (d, e) => {
  const conc = sig(d, "customerConcentration");
  let said = false;

  if (conc.length > 0) {
    const stated = firstPct(conc[0].sentence);
    e.find(
      stated !== null && stated >= 20 ? "risk" : stated !== null && stated >= 10 ? "attention" : "info",
      stated !== null
        ? `Customer concentration disclosed at ${stated} percent`
        : `Customer concentration disclosed in the filed narrative`,
      `"${quote(conc[0].sentence, 320)}" Read from item ${conc[0].item}. ` +
        (stated !== null && stated >= 20
          ? "Concentration at this level means the renewal calendar is the single largest determinant of value, and it belongs in the price rather than in the risk register."
          : "Concentration disclosures set a floor rather than a full picture; the contract-level detail is what sizes the renewal exposure."),
      stated !== null ? { label: "Concentration", value: `${stated}%` } : undefined,
    );
    said = true;
  }

  // Receivables days are the collection read, and they are computable from the
  // tagged record without any management input.
  const dso = days(bal(d, "receivables"), f(d, "revenue"));
  if (dso !== null) {
    const priorDso = days(d.facts?.series.receivables?.annual.at(-2)?.value ?? null, fPrior(d, "revenue"));
    const shift = priorDso !== null ? dso - priorDso : null;
    e.find(
      dso > 110 ? "attention" : shift !== null && shift > 12 ? "attention" : "info",
      `Receivables represent ${dso.toFixed(0)} days of revenue`,
      `Computed from ${tag(d, "receivables")} against revenue for ${period(d)}. ` +
        (shift !== null
          ? `That is ${shift >= 0 ? "up" : "down"} ${Math.abs(shift).toFixed(0)} days on the prior year. `
          : "") +
        (dso > 110
          ? "Collection stretching this far usually means either a concentrated customer dictating terms or revenue recognised well ahead of billing. Both change the cash case."
          : "Collection is within the range expected for a business of this type, which supports the revenue being converted rather than merely booked."),
      { label: "Days sales outstanding", value: `${dso.toFixed(0)} days` },
    );
    said = true;
  }

  const unbilled = bal(d, "unbilled");
  const rev = f(d, "revenue");
  if (unbilled !== null && rev !== null) {
    const share = (unbilled / rev) * 100;
    e.find(
      share > 12 ? "attention" : "info",
      `Unbilled receivables at ${share.toFixed(1)} percent of revenue`,
      `${usd(unbilled)} US dollars tagged as ${tag(d, "unbilled")}. ` +
        `Unbilled balances are revenue recognised where the right to invoice has not yet crystallised. ` +
        (share > 12
          ? "A balance this size relative to revenue is where recognition judgement concentrates, and it is the first place to test the contract terms against the accounting policy."
          : "The balance is proportionate, which is what a normal delivery and billing cycle produces."),
      { label: "Unbilled", value: `${share.toFixed(1)}% of revenue` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Revenue by customer for three years",
      "Neither a concentration disclosure nor a receivables balance was recovered, so dependency cannot be sized at all.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Top twenty customers by revenue, with contract end dates",
    "Filed disclosure states concentration as a percentage at a point in time. Renewal risk needs the contract calendar, which is never public.",
    DATA_ROOM,
    "high",
  );
};

const growthDrivers: SeatFn = (d, e) => {
  const rpo = f(d, "orderBook");
  const rev = f(d, "revenue");
  let said = false;

  if (rpo !== null && rev !== null) {
    const cover = rpo / rev;
    e.find(
      cover < 0.25 ? "attention" : "info",
      `Order book of ${usd(rpo)} US dollars covers ${cover.toFixed(2)} times annual revenue`,
      `Tagged as ${tag(d, "orderBook")}, which is contracted revenue not yet recognised. ` +
        `This is the single most forward-looking figure a filer publishes: it is committed demand rather than a forecast. ` +
        (cover < 0.25
          ? "Cover below a quarter of a year means next year's revenue is mostly still to be won, so the growth case rests on sales execution rather than on the book."
          : cover >= 1
            ? "Cover above a full year means the near-term revenue line is substantially already contracted, which materially de-risks the base case."
            : "Cover at this level gives partial visibility; the balance has to come from renewal and new business."),
      { label: "Book to revenue", value: `${cover.toFixed(2)}x` },
    );
    said = true;
  }

  const deferred = bal(d, "deferredRevenue");
  if (deferred !== null && rev !== null) {
    const priorDef = d.facts?.series.deferredRevenue?.annual.at(-2)?.value ?? null;
    const growth = priorDef !== null && priorDef > 0 ? ((deferred - priorDef) / priorDef) * 100 : null;
    const revGrowth =
      fPrior(d, "revenue") !== null && fPrior(d, "revenue")! > 0
        ? ((rev - fPrior(d, "revenue")!) / fPrior(d, "revenue")!) * 100
        : null;

    e.find(
      growth !== null && revGrowth !== null && growth < revGrowth - 5 ? "attention" : "info",
      `Deferred revenue ${usd(deferred)} US dollars` + (growth !== null ? `, ${pct(growth)} year on year` : ""),
      `Tagged as ${tag(d, "deferredRevenue")}. Deferred revenue is cash collected before delivery, so it leads the revenue line. ` +
        (growth !== null && revGrowth !== null
          ? `It moved ${pct(growth)} while revenue moved ${pct(revGrowth)}. ` +
            (growth < revGrowth - 5
              ? "Billings growing slower than revenue means the recognised line is being fed by the existing balance rather than by new commitments, which is the earliest available warning that growth is decelerating."
              : "Billings keeping pace with or ahead of revenue supports the trajectory continuing.")
          : "No prior year balance was recovered, so the direction cannot be stated."),
      { label: "Deferred revenue", value: `${usd(deferred)} USD` },
    );
    said = true;
  }

  // Where the subject publishes its own operating metrics, read them.
  const irRev = irMetric(d, [/^revenue$/i, /^total revenue/i, /^gross revenue/i, /revenue from operations/i]);
  if (irRev && irRev.values.length >= 2) {
    const vals = irRev.values;
    e.find(
      "info",
      `Published quarterly revenue across ${vals.length} periods`,
      `"${irRev.label}" as published by the company, in ${irCurrency(d)}: ` +
        vals.map((v) => `${v.period} ${n0(v.value)}`).join(", ") +
        `. Figures are exactly as the company states them, read from the file it published rather than restated here.`,
      { label: "Periods published", value: String(vals.length) },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Revenue bridge from prior year: volume, price, mix, new logos",
      "Neither an order book, a deferred revenue balance nor a published quarterly series was recovered, so growth cannot be decomposed into its drivers.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Revenue bridge separating volume, price and new logos",
    "Order book and billings show that growth is contracted, never why. The bridge is what says whether it repeats.",
    DATA_ROOM,
    "medium",
  );
};

/* ================================================================== *
 * 03 Financial
 * ================================================================== */

const revenueQuality: SeatFn = (d, e) => {
  const series = history(d, "revenue");
  if (series.length < 3) {
    e.gap(
      "Revenue by contract type and the recognition policy note",
      "Fewer than three filed periods were recovered, so repeatability cannot be tested at all.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  const growths: Array<{ label: string; g: number }> = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].value > 0) {
      growths.push({
        label: series[i].label,
        g: ((series[i].value - series[i - 1].value) / series[i - 1].value) * 100,
      });
    }
  }

  const mean = growths.reduce((a, b) => a + b.g, 0) / growths.length;
  const variance = growths.reduce((a, b) => a + (b.g - mean) ** 2, 0) / growths.length;
  const vol = Math.sqrt(variance);

  e.find(
    vol > 30 ? "attention" : "info",
    `Revenue growth averages ${pct(mean)} with ${vol.toFixed(1)} points of dispersion`,
    `Year on year across ${growths.length} periods: ${growths.map((x) => `${x.label} ${pct(x.g, 0)}`).join(", ")}. ` +
      (vol > 30
        ? "Dispersion this wide means the average is not a forecast. Either the business is genuinely lumpy, in which case the base must be set conservatively, or the periods are not comparable."
        : "Dispersion is contained, which supports using the trend as a base for the forward case."),
    { label: "Growth dispersion", value: `${vol.toFixed(1)} pts` },
  );

  // Contracted backlog against recognised revenue is the repeatability read
  // that does not depend on management characterising its own revenue.
  const rpo = f(d, "orderBook");
  const rev = f(d, "revenue");
  if (rpo !== null && rev !== null) {
    e.find(
      "info",
      `${((rpo / rev) * 100).toFixed(0)} percent of a year's revenue is already contracted`,
      `Remaining performance obligations of ${usd(rpo)} US dollars against ${usd(rev)} of revenue. ` +
        `This is the closest a public filer comes to disclosing recurring revenue directly, and it is stronger evidence than any management characterisation of the revenue base because it is an accounting disclosure with a definition behind it.`,
      { label: "Contracted", value: `${((rpo / rev) * 100).toFixed(0)}%` },
    );
  }

  e.gap(
    "Revenue by customer and by contract term",
    "Repeatability cannot be separated from renewal risk on filed totals alone.",
    DATA_ROOM,
    "medium",
  );
};

const margin: SeatFn = (d, e) => {
  const series = paired(d, "revenue", "operatingIncome")
    .filter((x) => x.a > 0)
    .map((x) => ({ label: x.label, margin: (x.b / x.a) * 100 }));

  if (series.length < 2) {
    e.gap(
      "Operating income by period tied to revenue",
      "The margin bridge cannot be built from what was recovered, so no statement about operating leverage is available.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  const latest = series[series.length - 1];
  const prior = series[series.length - 2];
  const shift = latest.margin - prior.margin;

  e.find(
    shift < -2 ? "risk" : shift < 0 ? "attention" : "info",
    `Operating margin ${latest.margin.toFixed(1)} percent, ${shift >= 0 ? "up" : "down"} ${Math.abs(shift).toFixed(1)} points on the prior year`,
    `Series: ${series.map((x) => `${x.label} ${x.margin.toFixed(1)}%`).join(", ")}. ` +
      (shift < 0
        ? "A margin falling while revenue grows points at mix, at bought-in delivery capacity, or at price. Each has a different fix and only some of them are available to a buyer."
        : "Margin is holding or improving alongside the revenue line, which supports operating leverage rather than purchased growth."),
    { label: "Operating margin", value: `${latest.margin.toFixed(1)}%` },
  );

  // Decompose into the cost lines the filer actually tags, which is what turns
  // a margin movement into an explanation rather than an observation.
  const parts: string[] = [];
  for (const [key, name] of [
    ["costOfRevenue", "cost of revenue"],
    ["sga", "selling and administrative"],
    ["rnd", "research and development"],
  ] as Array<[FactKey, string]>) {
    const now = marginOf(d, key);
    const before = safeRatio(fPrior(d, key), fPrior(d, "revenue"));
    if (now === null) continue;
    parts.push(
      before !== null
        ? `${name} ${now.toFixed(1)} percent of revenue against ${(before * 100).toFixed(1)} the prior year`
        : `${name} ${now.toFixed(1)} percent of revenue`,
    );
  }

  if (parts.length > 0) {
    e.find(
      "info",
      `Cost base decomposed into ${parts.length} tagged line${parts.length === 1 ? "" : "s"}`,
      `${parts.join("; ")}. ` +
        `Reading the movement by line is what separates a mix effect from a price effect: a margin that falls because cost of delivery rose is a different problem from one that falls because discounting increased, and only one of them is fixable by an owner.`,
      { label: "Cost lines", value: String(parts.length) },
    );
  }

  const gross = marginOf(d, "grossProfit");
  if (gross !== null) {
    e.find(
      "info",
      `Gross margin ${gross.toFixed(1)} percent`,
      `The gap between gross and operating margin is ${(gross - latest.margin).toFixed(1)} points, which is the overhead the business carries. ` +
        `A wide gap is where an owner's cost case usually lives; a narrow one means the margin story has to be won in delivery rather than in overhead.`,
      { label: "Gross margin", value: `${gross.toFixed(1)}%` },
    );
  }
};

const workingCapital: SeatFn = (d, e) => {
  const rev = f(d, "revenue");
  const cogs = f(d, "costOfRevenue") ?? rev;

  const dso = days(bal(d, "receivables"), rev);
  const dio = days(bal(d, "inventory"), cogs);
  const dpo = days(bal(d, "payables"), cogs);

  const stated: string[] = [];
  if (dso !== null) stated.push(`${dso.toFixed(0)} days of receivables`);
  if (dio !== null) stated.push(`${dio.toFixed(0)} days of inventory`);
  if (dpo !== null) stated.push(`${dpo.toFixed(0)} days of payables`);

  if (stated.length === 0) {
    e.gap(
      "Aged receivables, payables and inventory listings",
      "None of the working capital components was recovered from the tagged record, so the cash cycle cannot be computed.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  if (dso !== null && dpo !== null) {
    const cycle = dso + (dio ?? 0) - dpo;
    e.find(
      cycle > 90 ? "attention" : "info",
      `Cash conversion cycle of ${cycle.toFixed(0)} days`,
      `${stated.join(", ")}. The cycle is receivables plus inventory less payables, so it is the number of days of trading the business funds itself. ` +
        (cycle > 90
          ? "A cycle this long means growth consumes cash: every additional pound of revenue has to be funded for three months before it returns, which is a working capital facility question at the point of sale."
          : "A cycle at this level means growth is close to self-funding, which materially reduces the facility a buyer has to put in place."),
      { label: "Cash cycle", value: `${cycle.toFixed(0)} days` },
    );
  } else {
    e.find(
      "info",
      `Working capital reads ${stated.join(", ")}`,
      `Computed from the tagged balances against ${period(d)} flows. Not every component is tagged by this filer, so the full cycle is not stated rather than being completed with an assumed figure.`,
      dso !== null ? { label: "Days sales outstanding", value: `${dso.toFixed(0)} days` } : undefined,
    );
  }

  const wc = safeRatio(
    (bal(d, "currentAssets") ?? 0) - (bal(d, "currentLiabilities") ?? 0),
    rev,
  );
  if (bal(d, "currentAssets") !== null && bal(d, "currentLiabilities") !== null && wc !== null) {
    const ratio = safeRatio(bal(d, "currentAssets"), bal(d, "currentLiabilities"));
    e.find(
      ratio !== null && ratio < 1 ? "attention" : "info",
      `Current ratio ${ratio !== null ? ratio.toFixed(2) : "not computable"}, net working capital ${(wc * 100).toFixed(1)} percent of revenue`,
      `Current assets ${usd(bal(d, "currentAssets")!)} against current liabilities ${usd(bal(d, "currentLiabilities")!)}. ` +
        (ratio !== null && ratio < 1
          ? "Current liabilities exceeding current assets is normal for a business collecting in advance and is a warning in one that does not. Which of the two applies is settled by the deferred revenue balance."
          : "Short-term coverage is adequate on the filed balances."),
      { label: "Current ratio", value: ratio !== null ? ratio.toFixed(2) : "Not reported" },
    );
  }

  e.gap(
    "Aged receivables listing at the last quarter end",
    "Days outstanding computed from year-end balances hides seasonality and hides a single overdue account inside an otherwise healthy average.",
    DATA_ROOM,
    "medium",
  );
};

const cashFlow: SeatFn = (d, e) => {
  const conv = paired(d, "cashFromOps", "netIncome")
    .filter((x) => x.b !== 0)
    .map((x) => ({ label: x.label, conv: (x.a / x.b) * 100 }));

  if (conv.length === 0) {
    // Some publishers issue a profit and loss and a balance sheet but no cash
    // flow statement. The cash balance is still published, and its movement is
    // a real measure, so long as it is not presented as though it were the
    // flow: a balance rises on borrowing exactly as it does on trading.
    const cashSeries = history(d, "cash");
    if (cashSeries.length >= 2) {
      const first = cashSeries[0];
      const last = cashSeries[cashSeries.length - 1];
      const move = last.value - first.value;
      e.find(
        move < 0 ? "attention" : "info",
        `Cash balance ${move >= 0 ? "rose" : "fell"} ${usd(Math.abs(move))} US dollars across ${cashSeries.length} published periods`,
        `Series: ${cashSeries.map((p) => `${p.label} ${usd(p.value)}`).join(", ")}. ` +
          `This subject publishes a profit and loss and a balance sheet but not a cash flow statement, so conversion from profit to cash cannot be computed. ` +
          `A balance movement is not a substitute: it rises on borrowing and falls on a dividend exactly as it does on trading, and none of those is distinguishable here. ` +
          `What it does establish is the direction of the cash position, and that the business is not visibly consuming its balance.`,
        { label: "Cash balance", value: `${usd(last.value)} USD` },
      );
      e.gap(
        "Cash flow statement for three years",
        "The published files carry the balance but not the flow, so profit cannot be tested against cash, which is the fastest available read on earnings quality.",
        IR_SITE,
        "high",
      );
      return;
    }
    e.gap(
      "Cash flow statement for three years",
      "Conversion from profit to cash cannot be tested, which is the fastest available read on earnings quality.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  const latest = conv[conv.length - 1];
  const below = conv.filter((p) => p.conv < 90).length;

  e.find(
    latest.conv < 80 ? "risk" : latest.conv < 95 ? "attention" : "info",
    `Cash conversion ${latest.conv.toFixed(0)} percent of net income`,
    `Series: ${conv.map((p) => `${p.label} ${p.conv.toFixed(0)}%`).join(", ")}. ` +
      (below >= 2
        ? `${below} of ${conv.length} periods sit below ninety percent. Persistent under-conversion points at receivables extending or at revenue recognised ahead of billing, and warrants an ageing review before pricing.`
        : "Conversion is within the range expected for a business of this type across the periods on file."),
    { label: "Cash conversion", value: `${latest.conv.toFixed(0)}%` },
  );

  // Free cash flow is the figure a buyer actually services debt out of.
  const ops = f(d, "cashFromOps");
  const capex = f(d, "capex");
  if (ops !== null && capex !== null) {
    const fcf = ops - Math.abs(capex);
    const rev = f(d, "revenue");
    const marginPct = rev ? (fcf / rev) * 100 : null;
    e.find(
      fcf <= 0 ? "risk" : marginPct !== null && marginPct < 5 ? "attention" : "info",
      `Free cash flow ${usd(fcf)} US dollars in ${period(d)}`,
      `Operating cash of ${usd(ops)} less capital expenditure of ${usd(Math.abs(capex))}. ` +
        (marginPct !== null ? `That is ${marginPct.toFixed(1)} percent of revenue. ` : "") +
        (fcf <= 0
          ? "Negative free cash flow means the business consumed cash before any financing decision, so leverage capacity is nil and the equity cheque has to cover the shortfall as well as the price."
          : "This is the figure debt is serviced from, and it is the correct denominator for any leverage test rather than reported earnings."),
      { label: "Free cash flow", value: `${usd(fcf)} USD` },
    );
  }

  const dep = f(d, "depreciation");
  if (dep !== null && capex !== null && dep > 0) {
    const ratio = Math.abs(capex) / dep;
    e.find(
      ratio < 0.7 ? "attention" : "info",
      `Capital expenditure runs at ${ratio.toFixed(2)} times depreciation`,
      `Capex ${usd(Math.abs(capex))} against depreciation and amortisation ${usd(dep)}. ` +
        (ratio < 0.7
          ? "Spending materially below the depreciation charge means the asset base is being consumed rather than maintained. It flatters current cash flow and creates a catch-up requirement that lands on the buyer."
          : "Spending at or above the depreciation charge is consistent with a maintained asset base, so current cash flow is not being flattered by deferred investment."),
      { label: "Capex to depreciation", value: `${ratio.toFixed(2)}x` },
    );
  }
};

const qualityOfEarnings: SeatFn = (d, e, prior) => {
  const rev = d.derived.latestRevenueUsd;
  if (rev === null) {
    e.gap(
      "Audited accounts and the management adjustment schedule",
      "No defensible earnings base can be set, so no multiple can be applied to it.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  // The accrual ratio is the classic earnings quality test: profit that is not
  // matched by cash is accrual, and a high accrual share reverses.
  const ni = f(d, "netIncome");
  const ops = f(d, "cashFromOps");
  if (ni !== null && ops !== null && ni !== 0) {
    const accrual = ((ni - ops) / Math.abs(ni)) * 100;
    e.find(
      accrual > 30 ? "risk" : accrual > 10 ? "attention" : "info",
      accrual < 0
        ? `Operating cash exceeds net income by ${Math.abs(accrual).toFixed(0)} percent`
        : `Accruals represent ${accrual.toFixed(0)} percent of net income`,
      `Net income ${usd(ni)} against operating cash ${usd(ops)}. The difference is the non-cash component of the reported result. ` +
        (accrual > 30
          ? "An accrual share this high means most of the reported profit has not been collected. Accruals reverse, so an earnings base set here without adjustment will not repeat."
          : accrual > 10
            ? "A moderate accrual share is ordinary; it becomes a finding only if it widens across periods, which is the pattern that precedes a restatement."
            : "Reported profit is substantially backed by cash, which is the strongest single indicator that the earnings base is real."),
      { label: "Accrual ratio", value: `${accrual.toFixed(0)}%` },
    );
  }

  // Share-based compensation is a real cost excluded from most adjusted
  // measures, so it is quantified rather than argued about.
  const sbc = f(d, "shareComp");
  if (sbc !== null && ni !== null && ni !== 0) {
    const ofNi = (sbc / Math.abs(ni)) * 100;
    e.find(
      ofNi > 25 ? "attention" : "info",
      `Share-based compensation of ${usd(sbc)} US dollars, ${ofNi.toFixed(0)} percent of net income`,
      `Tagged as ${tag(d, "shareComp")}, ${((sbc / rev) * 100).toFixed(1)} percent of revenue. ` +
        `This is a genuine cost of employing people that most adjusted earnings measures add back. ` +
        (ofNi > 25
          ? "At this proportion, an adjusted figure that excludes it is describing a different business from the one being bought, and the dilution it represents falls on the acquirer."
          : "The proportion is modest, so the gap between reported and adjusted earnings on this line is not material to the price."),
      { label: "Share-based pay", value: `${usd(sbc)} USD` },
    );
  }

  const oneOffs: string[] = [];
  const restr = f(d, "restructuring");
  const imp = f(d, "impairment");
  if (restr !== null && restr > 0) oneOffs.push(`restructuring ${usd(restr)}`);
  if (imp !== null && imp > 0) oneOffs.push(`impairment ${usd(imp)}`);

  const risks = prior.filter((x) => x.severity === "risk");
  const attention = prior.filter((x) => x.severity === "attention");

  e.find(
    risks.length > 0 ? "risk" : attention.length > 1 ? "attention" : "info",
    `Reported base of ${usd(rev)} US dollars carries ${risks.length} risk and ${attention.length} attention findings upstream`,
    `The filed figures are the starting point, not the answer. ` +
      (oneOffs.length > 0 ? `Charges presented below the line this year: ${oneOffs.join(", ")}. ` : "") +
      (risks.length > 0
        ? `Upstream risk findings must be quantified as adjustments before this base is used for pricing: ${risks.slice(0, 3).map((x) => x.headline).join("; ")}.`
        : `No upstream risk finding requires an adjustment on the public record. Management adjustments remain to be tested against the data room.`),
    { label: "Reported base", value: `${usd(rev)} USD` },
  );

  e.gap(
    "Management adjustment schedule with supporting invoices",
    "Adjusted earnings cannot be independently verified, and the adjusted figure is what the price is set on.",
    DATA_ROOM,
    "high",
  );
};

/* ================================================================== *
 * 04 Operational
 * ================================================================== */

const operations: SeatFn = (d, e) => {
  const rev = f(d, "revenue");
  const capex = f(d, "capex");
  const ppe = bal(d, "ppe");
  let said = false;

  if (capex !== null && rev !== null) {
    const intensity = (Math.abs(capex) / rev) * 100;
    e.find(
      intensity > 15 ? "attention" : "info",
      `Capital intensity ${intensity.toFixed(1)} percent of revenue`,
      `Capital expenditure of ${usd(Math.abs(capex))} on revenue of ${usd(rev)}. ` +
        (intensity > 15
          ? "Intensity at this level makes the business a capital story as much as a trading one: growth requires funding before it produces return, and the payback period sets the hold."
          : "Intensity at this level means growth is largely fundable from operating cash, so the equity requirement is the price rather than the price plus the build."),
      { label: "Capital intensity", value: `${intensity.toFixed(1)}%` },
    );
    said = true;
  }

  if (ppe !== null && rev !== null) {
    e.find(
      "info",
      `Fixed asset base of ${usd(ppe)} US dollars turns ${(rev / ppe).toFixed(1)} times`,
      `Property and equipment tagged as ${tag(d, "ppe")}. Asset turn is the operational efficiency read that does not depend on any management commentary: ` +
        `it says how much revenue each unit of installed capacity produces, and a turn falling while revenue grows means capacity was added ahead of the demand it was built for.`,
      { label: "Asset turn", value: `${(rev / ppe).toFixed(1)}x` },
    );
    said = true;
  }

  const lease = bal(d, "leaseLiability");
  if (lease !== null) {
    e.find(
      "info",
      `Lease obligations of ${usd(lease)} US dollars`,
      `Tagged as ${tag(d, "leaseLiability")}. Leases are committed cash outflows that sit outside the debt line but behave exactly like it for coverage purposes. ` +
        `Any leverage test that ignores them understates the fixed charge the business actually carries.`,
      { label: "Lease liabilities", value: `${usd(lease)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Capital expenditure plan and the fixed asset register",
      "No capital expenditure, fixed asset or lease balance was recovered, so delivery capacity cannot be assessed from the record.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  e.gap(
    "Capacity utilisation by site or by delivery centre",
    "Filed totals show what was spent and what is held, never how much of it is being used. Utilisation is what says whether growth needs more capital.",
    DATA_ROOM,
    "medium",
  );
};

const supplyChain: SeatFn = (d, e) => {
  const signals = sig(d, "supplyChain");
  let said = false;

  if (signals.length > 0) {
    const concentrated = signals.some((s) =>
      /sole source|single source|one supplier|limited number of suppliers|concentrated/i.test(s.sentence),
    );
    e.find(
      concentrated ? "risk" : "attention",
      concentrated
        ? "Supplier concentration disclosed in the filed narrative"
        : "Supply chain exposure disclosed in the filed narrative",
      signals.slice(0, 2).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Read from item ${signals[0].item}. ` +
        (concentrated
          ? "A named single or sole source is a disclosed dependency the buyer inherits in full. It is priced as a risk to continuity of supply, not as a procurement improvement."
          : "Disclosed supply exposure sets the questions for the operational session rather than concluding them."),
      { label: "Disclosures", value: String(signals.length) },
    );
    said = true;
  }

  const inv = bal(d, "inventory");
  const cogs = f(d, "costOfRevenue");
  const dio = days(inv, cogs);
  if (dio !== null) {
    e.find(
      dio > 150 ? "attention" : "info",
      `Inventory represents ${dio.toFixed(0)} days of cost of sales`,
      `Inventory of ${usd(inv!)} against cost of sales of ${usd(cogs!)}. ` +
        (dio > 150
          ? "Cover this deep is either a deliberate hedge against supply disruption or the early form of an obsolescence problem. The ageing profile settles which, and only one of them is an asset."
          : "Cover is proportionate to the cost base, which is consistent with a supply chain operating normally."),
      { label: "Days inventory", value: `${dio.toFixed(0)} days` },
    );
    said = true;
  }

  const commitments = f(d, "purchaseCommitments");
  if (commitments !== null && commitments > 0) {
    const rev = f(d, "revenue");
    e.find(
      "attention",
      `Purchase obligations of ${usd(commitments)} US dollars`,
      `Tagged as ${tag(d, "purchaseCommitments")}` +
        (rev ? `, equal to ${((commitments / rev) * 100).toFixed(1)} percent of revenue` : "") +
        `. These are contractual commitments to buy that survive a change of control. They are a liability in substance and are frequently missed in a debt-free cash-free bridge.`,
      { label: "Purchase obligations", value: `${usd(commitments)} USD` },
    );
    said = true;
  }

  if (!said) {
    if (d.resolved.inUniverse && /services|software/i.test(d.resolved.inUniverse.subsector)) {
      e.find(
        "info",
        "No material supply chain exposure disclosed, consistent with the business model",
        `The subject is classified as ${d.resolved.inUniverse.subsector.toLowerCase()}, where the cost base is people rather than components. ` +
          `No supplier concentration, inventory balance or purchase obligation was recovered from the filed record, which is the expected result for a business of this type rather than a gap in the review.`,
        { label: "Exposure", value: "None disclosed" },
      );
      return;
    }
    e.gap(
      "Supplier list with spend concentration",
      "No supply chain disclosure, inventory balance or purchase commitment was recovered, so dependency cannot be assessed.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  e.gap(
    "Top suppliers by spend with contract terms",
    "Disclosed exposure names the risk; spend concentration sizes it. Only the second one can be priced.",
    DATA_ROOM,
    "medium",
  );
};

const systems: SeatFn = (d, e) => {
  const intangibles = bal(d, "intangibles");
  const goodwill = bal(d, "goodwill");
  const assets = bal(d, "assets");
  const cyber = sig(d, "cyber");
  let said = false;

  if (intangibles !== null && assets !== null) {
    const share = (intangibles / assets) * 100;
    e.find(
      "info",
      `Intangible assets of ${usd(intangibles)} US dollars, ${share.toFixed(1)} percent of total assets`,
      `Tagged as ${tag(d, "intangibles")}. Capitalised software and acquired technology sit here. ` +
        `The balance is what the business has recognised as durable systems value, and its amortisation profile is a fixed charge against future earnings that a buyer inherits whether or not the systems are still in use.`,
      { label: "Intangibles", value: `${usd(intangibles)} USD` },
    );
    said = true;
  }

  if (cyber.length > 0) {
    e.find(
      "attention",
      `Cybersecurity exposure disclosed in the filed narrative`,
      cyber.slice(0, 2).map((s) => `"${quote(s.sentence, 240)}"`).join(" ") +
        ` Read from item ${cyber[0].item}. ` +
        `Since the cybersecurity item became mandatory, the absence of a specific incident disclosure is meaningful evidence in itself, and its presence is a dated, quantifiable exposure rather than a general warning.`,
      { label: "Disclosures", value: String(cyber.length) },
    );
    said = true;
  }

  if (goodwill !== null && intangibles !== null) {
    e.find(
      "info",
      `Acquired asset base splits ${usd(goodwill)} goodwill to ${usd(intangibles)} identified intangibles`,
      `A high ratio of goodwill to identified intangibles means past acquisitions were priced substantially above the assets that could be named and valued. ` +
        `That premium is a judgement about synergies, and it is the balance most exposed to an impairment test if the acquired businesses underperform.`,
      { label: "Goodwill", value: `${usd(goodwill)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Systems architecture and the application inventory",
      "No intangible asset balance or cybersecurity disclosure was recovered, so the systems estate cannot be assessed from the public record at all.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  e.gap(
    "Application inventory with support status and licence terms",
    "The balance sheet says what systems cost, never whether they are supported, licensed transferably, or about to need replacing.",
    DATA_ROOM,
    "medium",
  );
};

const technology: SeatFn = (d, e) => {
  const rnd = marginOf(d, "rnd");
  if (rnd === null) {
    if (d.resolved.inUniverse && /IT services/i.test(d.resolved.inUniverse.subsector)) {
      e.find(
        "info",
        "No separately tagged research line, consistent with a services cost base",
        `The subject is classified as ${d.resolved.inUniverse.subsector.toLowerCase()}, where technology investment is embedded in delivery cost rather than reported as a research line. ` +
          `Its absence from the tagged record is the expected result for this model and is not evidence of underinvestment.`,
        { label: "Research line", value: "Not separately tagged" },
      );
      return;
    }
    e.gap(
      "Research and development spend by year",
      "Investment intensity cannot be compared against the peer set, which is the only way to say whether the forward position is being funded.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  const band =
    rnd >= 15
      ? "product-led, buying the next cycle"
      : rnd >= 6
        ? "balanced between product and delivery"
        : "delivery-led, harvesting the current position";

  const priorRnd = safeRatio(fPrior(d, "rnd"), fPrior(d, "revenue"));
  const shift = priorRnd !== null ? rnd - priorRnd * 100 : null;

  e.find(
    shift !== null && shift < -1 ? "attention" : "info",
    `Research intensity ${rnd.toFixed(1)} percent of revenue`,
    `Absolute spend ${usd(f(d, "rnd")!)} US dollars, tagged as ${tag(d, "rnd")}. This places the subject as ${band}. ` +
      (shift !== null ? `Intensity moved ${pp(shift)} against the prior year. ` : "") +
      `Software and semiconductor businesses typically run in the teens to low twenties; IT services run low single digits because capacity, not product, is the cost base. ` +
      (shift !== null && shift < -1
        ? "Intensity falling is the cheapest available way to make a margin look better in a single year, and it borrows directly from the terminal value."
        : "Intensity below a sector norm is not adverse on its own, but it belongs in the terminal growth assumption rather than being ignored."),
    { label: "R&D intensity", value: `${rnd.toFixed(1)}%` },
  );
};

const efficiency: SeatFn = (d, e) => {
  const rev = f(d, "revenue");
  const emp = employeeCount(d);

  if (rev !== null && emp !== null) {
    const perHead = rev / emp.count;
    e.find(
      "info",
      `Revenue per employee ${usd(perHead)} US dollars across ${n0(emp.count)} people`,
      `Headcount read from the filed statement: "${quote(emp.sentence, 220)}" ` +
        `Revenue per head is the cleanest single measure of whether scale is helping or merely accumulating. ` +
        `It is also the measure most directly exposed to an automation case: a plan that holds revenue while reducing headcount has to show up here or it is not happening.`,
      { label: "Revenue per head", value: `${usd(perHead)} USD` },
    );

    const sbc = f(d, "shareComp");
    if (sbc !== null) {
      e.find(
        "info",
        `Share-based compensation averages ${usd(sbc / emp.count)} US dollars per employee`,
        `Total ${usd(sbc)} across ${n0(emp.count)} people. This is an average rather than a distribution, and equity grants concentrate heavily by seniority, ` +
          `so the figure understates what is required to retain the people who actually matter to the plan.`,
        { label: "Equity per head", value: `${usd(sbc / emp.count)} USD` },
      );
    }
    return;
  }

  if (rev !== null) {
    e.find(
      "info",
      `Revenue of ${usd(rev)} US dollars recorded, headcount not disclosed in a readable form`,
      `Unit economics need a denominator. The filed narrative did not yield a headcount statement this agent could parse, ` +
        `so revenue per head is not stated rather than being estimated from a sector average, which would be an invented number in a committee paper.`,
      { label: "Revenue", value: `${usd(rev)} USD` },
    );
  }

  e.gap(
    "Headcount by period, by function and by location",
    "Revenue per head is the fastest read on whether scale is helping, and the filed record rarely carries headcount in a form that can be tied to a period.",
    DATA_ROOM,
    "medium",
  );
};

/* ================================================================== *
 * 05 Legal, regulatory and tax
 * ================================================================== */

const legalStructure: SeatFn = (d, e) => {
  const equity = bal(d, "equity");
  const debt = (bal(d, "debt") ?? 0) + (bal(d, "debtCurrent") ?? 0);
  const cash = bal(d, "cash");
  const goodwill = bal(d, "goodwill");
  const minority = bal(d, "minorityInterest");
  let said = false;

  if (bal(d, "debt") !== null || bal(d, "debtCurrent") !== null) {
    const net = cash !== null ? debt - cash : null;
    const op = f(d, "operatingIncome");
    const dep = f(d, "depreciation");
    const ebitda = op !== null ? op + (dep ?? 0) : null;
    const turns = ebitda !== null && ebitda > 0 && net !== null ? net / ebitda : null;

    e.find(
      turns !== null && turns > 3 ? "risk" : turns !== null && turns > 2 ? "attention" : "info",
      net !== null && net < 0
        ? `Net cash position of ${usd(-net)} US dollars`
        : `Net debt of ${usd(net ?? debt)} US dollars` + (turns !== null ? `, ${turns.toFixed(1)} times EBITDA` : ""),
      `Gross debt ${usd(debt)}` +
        (cash !== null ? ` against cash of ${usd(cash)}` : "") +
        (ebitda !== null ? `, on EBITDA of ${usd(ebitda)} built from operating income plus depreciation` : "") +
        `. ` +
        (turns !== null && turns > 3
          ? "Leverage at this level before any acquisition debt limits what can be added, so the structure is constrained by the existing balance sheet rather than by appetite."
          : net !== null && net < 0
            ? "A net cash position means the balance sheet itself funds part of the consideration, and it is the single largest determinant of the equity cheque."
            : "Existing leverage leaves headroom, so the structure is set by lender appetite rather than by the balance sheet."),
      { label: "Gross debt", value: `${usd(debt)} USD` },
    );
    said = true;
  }

  if (equity !== null && goodwill !== null) {
    const share = (goodwill / equity) * 100;
    e.find(
      share > 80 ? "attention" : "info",
      `Goodwill equals ${share.toFixed(0)} percent of shareholders equity`,
      `Goodwill ${usd(goodwill)} against equity of ${usd(equity)}. ` +
        (share > 80
          ? "Where goodwill approaches or exceeds equity, a single impairment can eliminate the book equity outright. That matters directly for any covenant written against net worth."
          : "Goodwill is well covered by equity, so an impairment would not by itself threaten a net worth covenant."),
      { label: "Goodwill to equity", value: `${share.toFixed(0)}%` },
    );
    said = true;
  }

  if (minority !== null && minority !== 0) {
    e.find(
      "attention",
      `Non-controlling interests of ${usd(minority)} US dollars on the balance sheet`,
      `Part of the group is not wholly owned. Consolidated revenue and earnings therefore include results attributable to other shareholders, ` +
        `and a per-share or equity-value calculation that uses consolidated figures without deducting this is overstated. It also means minority consents may be needed at completion.`,
      { label: "Minority interest", value: `${usd(minority)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Group structure chart with ownership percentages",
      "No debt, equity or minority interest balance was recovered, so the structure cannot be described from the record.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Group structure chart and the intra-group agreements",
    "The consolidated balance sheet shows the group in aggregate. Which entity holds what, and which agreements sit between them, determines what is actually being acquired.",
    DATA_ROOM,
    "high",
  );
};

const contracts: SeatFn = (d, e) => {
  const rpo = f(d, "orderBook");
  const deferred = bal(d, "deferredRevenue");
  const lease = bal(d, "leaseLiability");
  const commitments = f(d, "purchaseCommitments");
  const items: string[] = [];

  if (rpo !== null) items.push(`remaining performance obligations of ${usd(rpo)}`);
  if (deferred !== null) items.push(`deferred revenue of ${usd(deferred)}`);
  if (lease !== null) items.push(`lease liabilities of ${usd(lease)}`);
  if (commitments !== null) items.push(`purchase obligations of ${usd(commitments)}`);

  if (items.length === 0) {
    // Where no contracted balance is tagged, receivables and unbilled work are
    // still evidence of contracted activity and are usually published.
    const unbilledBal = bal(d, "unbilled");
    const receivables = bal(d, "receivables");
    if (unbilledBal !== null || receivables !== null) {
      const total = (unbilledBal ?? 0) + (receivables ?? 0);
      e.find(
        "info",
        `Contracted work in progress totals ${usd(total)} US dollars`,
        (receivables !== null ? `Trade receivables ${usd(receivables)}` : "") +
          (unbilledBal !== null ? `${receivables !== null ? ", " : ""}unbilled work ${usd(unbilledBal)}` : "") +
          `. Neither an order book nor a deferred revenue balance is separately published by this subject, so contracted position is read from delivered and undelivered work instead. ` +
          `Unbilled work is the more informative of the two: it is revenue earned under a contract that has not yet been invoiced, so it exists only where a signed contract does.`,
        { label: "Work in progress", value: `${usd(total)} USD` },
      );
      e.gap(
        "Order book and the contract register with change of control provisions",
        "Receivables show what has been delivered. They say nothing about what remains contracted, which is what the forward revenue case rests on.",
        DATA_ROOM,
        "high",
      );
      return;
    }
    e.gap(
      "The contract register with change of control provisions",
      "No contracted balance was recovered from the tagged record, so the obligations the buyer would inherit cannot be sized even approximately.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  const total = (rpo ?? 0) + (deferred ?? 0) + (lease ?? 0) + (commitments ?? 0);
  e.find(
    "info",
    `Contracted positions total ${usd(total)} US dollars across ${items.length} tagged balance${items.length === 1 ? "" : "s"}`,
    `Made up of ${items.join(", ")}. ` +
      `These are the commitments already entered into that survive a transaction: what has been sold and not yet delivered, what has been collected and not yet earned, and what has been committed to be paid. ` +
      `Every one of them transfers with the business, and together they set the floor for both the revenue bridge and the fixed charge cover.`,
    { label: "Contracted total", value: `${usd(total)} USD` },
  );

  if (rpo !== null && deferred !== null && deferred > 0) {
    e.find(
      "info",
      `Order book covers deferred revenue ${(rpo / deferred).toFixed(1)} times`,
      `Contracted but unrecognised revenue of ${usd(rpo)} against amounts already collected of ${usd(deferred)}. ` +
        `The gap between the two is work that is committed but not yet paid for, which is where collection risk on the contracted base actually sits.`,
      { label: "Cover", value: `${(rpo / deferred).toFixed(1)}x` },
    );
  }

  e.gap(
    "Change of control clauses in the top twenty contracts",
    "Filed balances say how much is contracted. They never say which contracts a buyer can be forced to renegotiate at completion, which is the term that moves the price.",
    DATA_ROOM,
    "high",
  );
};

const litigation: SeatFn = (d, e) => {
  const legal = sect(d, "legal");
  const signals = sig(d, "litigation");
  const accrual = f(d, "lossContingency");
  let said = false;

  if (accrual !== null && accrual > 0) {
    const rev = f(d, "revenue");
    e.find(
      rev !== null && accrual / rev > 0.01 ? "risk" : "attention",
      `Loss contingency accrued at ${usd(accrual)} US dollars`,
      `Tagged as ${tag(d, "lossContingency")}` +
        (rev !== null ? `, which is ${((accrual / rev) * 100).toFixed(2)} percent of revenue` : "") +
        `. An accrual means the loss is both probable and estimable in the auditor's judgement, so this is not a contingent exposure but a recognised one. ` +
        `The recognised amount is the floor rather than the ceiling of the eventual outcome.`,
      { label: "Accrued", value: `${usd(accrual)} USD` },
    );
    said = true;
  }

  if (signals.length > 0) {
    e.find(
      signals.length >= 3 ? "attention" : "info",
      `${signals.length} disclosed statement${signals.length === 1 ? "" : "s"} on proceedings in the filed narrative`,
      signals.slice(0, 2).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Read from item ${signals[0].item}` +
        (legal ? ` of a legal proceedings section running to ${n0(legal.chars)} characters` : "") +
        `. Disclosed matters are the ones that met a reporting threshold, so they set the floor on exposure rather than describing it fully.`,
      { label: "Disclosures", value: String(signals.length) },
    );
    said = true;
  }

  const news = d.news.filter((x) =>
    /\b(lawsuit|litigation|court|sue[ds]?|settle\w*|claim|arbitrat\w+|probe|investigat\w+)\b/i.test(x.title),
  );
  if (news.length > 0) {
    e.find(
      news.length >= 3 ? "attention" : "info",
      `${news.length} coverage item${news.length === 1 ? "" : "s"} referencing disputes or proceedings`,
      news.slice(0, 3).map((x) => `"${x.title}" (${x.publisher})`).join("; ") +
        ". Reproduced from verified publishers and not independently confirmed against the court record.",
      { label: "Dispute items", value: String(news.length) },
    );
    said = true;
  }

  if (!said) {
    e.find(
      "info",
      "No accrued contingency and no disclosed proceedings on the record",
      `Tested: the loss contingency tag, the legal proceedings section of the ${d.filing?.form ?? "annual report"}, and ${d.news.length} items of verified coverage. ` +
        `None returned a matter. Absence of disclosure is not absence of proceedings, since matters below the reporting threshold never appear, but it does mean nothing material has been recognised or disclosed.`,
      { label: "Matters found", value: "0" },
    );
  }

  e.gap(
    "Litigation schedule with counsel letters",
    "Exposure cannot be sized from a disclosure threshold. Counsel's own assessment of the range is the only thing that supports a reserve.",
    DATA_ROOM,
    "high",
  );
};

const regulatory: SeatFn = (d, e) => {
  const signals = sig(d, "regulation");
  let said = false;

  if (signals.length > 0) {
    e.find(
      signals.length >= 3 ? "attention" : "info",
      `${signals.length} regulatory exposure${signals.length === 1 ? "" : "s"} disclosed in the filed narrative`,
      signals.slice(0, 2).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Read from item ${signals[0].item}. ` +
        `A filer discloses the regimes it believes could be material. That list is the starting point for the regulatory session and it also indicates which jurisdictions the business is genuinely exposed to, irrespective of where it is incorporated.`,
      { label: "Disclosures", value: String(signals.length) },
    );
    said = true;
  }

  if (d.resolved.sicDescription) {
    e.find(
      "info",
      `Classified by the regulator as ${d.resolved.sicDescription}`,
      `The classification determines which disclosure regime and which sector-specific rules apply, and it is the register's own view rather than the company's description of itself. ` +
        `Where the two differ, the difference is usually worth understanding before an approval timetable is built.`,
      { label: "Classification", value: d.resolved.sicDescription },
    );
    said = true;
  }

  const risks = d.filing?.riskHeadings.filter((h) =>
    /regulat|law|complian|government|tax|privacy|antitrust|export|sanction/i.test(h),
  ) ?? [];
  if (risks.length > 0) {
    e.find(
      "attention",
      `${risks.length} of the board's principal risks are regulatory`,
      risks.slice(0, 3).map((h) => `"${quote(h, 180)}"`).join(" ") +
        ` These are the risks the board itself signed off as principal, which makes them a materially stronger signal than a generic sector risk list.`,
      { label: "Regulatory risks", value: String(risks.length) },
    );
    said = true;
  }

  if (!said) {
    const base = publishedBase(d);
    if (base && d.resolved.inUniverse) {
      const c = d.resolved.inUniverse;
      e.find(
        "info",
        `Regulatory exposure follows from the ${c.region} listing and the ${c.subsector.toLowerCase()} activity`,
        `The subject is not a US registrant, so there is no numbered risk factors item to read. What this run holds instead is ${base}. ` +
          `Its regimes follow from where it is listed and what it sells: a ${c.region} listed ${c.subsector.toLowerCase()} business is exposed to the listing rules of its exchange, ` +
          `to data protection law in every jurisdiction it delivers into, and to the immigration and employment regimes its delivery model depends on. ` +
          `The disclosures equivalent to a risk factors item are in ${narrativeHome(d)}, which is the next document to pull.`,
        { label: "Listing", value: c.region },
      );
      e.gap(
        `Risk factors section of ${narrativeHome(d)}`,
        "The published results files carry the figures but not the narrative disclosures, so the regimes are inferred from the listing rather than read from a statement.",
        IR_SITE,
        "medium",
      );
      return;
    }
    e.gap(
      "Licence register and the correspondence file with regulators",
      "No regulatory disclosure or classification was recovered, so the applicable regimes cannot be listed from the record.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  e.gap(
    "Open correspondence with regulators and the licence register",
    "Disclosure names the regimes. Only the correspondence file says whether the subject is currently in good standing under them.",
    DATA_ROOM,
    "medium",
  );
};

const tax: SeatFn = (d, e) => {
  const rate = f(d, "effectiveTaxRate");
  const expense = f(d, "taxExpense");
  const pretax = f(d, "pretaxIncome");
  const utb = f(d, "unrecognisedTax");
  let said = false;

  const computed = rate !== null ? rate * 100 : safeRatio(expense, pretax) !== null ? safeRatio(expense, pretax)! * 100 : null;

  if (computed !== null) {
    e.find(
      computed < 12 ? "attention" : computed > 35 ? "attention" : "info",
      `Effective tax rate ${computed.toFixed(1)} percent`,
      (rate !== null
        ? `Reported directly as ${tag(d, "effectiveTaxRate")}. `
        : `Computed from tax expense of ${usd(expense!)} on pre-tax income of ${usd(pretax!)}. `) +
        (computed < 12
          ? "A rate this far below the statutory band is sustained by structure rather than by trading, and structures are exactly what a change of control tends to disturb. The forward model should not assume it persists without testing why it exists."
          : computed > 35
            ? "A rate above the statutory band usually means non-deductible items or losses in one jurisdiction that cannot shelter profits in another. Both are worth understanding before a synergy case assumes a blended rate."
            : "The rate sits within the range a group of this footprint would be expected to carry, so no structural dependency is indicated on the face of it."),
      { label: "Effective tax rate", value: `${computed.toFixed(1)}%` },
    );
    said = true;
  }

  if (utb !== null && utb > 0) {
    e.find(
      "attention",
      `Unrecognised tax benefits of ${usd(utb)} US dollars`,
      `Tagged as ${tag(d, "unrecognisedTax")}. This is tax the company has taken a position on but does not expect to be able to defend in full. ` +
        `It is the closest thing to a self-declared tax exposure in the public record, and it is normally the first item a tax indemnity is drafted around.`,
      { label: "Unrecognised benefits", value: `${usd(utb)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Tax computations and open enquiries by jurisdiction",
      "Neither an effective rate nor a tax expense was recovered, so the position cannot be assessed and no indemnity can be scoped.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Open tax enquiries and the transfer pricing documentation",
    "The rate says what was paid. Only the enquiry file says what is still contested, and that is what the indemnity has to cover.",
    DATA_ROOM,
    "high",
  );
};

/* ================================================================== *
 * 06 People and culture
 * ================================================================== */

const management: SeatFn = (d, e) => {
  const directors = sect(d, "directors");
  const sbc = f(d, "shareComp");
  let said = false;

  if (directors) {
    e.find(
      "info",
      `Directors and officers section runs to ${n0(directors.chars)} characters in the ${d.filing?.form ?? "annual report"}`,
      `Item ${directors.item}, ${directors.title}. This is the disclosed record of who runs the business and on what terms. ` +
        `It is the input for the reference process rather than a substitute for it: what matters for the plan is which of these people are contracted beyond completion, which the filing does not say.`,
      { label: "Section", value: `Item ${directors.item}` },
    );
    said = true;
  }

  if (sbc !== null) {
    const rev = f(d, "revenue");
    const ni = f(d, "netIncome");
    e.find(
      ni !== null && ni !== 0 && sbc / Math.abs(ni) > 0.25 ? "attention" : "info",
      `Equity compensation of ${usd(sbc)} US dollars charged in ${period(d)}`,
      (rev !== null ? `That is ${((sbc / rev) * 100).toFixed(1)} percent of revenue. ` : "") +
        `Equity is how a listed business retains the people a buyer is actually paying for. ` +
        `A transaction typically accelerates or cancels unvested awards, so this figure is a direct read on the retention package that has to be rebuilt at completion, and it is routinely underestimated in the deal model.`,
      { label: "Equity compensation", value: `${usd(sbc)} USD` },
    );
    said = true;
  }

  const keyPerson = sig(d, "keyPerson");
  if (keyPerson.length > 0) {
    e.find(
      "attention",
      "Management dependency acknowledged in the filed risk disclosures",
      keyPerson.slice(0, 1).map((s) => `"${quote(s.sentence, 280)}"`).join(" ") +
        ` The board naming this as a principal risk is a disclosure against interest and should be weighted accordingly.`,
      { label: "Disclosures", value: String(keyPerson.length) },
    );
    said = true;
  }

  if (!said) {
    const base = publishedBase(d);
    const emp = employeeCount(d);
    if (base) {
      e.find(
        "info",
        "Management is assessed from the published operating record rather than from a directors item",
        `The subject files no narrative annual report with a directors and officers item, so this agent reads what management has actually delivered instead of who it says it is. ` +
          `Held for this run: ${base}. ` +
          (emp !== null ? `The organisation runs to ${n0(emp.count)} people. ` : "") +
          (d.derived.revenueCagrPct !== null
            ? `Delivered growth over the published window is ${pct(d.derived.revenueCagrPct)}, which is the only management track record on the public record. `
            : "") +
          `Board composition and service contracts are in ${narrativeHome(d)}.`,
        emp !== null ? { label: "Employees", value: n0(emp.count) } : undefined,
      );
      e.gap(
        "Board composition and service contracts",
        "The published files carry performance but not governance, so who is contracted past completion is not on this record.",
        DATA_ROOM,
        "high",
      );
      return;
    }
    e.gap(
      "Organisation chart with tenure, and the service contracts",
      "Neither a directors section nor an equity compensation charge was recovered, so management cannot be assessed from the public record.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  e.gap(
    "Service contracts and notice periods for the executive team",
    "The filed record names the executives. Only the contracts say who is retained past completion and at what cost, which is what the plan depends on.",
    DATA_ROOM,
    "high",
  );
};

const orgStructure: SeatFn = (d, e) => {
  const emp = employeeCount(d);
  const geo = sig(d, "geography");
  let said = false;

  if (emp !== null) {
    const rev = f(d, "revenue");
    e.find(
      "info",
      `${n0(emp.count)} people employed as disclosed in the ${d.filing?.form ?? "annual report"}`,
      `"${quote(emp.sentence, 280)}" ` +
        (rev !== null ? `Against revenue of ${usd(rev)}, that is ${usd(rev / emp.count)} of revenue per head. ` : "") +
        `Headcount is the denominator every operational efficiency measure in this run depends on, which is why it is read from a disclosed sentence rather than assumed.`,
      { label: "Employees", value: n0(emp.count) },
    );
    said = true;
  }

  if (geo.length > 0) {
    e.find(
      "info",
      "Operating footprint disclosed in the filed narrative",
      geo.slice(0, 2).map((s) => `"${quote(s.sentence, 240)}"`).join(" ") +
        ` The footprint determines the employment regimes that apply, and therefore what a restructuring actually costs and how long it takes. ` +
        `A cost plan built without it tends to assume a notice period that does not exist in the jurisdictions concerned.`,
      { label: "Disclosures", value: String(geo.length) },
    );
    said = true;
  }

  if (!said) {
    const base = publishedBase(d);
    if (base && d.resolved.inUniverse) {
      e.find(
        "info",
        `Organisation described from the published operating record`,
        `No narrative item states headcount for this subject. Held instead: ${base}. ` +
          `The business is a ${d.resolved.inUniverse.subsector.toLowerCase()} operation listed in ${d.resolved.inUniverse.region}, ` +
          `which places its delivery organisation and its employment regimes in that jurisdiction. ` +
          `A headcount row appears in the company's own quarterly file where it publishes one, and this run did not find a row it could read as a count.`,
        { label: "Region", value: d.resolved.inUniverse.region },
      );
      e.gap(
        "Headcount by function, level and location",
        "The published files did not carry a headcount row this run could read, so the shape of the organisation is not established.",
        IR_SITE,
        "medium",
      );
      return;
    }
    e.gap(
      "Headcount by function, level and location",
      "Neither a headcount statement nor a footprint disclosure was recovered, so the organisation cannot be described from the record.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  e.gap(
    "Headcount by function and level, with the span of control",
    "A total headcount says the scale of the organisation, never its shape. Layers and spans are what a cost case is actually built from.",
    DATA_ROOM,
    "medium",
  );
};

const compensation: SeatFn = (d, e) => {
  const sbc = f(d, "shareComp");
  const emp = employeeCount(d);
  const rev = f(d, "revenue");

  if (sbc === null) {
    // Employee cost is published by most non-registrants even where an equity
    // charge is not, and it is the larger number of the two.
    const cost = irMetric(d, [/^employee cost$/i, /^employee benefit expense/i, /^personnel (cost|expense)/i, /^staff cost/i]);
    if (cost && cost.values.length > 0 && rev !== null) {
      const latest = cost.values[cost.values.length - 1];
      e.find(
        "info",
        `Employee cost published at ${n0(latest.value)} ${irCurrency(d)} for ${latest.period}`,
        `"${cost.label}" as the company publishes it: ${cost.values.slice(-5).map((v) => `${v.period} ${n0(v.value)}`).join(", ")}. ` +
          (emp !== null ? `Across ${n0(emp.count)} people. ` : "") +
          `This is the whole reward cost rather than the equity component, which the subject does not publish separately. ` +
          `It is the right denominator for a cost case because it is what actually leaves the business, and it moves with headcount and with wage inflation rather than with the share price.`,
        { label: "Employee cost", value: `${n0(latest.value)} ${irCurrency(d)}` },
      );
      e.gap(
        "Reward framework, bonus plan rules and the equity award schedule",
        "The published files carry total employee cost but not its split, so the retention package a transaction triggers cannot be sized.",
        DATA_ROOM,
        "high",
      );
      return;
    }
    e.gap(
      "The reward framework and the bonus plan rules",
      "No compensation charge was recovered from the tagged record, so the cost of the reward structure cannot be sized.",
      DATA_ROOM,
      "medium",
    );
    return;
  }

  const priorSbc = fPrior(d, "shareComp");
  const growth = priorSbc !== null && priorSbc > 0 ? ((sbc - priorSbc) / priorSbc) * 100 : null;
  const revGrowth =
    rev !== null && fPrior(d, "revenue") !== null && fPrior(d, "revenue")! > 0
      ? ((rev - fPrior(d, "revenue")!) / fPrior(d, "revenue")!) * 100
      : null;

  e.find(
    growth !== null && revGrowth !== null && growth > revGrowth + 10 ? "attention" : "info",
    `Equity compensation of ${usd(sbc)} US dollars` + (growth !== null ? `, ${pct(growth)} year on year` : ""),
    (emp !== null ? `That is ${usd(sbc / emp.count)} per employee across ${n0(emp.count)} people. ` : "") +
      (rev !== null ? `It represents ${((sbc / rev) * 100).toFixed(1)} percent of revenue. ` : "") +
      (growth !== null && revGrowth !== null
        ? `The charge moved ${pct(growth)} while revenue moved ${pct(revGrowth)}. ` +
          (growth > revGrowth + 10
            ? "Equity cost growing materially faster than revenue means the reward structure is diluting shareholders faster than the business is growing, which compounds and is rarely reversed voluntarily."
            : "The charge is growing broadly in line with the business, so the reward structure is not by itself changing the shape of the equity.")
        : ""),
    { label: "Equity compensation", value: `${usd(sbc)} USD` },
  );

  e.gap(
    "Bonus plan rules and the outstanding award schedule with vesting dates",
    "The charge shows what was expensed. The vesting schedule shows what a transaction triggers, and that is a completion cash item rather than an accounting one.",
    DATA_ROOM,
    "high",
  );
};

const culture: SeatFn = (d, e) => {
  // Where the subject publishes attrition, it is the single best cultural
  // measure available anywhere, because it is behaviour rather than opinion.
  const attrition = irMetric(d, [/attrition/i, /turnover.*employee/i, /employee.*turnover/i]);
  let said = false;

  if (attrition && attrition.values.length > 0) {
    const vals = attrition.values.slice(-8);
    const asPct = (v: number) => (v <= 1 ? v * 100 : v);
    const latest = asPct(vals[vals.length - 1].value);
    const first = asPct(vals[0].value);
    e.find(
      latest > 18 ? "attention" : "info",
      `Attrition reported at ${latest.toFixed(1)} percent`,
      `"${attrition.label}" as published by the company: ` +
        vals.map((v) => `${v.period} ${asPct(v.value).toFixed(1)}%`).join(", ") +
        `. Direction over the published window is ${latest > first ? "rising" : latest < first ? "falling" : "flat"}. ` +
        (latest > 18
          ? "Attrition at this level is a delivery risk before it is a cultural one: replacement and ramp costs sit inside the margin, and the clients who notice are the ones on the renewal calendar."
          : "Attrition at this level is consistent with a stable delivery organisation, which supports the margin being repeatable."),
      { label: "Attrition", value: `${latest.toFixed(1)}%` },
    );
    said = true;
  }

  const emp = employeeCount(d);
  if (emp !== null && !said) {
    e.find(
      "info",
      `Workforce of ${n0(emp.count)} people is the disclosed cultural unit`,
      `"${quote(emp.sentence, 250)}" ` +
        `The filed record states scale but not turnover, tenure or engagement. Those are the measures that predict whether a plan survives contact with the organisation, and none of them is public for this subject.`,
      { label: "Employees", value: n0(emp.count) },
    );
    said = true;
  }

  const social = sig(d, "climate").concat(sig(d, "keyPerson"));
  if (!said && social.length > 0) {
    e.find(
      "info",
      "Workforce commentary recovered from the filed narrative",
      social.slice(0, 1).map((s) => `"${quote(s.sentence, 260)}"`).join(" "),
      { label: "Disclosures", value: String(social.length) },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Attrition by level, engagement survey results and exit interview themes",
      "No attrition series or workforce disclosure was recovered, so culture cannot be measured rather than asserted.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "medium",
    );
    return;
  }

  e.gap(
    "Engagement survey results and exit interview themes",
    "Attrition and headcount are outcomes. The survey and the exits are the only evidence of why, and that is what says whether the trend continues.",
    DATA_ROOM,
    "medium",
  );
};

const keyPerson: SeatFn = (d, e) => {
  const signals = sig(d, "keyPerson");
  const governance = sig(d, "governance");

  if (signals.length > 0) {
    e.find(
      "attention",
      `Key person dependency named as a principal risk by the board`,
      signals.slice(0, 2).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Read from item ${signals[0].item}. ` +
        `A board disclosing dependency on named individuals is stating that the plan does not survive their departure. ` +
        `That belongs in the retention package and in the earn-out structure, not only in the risk register.`,
      { label: "Disclosures", value: String(signals.length) },
    );
  } else if (d.filing) {
    e.find(
      "info",
      "No key person dependency disclosed among the principal risks",
      `The ${d.filing.form} filed ${d.filing.filingDate} was searched across ${d.filing.riskHeadings.length} principal risk headings and its risk narrative. ` +
        `No statement of dependency on named individuals or on senior management retention was recovered. ` +
        `For a business of scale that is the expected result, and it is weak evidence rather than strong: the absence of a disclosure is not the presence of depth.`,
      { label: "Dependencies found", value: "0" },
    );
  } else {
    const base = publishedBase(d);
    const attr = irMetric(d, [/attrition/i]);
    if (base) {
      const latest = attr?.values.at(-1);
      const rate = latest ? (latest.value <= 1 ? latest.value * 100 : latest.value) : null;
      e.find(
        rate !== null && rate > 18 ? "attention" : "info",
        rate !== null
          ? `Dependency measured through attrition at ${rate.toFixed(1)} percent rather than through a disclosure`
          : "Dependency assessed from the published operating record",
        `The subject files no narrative risk item naming individuals, so this agent reads the behaviour instead of the statement. Held: ${base}. ` +
          (attr && latest
            ? `Published attrition, "${attr.label}": ${attr.values.slice(-5).map((v) => `${v.period} ${(v.value <= 1 ? v.value * 100 : v.value).toFixed(1)}%`).join(", ")}. ` +
              `For a people business, aggregate attrition is the closest public measure of whether the organisation depends on individuals or on a system that replaces them. `
            : "") +
          `Named individual dependency is disclosed in ${narrativeHome(d)}.`,
        rate !== null ? { label: "Attrition", value: `${rate.toFixed(1)}%` } : undefined,
      );
      e.gap(
        "Succession plan and retention agreements for the executive team",
        "Aggregate attrition measures the organisation, never the handful of people a plan actually depends on.",
        DATA_ROOM,
        "high",
      );
      return;
    }
    e.gap(
      "The succession plan and the retention agreements",
      "No filed risk narrative was available, so dependency on individuals cannot be assessed from the record at all.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  if (governance.length > 0) {
    e.find(
      "attention",
      "Concentrated control disclosed alongside the key person exposure",
      governance.slice(0, 1).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Where control and operational dependency sit with the same people, the two risks are not independent and should not be mitigated separately.`,
      { label: "Disclosures", value: String(governance.length) },
    );
  }

  e.gap(
    "Succession plan and retention agreements for the named individuals",
    "The filing identifies the dependency. Only the agreements say whether it has been addressed, and for how long past completion.",
    DATA_ROOM,
    "high",
  );
};

/* ================================================================== *
 * 07 ESG and sustainability
 * ================================================================== */

const esgRisk: SeatFn = (d, e) => {
  const headings = d.filing?.riskHeadings ?? [];
  const esg = headings.filter((h) =>
    /climate|environment|emission|sustainab|human right|labour|labor|divers|privacy|data protection|governance|ethic|corrupt|safety/i.test(
      h,
    ),
  );

  if (headings.length === 0) {
    const anySignal = sig(d, "climate").length + sig(d, "regulation").length;
    if (anySignal > 0) {
      e.find(
        "info",
        `${anySignal} sustainability and compliance statements recovered from the filed narrative`,
        `The principal risk headings could not be separated for this filer, so the assessment is made from the narrative statements instead. ` +
          `Material exposure is indicated but not ranked, because ranking without the board's own ordering would be this console's opinion rather than the company's disclosure.`,
        { label: "Statements", value: String(anySignal) },
      );
      return;
    }
    const base = publishedBase(d);
    if (base && d.resolved.inUniverse) {
      const c = d.resolved.inUniverse;
      const emp = employeeCount(d);
      e.find(
        "info",
        `Material exposures follow from a ${c.subsector.toLowerCase()} operating model`,
        `The subject publishes results files rather than a numbered risk item, so principal risks cannot be counted. Held: ${base}. ` +
          `What the operating model determines is where the exposure sits: ` +
          (emp !== null
            ? `an organisation of ${n0(emp.count)} people makes labour practice, pay equity and attrition the material social exposures, `
            : "a people-led delivery model makes labour practice and attrition the material social exposures, ") +
          `while the direct environmental footprint is offices and data centre energy rather than process emissions. ` +
          `Governance exposure follows from the ownership structure, which for a ${c.region} listed company is disclosed in ${narrativeHome(d)}.`,
        { label: "Model", value: c.subsector },
      );
      e.gap(
        "Sustainability report with the materiality assessment",
        "Exposures are inferred from the operating model rather than read from the company's own ranking of them.",
        IR_SITE,
        "medium",
      );
      return;
    }
    e.gap(
      "The sustainability report and the materiality assessment",
      "No principal risk headings or sustainability statements were recovered, so material exposures cannot be named from the record.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "medium",
    );
    return;
  }

  e.find(
    esg.length >= 4 ? "attention" : "info",
    `${esg.length} of ${headings.length} principal risks are environmental, social or governance`,
    (esg.length > 0
      ? esg.slice(0, 3).map((h) => `"${quote(h, 170)}"`).join(" ") + " "
      : "None of the board's principal risks falls into an environmental, social or governance category. ") +
      `These are the risks the board itself identified as principal, which makes the proportion a direct read on how material the company considers these exposures to be, rather than an external score.`,
    { label: "ESG risks", value: `${esg.length}/${headings.length}` },
  );
};

const esgEnvironment: SeatFn = (d, e) => {
  const climate = sig(d, "climate");

  if (climate.length > 0) {
    const quantified = climate.find((s) => /\d/.test(s.sentence) && /emission|carbon|scope|renewable|net zero/i.test(s.sentence));
    e.find(
      "info",
      `${climate.length} environmental statement${climate.length === 1 ? "" : "s"} disclosed in the filed narrative`,
      climate.slice(0, 2).map((s) => `"${quote(s.sentence, 250)}"`).join(" ") +
        ` Read from item ${climate[0].item}. ` +
        (quantified
          ? "At least one disclosure carries a figure, which makes the commitment measurable and therefore testable against subsequent reporting."
          : "The disclosures are qualitative. A commitment without a figure cannot be tracked, and it should not be relied on in an ESG-linked financing structure."),
      { label: "Statements", value: String(climate.length) },
    );
  } else {
    e.find(
      "info",
      "No environmental exposure disclosed in the filed narrative",
      `The ${d.filing?.form ?? "filed record"} was searched for climate, emissions, energy and environmental regulation statements and returned none. ` +
        (d.resolved.inUniverse && /services|software|IT/i.test(d.resolved.inUniverse.subsector)
          ? `For a ${d.resolved.inUniverse.subsector.toLowerCase()} business the direct footprint is small and the material exposure is usually in the supply chain and in data centre energy, neither of which is separately disclosed here.`
          : "Absence of disclosure is not absence of exposure, particularly where the footprint sits with suppliers rather than with the filer."),
      { label: "Statements", value: "0" },
    );
  }

  const energy = bal(d, "ppe");
  if (energy !== null) {
    e.find(
      "info",
      `Physical asset base of ${usd(energy)} US dollars carries the direct footprint`,
      `Property and equipment is the balance the direct environmental exposure attaches to: buildings, plant and data centre equipment. ` +
        `It is the only quantified proxy available from the tagged record, and it sizes the transition exposure rather than measuring it.`,
      { label: "Fixed assets", value: `${usd(energy)} USD` },
    );
  }
};

const esgSocial: SeatFn = (d, e) => {
  const emp = employeeCount(d);
  let said = false;

  if (emp !== null) {
    e.find(
      "info",
      `Workforce of ${n0(emp.count)} people is the primary social exposure`,
      `"${quote(emp.sentence, 260)}" ` +
        `Scale of employment is what makes labour practice, pay equity and health and safety material for this subject rather than incidental. ` +
        `It also sets the exposure to employment regulation in each jurisdiction the business operates in.`,
      { label: "Employees", value: n0(emp.count) },
    );
    said = true;
  }

  const social = (d.filing?.riskHeadings ?? []).filter((h) =>
    /employ|labour|labor|talent|divers|inclusion|human right|safety|community|privacy/i.test(h),
  );
  if (social.length > 0) {
    e.find(
      "attention",
      `${social.length} principal risk${social.length === 1 ? "" : "s"} relate to people and society`,
      social.slice(0, 3).map((h) => `"${quote(h, 170)}"`).join(" ") +
        ` The board naming these as principal is stronger evidence of materiality than any external rating, because it carries a disclosure obligation behind it.`,
      { label: "Social risks", value: String(social.length) },
    );
    said = true;
  }

  const sbc = f(d, "shareComp");
  if (sbc !== null && emp !== null) {
    e.find(
      "info",
      `Equity participation averages ${usd(sbc / emp.count)} US dollars per employee`,
      `Total equity compensation ${usd(sbc)} across ${n0(emp.count)} people. Broad participation in ownership is a social measure with a financial consequence: ` +
        `it aligns the workforce with the outcome, and the distribution of it is a fair-pay question that averages conceal.`,
      { label: "Equity per head", value: `${usd(sbc / emp.count)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "Workforce data: pay equity, safety record and turnover by category",
      "No headcount or social risk disclosure was recovered, so the social exposure cannot be sized from the record.",
      DATA_ROOM,
      "medium",
    );
  }
};

const esgGovernance: SeatFn = (d, e) => {
  const amendments = d.filings.filter((x) => x.form.includes("/A")).length;
  const proxies = d.filings.filter((x) => x.form.startsWith("DEF 14A")).length;
  const governance = sig(d, "governance");
  const controls = sect(d, "controls");

  e.find(
    amendments > 0 ? "attention" : "info",
    amendments > 0
      ? `Control environment carries ${amendments} restatement signal${amendments === 1 ? "" : "s"}`
      : "No restatement signal in the filing record",
    `${proxies} governance filing${proxies === 1 ? "" : "s"} and ${amendments} amendment${amendments === 1 ? "" : "s"} on the record` +
      (controls ? `, alongside a controls and procedures section running to ${n0(controls.chars)} characters` : "") +
      `. Governance is the workstream that predicts the others: weak control is the mechanism behind restatements and misreporting, so a finding here raises the weight on every other workstream.`,
    { label: "Amendments", value: String(amendments) },
  );

  if (governance.length > 0) {
    e.find(
      "risk",
      "Concentrated voting control disclosed",
      governance.slice(0, 2).map((s) => `"${quote(s.sentence, 260)}"`).join(" ") +
        ` Read from item ${governance[0].item}. ` +
        `Where voting control is concentrated, minority protections are contractual rather than structural. ` +
        `That is a governance fact with a direct valuation consequence, and it determines what a minority position can actually enforce.`,
      { label: "Disclosures", value: String(governance.length) },
    );
  } else {
    e.find(
      "info",
      "No dual class structure or concentrated control disclosed",
      `The filed narrative was searched for dual class share structures, controlled company status and beneficial control statements, and returned none. ` +
        `On the face of the record, voting rights track economic ownership, which means governance protections are structural rather than negotiated.`,
      { label: "Control findings", value: "0" },
    );
  }
};

/* ================================================================== *
 * 08 Synthesis and decision
 * ================================================================== */

const valuation: SeatFn = (d, e) => {
  const rev = f(d, "revenue");
  const ni = f(d, "netIncome");
  const op = f(d, "operatingIncome");
  const dep = f(d, "depreciation");
  const eps = f(d, "epsDiluted");
  const shares = f(d, "dilutedShares");
  const ops = f(d, "cashFromOps");
  const capex = f(d, "capex");
  const debt = (bal(d, "debt") ?? 0) + (bal(d, "debtCurrent") ?? 0);
  const cash = bal(d, "cash");
  let said = false;

  const ebitda = op !== null ? op + (dep ?? 0) : null;

  // A traded reference where one is available, and the fundamentals that
  // anchor a range where it is not. The quote feed refuses shared hosting, so
  // the fundamentals path is the one that has to carry this agent.
  if (d.quote) {
    const q = d.quote;
    const mcap = shares !== null ? q.price * shares : null;
    e.find(
      "info",
      `Market reference ${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${q.currency}`,
      `Against a fifty two week range of ${q.fiftyTwoWeekLow?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "not reported"} to ${q.fiftyTwoWeekHigh?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "not reported"}` +
        (mcap !== null ? `, implying an equity value of about ${usd(mcap)} on ${n0(shares!)} diluted shares` : "") +
        (mcap !== null && ebitda !== null && ebitda > 0
          ? ` and an enterprise value of roughly ${usd(mcap + debt - (cash ?? 0))}, or ${((mcap + debt - (cash ?? 0)) / ebitda).toFixed(1)} times EBITDA`
          : "") +
        `. A traded reference anchors a range; it does not set the price for a control position.`,
      { label: "Last", value: `${q.price} ${q.currency}` },
    );
    said = true;
  }

  if (ebitda !== null && rev !== null) {
    e.find(
      "info",
      `EBITDA of ${usd(ebitda)} US dollars, ${((ebitda / rev) * 100).toFixed(1)} percent of revenue`,
      `Built from operating income of ${usd(op!)}` +
        (dep !== null ? ` plus depreciation and amortisation of ${usd(dep)}` : " with no depreciation add-back recovered") +
        `. This is the multiple base before any management adjustment. ` +
        `Net debt of ${usd(debt - (cash ?? 0))} is the bridge from enterprise to equity value, so at any given multiple that bridge is what the equity cheque turns on.`,
      { label: "EBITDA", value: `${usd(ebitda)} USD` },
    );
    said = true;
  }

  if (ops !== null && capex !== null && ebitda !== null && ebitda > 0) {
    const fcf = ops - Math.abs(capex);
    e.find(
      "info",
      `Free cash flow converts ${((fcf / ebitda) * 100).toFixed(0)} percent of EBITDA`,
      `Free cash flow of ${usd(fcf)} against EBITDA of ${usd(ebitda)}. ` +
        `Conversion is what determines the multiple a buyer can pay and still service the structure. ` +
        `Two businesses on the same EBITDA multiple with materially different conversion are not priced the same, and this is the ratio that says so.`,
      { label: "EBITDA to cash conversion", value: `${((fcf / ebitda) * 100).toFixed(0)}%` },
    );
    said = true;
  }

  if (eps !== null) {
    e.find(
      "info",
      `Diluted earnings per share ${eps.toFixed(2)} US dollars`,
      (ni !== null ? `On net income of ${usd(ni)}` : "") +
        (shares !== null ? ` across ${n0(shares)} diluted shares` : "") +
        `. The diluted count is the right denominator because it already reflects the equity awards outstanding, which is the dilution a buyer inherits rather than the one currently in issue.`,
      { label: "Diluted EPS", value: `${eps.toFixed(2)} USD` },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "A comparable transaction set and the agreed adjusted base",
      "Neither an earnings base nor a market reference was recovered, so value cannot be anchored to anything.",
      d.resolved.cik ? DATA_ROOM : IR_SITE,
      "high",
    );
    return;
  }

  e.gap(
    "Comparable transaction multiples for control positions",
    "Fundamentals set the base. Only recent transactions in the same subsector say what a control position clears at, and that is the number the committee asks for.",
    "Transaction database or the corporate finance adviser",
    "medium",
  );
};

const dealStructure: SeatFn = (d, e) => {
  const op = f(d, "operatingIncome");
  const dep = f(d, "depreciation");
  const ebitda = op !== null ? op + (dep ?? 0) : null;
  const debt = (bal(d, "debt") ?? 0) + (bal(d, "debtCurrent") ?? 0);
  const cash = bal(d, "cash");
  const lease = bal(d, "leaseLiability");
  const ops = f(d, "cashFromOps");
  const capex = f(d, "capex");
  const interest = f(d, "interestExpense");

  if (ebitda === null) {
    e.gap(
      "An agreed EBITDA base and the existing facility agreements",
      "Structure is a function of what the business can service. Without an earnings base neither leverage capacity nor the debt-free cash-free bridge can be built.",
      DATA_ROOM,
      "high",
    );
    return;
  }

  const net = debt - (cash ?? 0);
  const currentTurns = ebitda > 0 ? net / ebitda : null;

  e.find(
    currentTurns !== null && currentTurns > 3 ? "attention" : "info",
    currentTurns !== null
      ? `Existing net leverage ${currentTurns.toFixed(1)} times EBITDA`
      : `Net debt of ${usd(net)} US dollars against EBITDA of ${usd(ebitda)}`,
    `Gross debt ${usd(debt)}` +
      (cash !== null ? `, cash ${usd(cash)}` : "") +
      (lease !== null ? `, and lease obligations of ${usd(lease)} which behave as debt for coverage purposes` : "") +
      `. On EBITDA of ${usd(ebitda)}. ` +
      (lease !== null && ebitda > 0
        ? `Including leases the ratio is ${((net + lease) / ebitda).toFixed(1)} times, which is the figure a lender will actually test. `
        : "") +
      (currentTurns !== null && currentTurns > 3
        ? "The balance sheet arrives leveraged, so incremental capacity is limited and the equity cheque carries more of the consideration."
        : "There is headroom in the existing structure, so the constraint is lender appetite rather than the balance sheet as it stands."),
    { label: "Net leverage", value: currentTurns !== null ? `${currentTurns.toFixed(1)}x` : `${usd(net)} USD` },
  );

  if (ops !== null && capex !== null) {
    const fcf = ops - Math.abs(capex);
    const serviceable = fcf > 0 ? fcf : 0;
    e.find(
      fcf <= 0 ? "risk" : "info",
      `Free cash flow of ${usd(fcf)} US dollars is what services the structure`,
      (interest !== null && interest > 0
        ? `Current interest cost is ${usd(Math.abs(interest))}, covered ${(serviceable / Math.abs(interest)).toFixed(1)} times by free cash flow. `
        : "") +
        (fcf <= 0
          ? "Free cash flow is negative before any new interest cost, so no leverage is serviceable and the structure has to be all equity until that changes."
          : `Every additional turn of debt consumes cash before amortisation, so the cover ratio here sets the ceiling on the structure far more tightly than the leverage multiple does.`),
      { label: "Free cash flow", value: `${usd(fcf)} USD` },
    );
  }

  e.gap(
    "Existing facility agreements with change of control and prepayment terms",
    "Capacity is arithmetic. Whether the existing debt can stay, must be repaid, or blocks the transaction outright is in the agreements, and it changes the funds flow entirely.",
    DATA_ROOM,
    "high",
  );
};

/**
 * Measures that describe the company and must therefore agree wherever two
 * agents state them. Counts that are local to an agent, such as how many
 * disclosures it matched, are deliberately excluded: two agents reporting a
 * different number of disclosures are not in conflict, they searched for
 * different things, and flagging that as a contradiction trains the reader to
 * ignore this agent.
 */
const CANONICAL_METRICS = new Set([
  "Revenue",
  "Operating margin",
  "Gross margin",
  "EBITDA",
  "Free cash flow",
  "Employees",
  "Net leverage",
  "Gross debt",
  "Effective tax rate",
  "Cash conversion",
  "EBITDA to cash conversion",
  "Compound growth",
  "R&D intensity",
  "Equity compensation",
  "Days sales outstanding",
  "Reported base",
  "Diluted EPS",
]);

const consistency: SeatFn = (_d, e, prior) => {
  const byLabel = new Map<string, Map<string, string[]>>();
  for (const x of prior) {
    if (!x.metric) continue;
    if (!CANONICAL_METRICS.has(x.metric.label)) continue;
    const held = byLabel.get(x.metric.label) ?? new Map<string, string[]>();
    const agents = held.get(x.metric.value) ?? [];
    agents.push(x.agentName);
    held.set(x.metric.value, agents);
    byLabel.set(x.metric.label, held);
  }

  const conflicts = [...byLabel.entries()].filter(([, v]) => v.size > 1);
  const crossChecked = [...byLabel.entries()].filter(([, v]) => {
    const total = [...v.values()].reduce((s, a) => s + a.length, 0);
    return total > 1;
  });

  if (conflicts.length === 0) {
    e.find(
      "info",
      `${byLabel.size} distinct metrics cross-checked, no conflicts`,
      `${crossChecked.length} of them were asserted by more than one agent and agreed in every case. ` +
        `This is the check that catches the same number written two different ways in one paper, which is the error that costs credibility in a committee even when the underlying analysis is right.`,
      { label: "Metrics checked", value: String(byLabel.size) },
    );
    return;
  }

  e.find(
    "risk",
    `${conflicts.length} metric${conflicts.length === 1 ? "" : "s"} asserted with conflicting values`,
    conflicts
      .map(
        ([label, values]) =>
          `${label}: ` +
          [...values.entries()].map(([v, agents]) => `${v} (${agents.join(", ")})`).join(" against "),
      )
      .join("; ") + ". These must be reconciled before the paper is circulated.",
    { label: "Conflicts", value: String(conflicts.length) },
  );
};

const adversary: SeatFn = (d, e, prior) => {
  const bear: string[] = [];

  if (d.derived.revenueCagrPct !== null && d.derived.revenueCagrPct < 8) {
    bear.push(
      `growth of ${pct(d.derived.revenueCagrPct)} leaves the return dependent on multiple expansion, which the buyer does not control`,
    );
  }

  const op = marginOf(d, "operatingIncome");
  if (op !== null && op < 12) {
    bear.push(`an operating margin of ${op.toFixed(1)} percent leaves little absorption for execution error`);
  }

  const ni = f(d, "netIncome");
  const cfo = f(d, "cashFromOps");
  if (ni !== null && cfo !== null && ni > 0 && cfo < ni * 0.9) {
    bear.push(
      `cash conversion at ${((cfo / ni) * 100).toFixed(0)} percent means the reported profit is not fully collected, so the earnings base is softer than it reads`,
    );
  }

  const dso = days(bal(d, "receivables"), f(d, "revenue"));
  if (dso !== null && dso > 100) {
    bear.push(`${dso.toFixed(0)} days of receivables means growth is funded before it is collected`);
  }

  const conc = sig(d, "customerConcentration");
  const stated = conc.length > 0 ? firstPct(conc[0].sentence) : null;
  if (stated !== null && stated >= 10) {
    bear.push(`disclosed customer concentration of ${stated} percent puts a renewal calendar in front of the thesis`);
  }

  const goodwill = bal(d, "goodwill");
  const equity = bal(d, "equity");
  if (goodwill !== null && equity !== null && goodwill > equity * 0.8) {
    bear.push(
      `goodwill at ${((goodwill / equity) * 100).toFixed(0)} percent of equity means one impairment removes most of the book value`,
    );
  }

  const rate = f(d, "effectiveTaxRate");
  if (rate !== null && rate * 100 < 12) {
    bear.push(
      `an effective tax rate of ${(rate * 100).toFixed(1)} percent depends on structure that a change of control can disturb`,
    );
  }

  if (d.documents.length === 0) {
    bear.push(
      "the entire run is built on the public record, so nothing here has been tested against management accounts or contracts",
    );
  }

  const risks = prior.filter((x) => x.severity === "risk");
  if (risks.length > 0) {
    bear.push(
      `${risks.length} risk finding${risks.length === 1 ? "" : "s"} upstream remain unquantified: ${risks.slice(0, 2).map((x) => x.headline).join("; ")}`,
    );
  }

  if (bear.length === 0) {
    e.find(
      "info",
      "The case for passing is weak on the public record",
      `Growth, margin, cash conversion, collection, concentration, goodwill cover and the tax position were each tested for a reason to decline and none returned one. ` +
        `That is a statement about the filed record only. The absence of a public objection is not diligence, and the strongest remaining objection is simply that nothing here has been verified against the data room.`,
      { label: "Objections", value: "0" },
    );
    return;
  }

  e.find(
    bear.length >= 4 ? "risk" : "attention",
    `${bear.length} argument${bear.length === 1 ? "" : "s"} for declining, made deliberately`,
    `The case against, built from the same record as the case for: ${bear.map((b, i) => `${i + 1}. ${b}`).join(". ")}. ` +
      `Each of these is a question the committee will ask. Answering them before the paper is written is cheaper than answering them in the room.`,
    { label: "Objections", value: String(bear.length) },
  );
};

const memo: SeatFn = (d, e, prior) => {
  const risks = prior.filter((x) => x.severity === "risk");
  const attention = prior.filter((x) => x.severity === "attention");
  const info = prior.filter((x) => x.severity === "info");

  const rev = d.derived.latestRevenueUsd;
  const op = marginOf(d, "operatingIncome");
  const cagr = d.derived.revenueCagrPct;

  const headline =
    risks.length > 0
      ? `Proceed with ${risks.length} risk finding${risks.length === 1 ? "" : "s"} to resolve before committee`
      : attention.length > 2
        ? `Proceed to management sessions with ${attention.length} items to test`
        : `No public-record objection to proceeding`;

  e.find(
    risks.length > 0 ? "risk" : attention.length > 2 ? "attention" : "info",
    headline,
    `${d.resolved.name}` +
      (rev !== null ? `, ${usd(rev)} US dollars of revenue in ${period(d)}` : "") +
      (op !== null ? ` at a ${op.toFixed(1)} percent operating margin` : "") +
      (cagr !== null ? `, compound growth ${pct(cagr)}` : "") +
      `. This run produced ${prior.length} findings across the workstreams: ${risks.length} risk, ${attention.length} attention, ${info.length} informational. ` +
      (risks.length > 0
        ? `The risk findings are: ${risks.map((x) => `${x.headline} (${x.agentName})`).join("; ")}. `
        : "") +
      `Evidence base: ${held(d) || "public record only"}. ` +
      `Every figure in this paper is computed from a retrieved source and can be traced to the agent and the document that produced it.`,
    { label: "Findings", value: String(prior.length) },
  );

  const sources = new Set(d.sources.map((s) => s.source));
  e.find(
    "info",
    `Paper rests on ${sources.size} distinct source${sources.size === 1 ? "" : "s"}`,
    [...sources].slice(0, 6).join("; ") +
      `. Retrieved for this run rather than held in a store, so the paper reflects the record as it stood at the time of the run` +
      (periodEnd(d) ? ` against a reporting period ended ${periodEnd(d)}` : "") +
      `. Nothing has been carried forward from an earlier run.`,
    { label: "Sources", value: String(sources.size) },
  );

  e.gap(
    "Committee sign-off on the open items list before circulation",
    "The paper is complete against the public record. The open items are what management sessions and the data room have to close, and they should be agreed before the paper is issued rather than after.",
    "Deal team and investment committee",
    "high",
  );
};

/* ================================================================== *
 * 09 Portfolio monitoring
 * ================================================================== */

const kpiIntake: SeatFn = (d, e) => {
  const q = d.facts?.series.revenue?.quarterly ?? [];
  const irRev = irMetric(d, [/^revenue$/i, /^total revenue/i, /^gross revenue/i]);
  let said = false;

  if (q.length > 0) {
    e.find(
      "info",
      `${q.length} quarterly revenue periods available for tracking`,
      `Most recent: ${q.slice(-4).map((p) => `${p.label} ${usd(p.value)}`).join(", ")}. ` +
        `Quarterly tagged data is what makes monitoring a measurement rather than a conversation, because each point arrives on a filing date rather than on a management cycle.`,
      { label: "Quarters", value: String(q.length) },
    );
    said = true;
  }

  if (irRev && irRev.values.length > 0) {
    e.find(
      "info",
      `${irRev.values.length} published periods tracked from the company's own files`,
      `"${irRev.label}" in ${irCurrency(d)}: ${irRev.values.slice(-6).map((v) => `${v.period} ${n0(v.value)}`).join(", ")}. ` +
        `Read directly from the file the company published, so the cadence follows its reporting calendar.`,
      { label: "Periods", value: String(irRev.values.length) },
    );
    said = true;
  }

  if (!said) {
    e.gap(
      "A monthly KPI pack with the definitions attached",
      "No quarterly or published series was recovered, so there is no baseline against which any subsequent period could be compared.",
      "Portfolio company finance team",
      "high",
    );
  }
};

const reconcile: SeatFn = (d, e) => {
  const q = d.facts?.series.revenue?.quarterly ?? [];
  const a = annual(d, "revenue");

  if (q.length >= 4 && a.length >= 1) {
    const latestYear = a[a.length - 1];
    const inYear = q.filter((p) => p.end <= latestYear.end && p.end > (a[a.length - 2]?.end ?? "0000"));
    if (inYear.length >= 3) {
      const summed = inYear.reduce((s, p) => s + p.value, 0);
      const diff = ((summed - latestYear.value) / latestYear.value) * 100;
      e.find(
        Math.abs(diff) > 5 && inYear.length === 4 ? "attention" : "info",
        inYear.length === 4
          ? `Four quarters sum to within ${Math.abs(diff).toFixed(1)} percent of the reported year`
          : `${inYear.length} of four quarters recovered for ${latestYear.label}`,
        `Quarterly total ${usd(summed)} against the annual figure of ${usd(latestYear.value)}. ` +
          (inYear.length === 4
            ? Math.abs(diff) > 5
              ? "A gap this wide between the quarters and the audited year means either a restatement or a fourth quarter that was not tagged consistently. It has to be resolved before either series is used for monitoring."
              : "The two series agree, which is the check that confirms the quarterly track can be trusted for monitoring between annual filings."
            : "The remaining quarter is not separately tagged, which is normal where the fourth quarter is reported only inside the annual figure. It is derived rather than filed."),
        { label: "Variance", value: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%` },
      );
      return;
    }
  }

  if (a.length >= 2) {
    e.find(
      "info",
      `Annual series reconciles across ${a.length} filed periods`,
      `${a.map((p) => `${p.label} ${usd(p.value)}`).join(", ")}. ` +
        `Each point is the latest filed value for that period, so a restatement supersedes the figure it corrects rather than sitting alongside it. ` +
        `Quarterly tagging was not available in a form that could be summed against the year, so the cross-check is between filings rather than within one.`,
      { label: "Periods", value: String(a.length) },
    );
    return;
  }

  e.gap(
    "Trial balance tied to the management accounts",
    "Fewer than two comparable periods were recovered, so no reconciliation is possible.",
    "Portfolio company finance team",
    "high",
  );
};

const runway: SeatFn = (d, e) => {
  const cash = bal(d, "cash");
  const ops = f(d, "cashFromOps");
  const capex = f(d, "capex");
  const debt = (bal(d, "debt") ?? 0) + (bal(d, "debtCurrent") ?? 0);

  if (cash === null) {
    e.gap(
      "Cash balance and the thirteen week cash flow forecast",
      "No cash balance was recovered, so runway cannot be computed and no escalation threshold can be set.",
      "Portfolio company finance team",
      "high",
    );
    return;
  }

  const fcf = ops !== null && capex !== null ? ops - Math.abs(capex) : null;

  if (fcf !== null && fcf < 0) {
    const months = (cash / Math.abs(fcf)) * 12;
    e.find(
      months < 18 ? "risk" : "attention",
      `Cash of ${usd(cash)} US dollars against a burn of ${usd(Math.abs(fcf))} a year is ${months.toFixed(0)} months of runway`,
      `Computed from the filed balance and the filed free cash flow, so it is a run rate rather than a forecast and it assumes the current period repeats. ` +
        (months < 18
          ? "Runway inside eighteen months means the financing decision is already live, and it should be taken while the business still has a choice about terms."
          : "Runway is adequate on the current run rate, but the burn is real and the trigger point should be diarised rather than watched."),
      { label: "Runway", value: `${months.toFixed(0)} months` },
    );
  } else if (fcf !== null) {
    e.find(
      "info",
      `Cash of ${usd(cash)} US dollars with free cash flow of ${usd(fcf)}, self-funding`,
      `The business generates cash after capital expenditure, so runway is not the constraint. ` +
        (debt > 0
          ? `Gross debt of ${usd(debt)} means the relevant monitoring measure is fixed charge cover rather than months of cash, and that is what should carry the covenant.`
          : `With no debt drawn, the monitoring question is deployment of the balance rather than survival of it.`),
      { label: "Cash", value: `${usd(cash)} USD` },
    );
  } else {
    e.find(
      "info",
      `Cash balance of ${usd(cash)} US dollars on the last filed balance sheet`,
      `Operating cash flow or capital expenditure was not recovered for the same period, so a burn rate cannot be computed and runway is not stated rather than being estimated.`,
      { label: "Cash", value: `${usd(cash)} USD` },
    );
  }
};

const valuationMovement: SeatFn = (d, e) => {
  const revSeries = history(d, "revenue");
  const op = f(d, "operatingIncome");
  const opPrior = fPrior(d, "operatingIncome");
  const dep = f(d, "depreciation");

  if (revSeries.length < 2) {
    e.gap(
      "The valuation model with the bridge from last period",
      "Fewer than two filed periods were recovered, so no movement can be attributed.",
      "Deal team valuation model",
      "medium",
    );
    return;
  }

  const now = revSeries[revSeries.length - 1];
  const before = revSeries[revSeries.length - 2];
  const revMove = ((now.value - before.value) / before.value) * 100;

  const ebitdaNow = op !== null ? op + (dep ?? 0) : null;
  const ebitdaBefore = opPrior !== null ? opPrior + (dep ?? 0) : null;
  const ebitdaMove =
    ebitdaNow !== null && ebitdaBefore !== null && ebitdaBefore !== 0
      ? ((ebitdaNow - ebitdaBefore) / Math.abs(ebitdaBefore)) * 100
      : null;

  e.find(
    ebitdaMove !== null && ebitdaMove < 0 ? "attention" : "info",
    `Carrying value moves with ${pct(revMove)} revenue` +
      (ebitdaMove !== null ? ` and ${pct(ebitdaMove)} EBITDA` : ""),
    `${before.label} revenue ${usd(before.value)} to ${now.label} ${usd(now.value)}. ` +
      (ebitdaNow !== null && ebitdaBefore !== null
        ? `EBITDA ${usd(ebitdaBefore)} to ${usd(ebitdaNow)}. `
        : "") +
      (ebitdaMove !== null && ebitdaMove < revMove - 5
        ? "Earnings growing slower than revenue means the multiple has to expand simply to hold the carrying value flat, which is the mechanism behind most quiet write-downs."
        : "Earnings are keeping pace with the top line, so the carrying value moves with performance rather than with an assumption about the multiple."),
    { label: "Revenue movement", value: pct(revMove) },
  );
};

const flag: SeatFn = (d, e, prior) => {
  const triggers: string[] = [];

  const dso = days(bal(d, "receivables"), f(d, "revenue"));
  const priorDso = days(d.facts?.series.receivables?.annual.at(-2)?.value ?? null, fPrior(d, "revenue"));
  if (dso !== null && priorDso !== null && dso - priorDso > 12) {
    triggers.push(`receivables extended ${(dso - priorDso).toFixed(0)} days year on year`);
  }

  const op = marginOf(d, "operatingIncome");
  const opPrior = safeRatio(fPrior(d, "operatingIncome"), fPrior(d, "revenue"));
  if (op !== null && opPrior !== null && op - opPrior * 100 < -2) {
    triggers.push(`operating margin fell ${Math.abs(op - opPrior * 100).toFixed(1)} points`);
  }

  const ni = f(d, "netIncome");
  const cfo = f(d, "cashFromOps");
  if (ni !== null && cfo !== null && ni > 0 && cfo < ni * 0.8) {
    triggers.push(`cash conversion fell to ${((cfo / ni) * 100).toFixed(0)} percent of net income`);
  }

  const deferred = bal(d, "deferredRevenue");
  const priorDef = d.facts?.series.deferredRevenue?.annual.at(-2)?.value ?? null;
  if (deferred !== null && priorDef !== null && priorDef > 0 && deferred < priorDef) {
    triggers.push(`deferred revenue contracted ${(((priorDef - deferred) / priorDef) * 100).toFixed(0)} percent`);
  }

  const risks = prior.filter((x) => x.severity === "risk");

  if (triggers.length === 0 && risks.length === 0) {
    e.find(
      "info",
      "No escalation trigger crossed on the filed record",
      `Thresholds tested: receivables extending more than twelve days, operating margin falling more than two points, cash conversion below eighty percent of net income, and deferred revenue contracting. ` +
        `None was crossed. Thresholds are stated so that a future run measures against the same line rather than against a fresh judgement.`,
      { label: "Triggers", value: "0" },
    );
    return;
  }

  e.find(
    triggers.length >= 2 || risks.length > 0 ? "risk" : "attention",
    `${triggers.length + risks.length} escalation trigger${triggers.length + risks.length === 1 ? "" : "s"} crossed`,
    (triggers.length > 0 ? `Measured: ${triggers.join("; ")}. ` : "") +
      (risks.length > 0 ? `Carried from the workstreams: ${risks.map((x) => x.headline).join("; ")}. ` : "") +
      `Each of these is a threshold agreed in advance rather than a judgement made now, which is what makes the escalation defensible when it is unwelcome.`,
    { label: "Triggers", value: String(triggers.length + risks.length) },
  );
};

const letter: SeatFn = (d, e, prior) => {
  const risks = prior.filter((x) => x.severity === "risk").length;
  const attention = prior.filter((x) => x.severity === "attention").length;
  const rev = d.derived.latestRevenueUsd;
  const op = marginOf(d, "operatingIncome");

  e.find(
    "info",
    `Position summary for ${d.resolved.name}`,
    (rev !== null ? `Revenue ${usd(rev)} US dollars in ${period(d)}` : "Revenue not reported on the public record") +
      (op !== null ? ` at a ${op.toFixed(1)} percent operating margin` : "") +
      (d.derived.revenueCagrPct !== null ? `, compound growth ${pct(d.derived.revenueCagrPct)} across ${d.derived.years + 1} periods` : "") +
      `. This period's monitoring run produced ${prior.length} observations, of which ${risks} require action and ${attention} require attention. ` +
      `Figures are as filed and as published, with the source and retrieval time recorded against each. ` +
      `Nothing in this summary is an estimate, and where a measure could not be computed it is named as an open item rather than filled in.`,
    { label: "Observations", value: String(prior.length) },
  );
};


/* ================================================================== *
 * Scope reporting
 * ================================================================== */

/**
 * The concepts each agent's question depends on.
 *
 * Used only when an agent found none of them. Reporting which specific
 * measures were looked for, and which the issuer does publish instead, is a
 * factual answer to "what did this agent do". It is the opposite of the
 * generic restatement it replaces: the list differs by agent and the values
 * differ by company, and a reader can act on it.
 */
const AGENT_CONCEPTS: Record<string, FactKey[]> = {
  explain: ["revenue", "operatingIncome", "netIncome"],
  screen: ["revenue"],
  thesis: ["revenue", "operatingIncome", "rnd"],
  "strategic-fit": ["revenue", "operatingIncome"],
  market: ["revenue"],
  competitor: ["revenue", "operatingIncome"],
  customer: ["receivables", "unbilled", "deferredRevenue"],
  "growth-drivers": ["orderBook", "deferredRevenue", "revenue"],
  "revenue-quality": ["revenue", "orderBook", "deferredRevenue"],
  margin: ["revenue", "operatingIncome", "grossProfit", "costOfRevenue", "sga"],
  "working-capital": ["receivables", "payables", "inventory", "currentAssets", "currentLiabilities"],
  "cash-flow": ["cashFromOps", "capex", "depreciation", "cash"],
  "quality-of-earnings": ["netIncome", "cashFromOps", "shareComp", "restructuring", "impairment"],
  operations: ["capex", "ppe", "leaseLiability", "depreciation"],
  "supply-chain": ["inventory", "payables", "costOfRevenue", "purchaseCommitments"],
  systems: ["intangibles", "goodwill", "assets"],
  technology: ["rnd", "intangibles", "capex"],
  efficiency: ["revenue", "employees", "shareComp"],
  "legal-structure": ["debt", "debtCurrent", "equity", "goodwill", "minorityInterest"],
  contracts: ["orderBook", "deferredRevenue", "leaseLiability", "purchaseCommitments", "receivables"],
  litigation: ["lossContingency"],
  regulatory: [],
  tax: ["effectiveTaxRate", "taxExpense", "pretaxIncome", "unrecognisedTax"],
  management: ["shareComp", "employees"],
  "org-structure": ["employees"],
  compensation: ["shareComp", "employees"],
  culture: ["employees"],
  "key-person": ["employees"],
  "esg-risk": [],
  "esg-environment": ["ppe", "capex"],
  "esg-social": ["employees", "shareComp"],
  "esg-governance": ["equity", "minorityInterest"],
  valuation: ["revenue", "operatingIncome", "depreciation", "epsDiluted", "dilutedShares"],
  "deal-structure": ["operatingIncome", "depreciation", "debt", "cash", "cashFromOps"],
  "kpi-intake": ["revenue"],
  reconcile: ["revenue"],
  runway: ["cash", "cashFromOps", "capex"],
  "valuation-movement": ["revenue", "operatingIncome"],
  flag: ["receivables", "operatingIncome", "cashFromOps", "deferredRevenue"],
};

const CONCEPT_NAME: Partial<Record<FactKey, string>> = {
  revenue: "revenue",
  operatingIncome: "operating income",
  netIncome: "net income",
  grossProfit: "gross profit",
  costOfRevenue: "cost of revenue",
  sga: "selling and administrative cost",
  rnd: "research and development",
  receivables: "trade receivables",
  unbilled: "unbilled receivables",
  payables: "trade payables",
  inventory: "inventory",
  deferredRevenue: "deferred revenue",
  orderBook: "order book",
  cash: "cash",
  cashFromOps: "operating cash flow",
  capex: "capital expenditure",
  depreciation: "depreciation and amortisation",
  ppe: "property and equipment",
  leaseLiability: "lease liabilities",
  purchaseCommitments: "purchase obligations",
  intangibles: "intangible assets",
  goodwill: "goodwill",
  debt: "long term debt",
  debtCurrent: "short term debt",
  equity: "shareholders equity",
  minorityInterest: "non-controlling interests",
  effectiveTaxRate: "effective tax rate",
  taxExpense: "tax expense",
  pretaxIncome: "pre-tax income",
  unrecognisedTax: "unrecognised tax benefits",
  lossContingency: "loss contingency accrual",
  shareComp: "share-based compensation",
  employees: "headcount",
  restructuring: "restructuring charges",
  impairment: "impairment charges",
  epsDiluted: "diluted earnings per share",
  dilutedShares: "diluted share count",
  assets: "total assets",
};

/**
 * States what an agent looked for and what the issuer publishes instead.
 *
 * Called only when an agent produced nothing. It is not a conclusion and does
 * not pretend to be one; it is an inventory, so the reader can see the question
 * was asked and can tell at a glance whether the missing measure is worth
 * chasing for this particular subject.
 */
export function scopeReport(
  agentId: string,
  agentName: string,
  d: CompanyDossier,
  e: Emit,
): void {
  const wanted = AGENT_CONCEPTS[agentId] ?? [];
  const names = wanted.map((k) => CONCEPT_NAME[k] ?? k);

  const publishes = Object.values(d.facts?.series ?? {})
    .filter((x) => x.latest !== null)
    .slice(0, 5)
    .map((x) => `${x.label} ${x.unit === "USD" ? usd(x.latest!) : n0(x.latest!)}`);

  const source = d.resolved.cik
    ? `the ${d.filing?.form ?? "filed record"}`
    : d.ir
      ? `${d.ir.metrics.length} rows published on ${(() => {
          try {
            return new URL(d.ir.indexUrl).hostname;
          } catch {
            return "the investor relations index";
          }
        })()}`
      : "the public record";

  e.find(
    "info",
    names.length > 0
      ? `None of the ${names.length} measures this question needs is reported by this issuer`
      : `${agentName} has no measurable input on the public record for this issuer`,
    (names.length > 0
      ? `Searched for ${names.join(", ")} across ${d.facts?.conceptsResolved ?? 0} concepts recovered from ${source}, and this issuer reports none of them. `
      : `Searched ${source} and found nothing this question can be answered from. `) +
      (publishes.length > 0
        ? `It does report ${publishes.join(", ")}, none of which answers this question. `
        : "") +
      `The measure is therefore requested rather than estimated: a figure invented here would carry the same weight in the paper as one that was filed, and nothing downstream could tell the difference.`,
    { label: "Measures sought", value: String(names.length) },
  );
}

/* ================================================================== *
 * Registry
 * ================================================================== */

export const SEATS: Record<string, SeatFn> = {
  search,
  intake,
  explain,
  screen,
  thesis,
  "red-flag": redFlag,
  "strategic-fit": strategicFit,
  market,
  industry,
  competitor,
  customer,
  "growth-drivers": growthDrivers,
  "revenue-quality": revenueQuality,
  margin,
  "working-capital": workingCapital,
  "cash-flow": cashFlow,
  "quality-of-earnings": qualityOfEarnings,
  operations,
  "supply-chain": supplyChain,
  systems,
  technology,
  efficiency,
  "legal-structure": legalStructure,
  contracts,
  litigation,
  regulatory,
  tax,
  management,
  "org-structure": orgStructure,
  compensation,
  culture,
  "key-person": keyPerson,
  "esg-risk": esgRisk,
  "esg-environment": esgEnvironment,
  "esg-social": esgSocial,
  "esg-governance": esgGovernance,
  valuation,
  "deal-structure": dealStructure,
  consistency,
  adversary,
  memo,
  "kpi-intake": kpiIntake,
  reconcile,
  runway,
  "valuation-movement": valuationMovement,
  flag,
  letter,
};
