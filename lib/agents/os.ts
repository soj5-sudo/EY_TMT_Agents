/**
 * Workstream execution.
 *
 * One shared record is assembled first, then every seat in the workstream reads
 * from it. Seats do not call each other; the record is the interface, which is
 * what keeps a run reproducible and lets any seat be replaced without touching
 * the others.
 *
 * A seat returns findings, gaps, or both. A finding carries evidence. A gap
 * names the document that would close it and who normally holds it. Nothing is
 * inferred to fill a hole, because a fabricated finding in a committee paper is
 * worse than an open item on a request list.
 */

import { randomUUID } from "node:crypto";
import type { Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";
import {
  AGENTS,
  WORKSTREAMS,
  agentsIn,
  getAgent,
  getWorkstream,
  type AgentDef,
  type EvidenceKind,
  type WorkstreamId,
} from "@/lib/agents/registry";
import { research, type CompanyDossier, type IngestedDocument } from "@/lib/research/company";

export interface Finding {
  id: string;
  agentId: string;
  agentName: string;
  severity: "risk" | "attention" | "info";
  headline: string;
  detail: string;
  metric?: { label: string; value: string };
  evidence: Provenance[];
}

export interface Gap {
  id: string;
  agentId: string;
  agentName: string;
  /** What is missing. */
  item: string;
  /** Why the seat cannot proceed without it. */
  blocks: string;
  /** Who normally holds this document. */
  requestFrom: string;
  priority: "high" | "medium" | "low";
}

export interface SeatResult {
  agentId: string;
  agentName: string;
  role: string;
  why: string;
  status: "complete" | "partial" | "blocked";
  findings: Finding[];
  gaps: Gap[];
  /** Evidence kinds the seat had available. */
  evidenceUsed: EvidenceKind[];
  evidenceMissing: EvidenceKind[];
  handsTo: string[];
  humanGate: boolean;
  ms: number;
}

export interface WorkstreamRun {
  runId: string;
  workstream: WorkstreamId;
  workstreamName: string;
  step: string;
  subject: string;
  startedAt: string;
  ms: number;
  seats: SeatResult[];
  findings: Finding[];
  gaps: Gap[];
  /** Seats whose output requires sign-off before the workstream closes. */
  gates: Array<{ agentId: string; agentName: string; role: string }>;
  summary: string;
  dossier: CompanyDossier;
}

/* ------------------------------------------------------------------ *
 * Evidence availability
 * ------------------------------------------------------------------ */

function availableEvidence(d: CompanyDossier): Set<EvidenceKind> {
  const set = new Set<EvidenceKind>();
  if (d.filings.length > 0 || d.financials.length > 0 || d.irQuarters.length > 0)
    set.add("public-filings");
  if (d.quote) set.add("market-data");
  if (d.news.length > 0) set.add("verified-news");
  if (d.documents.length > 0) set.add("provided-documents");
  set.add("prior-findings");
  return set;
}

/** Who normally holds a given class of evidence. */
const HOLDER: Record<EvidenceKind, string> = {
  "public-filings": "Public register. Available for registrants only.",
  "market-data": "Market data feed. Listed subjects only.",
  "verified-news": "Verified publisher set.",
  "provided-documents": "Company or vendor data room.",
  "prior-findings": "Earlier workstream in this run.",
};

/** The document a reviewer would actually ask for, per evidence class. */
const EVIDENCE_REQUEST: Record<EvidenceKind, string> = {
  "public-filings": "Audited statutory accounts, three years",
  "market-data": "Comparable transaction set or a traded reference",
  "verified-news": "Independent market commentary on the subject",
  "provided-documents": "Management pack and supporting schedules",
  "prior-findings": "Output of the preceding workstream",
};

const GAP_REQUEST: Record<EvidenceKind, string> = {
  "public-filings": "Not applicable for a private subject. Request audited accounts instead.",
  "market-data": "Not applicable for an unlisted subject.",
  "verified-news": "No verified coverage in the window.",
  "provided-documents": "Management or vendor data room",
  "prior-findings": "Run the preceding workstream first",
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function usd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  return v.toLocaleString("en-US");
}

function pct(v: number, d = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
}

class Emitter {
  readonly findings: Finding[] = [];
  readonly gaps: Gap[] = [];
  private n = 0;

  constructor(
    private agent: AgentDef,
    private evidence: Provenance[],
  ) {}

  find(
    severity: Finding["severity"],
    headline: string,
    detail: string,
    metric?: Finding["metric"],
  ): void {
    this.findings.push({
      id: `${this.agent.id}-f${++this.n}`,
      agentId: this.agent.id,
      agentName: this.agent.name,
      severity,
      headline,
      detail,
      metric,
      evidence: this.evidence,
    });
  }

  gap(
    item: string,
    blocks: string,
    requestFrom: string,
    priority: Gap["priority"] = "medium",
  ): void {
    this.gaps.push({
      id: `${this.agent.id}-g${++this.n}`,
      agentId: this.agent.id,
      agentName: this.agent.name,
      item,
      blocks,
      requestFrom,
      priority,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Seat implementations
 *
 * Only seats that can compute something from the assembled record have an
 * implementation. Every other seat runs the default path, which reports what
 * it holds and raises a gap for what it does not. That is a deliberate choice:
 * a seat with no evidence should produce a request, not prose.
 * ------------------------------------------------------------------ */

type SeatFn = (d: CompanyDossier, e: Emitter, prior: Finding[]) => void;

const SEATS: Partial<Record<string, SeatFn>> = {
  search: (d, e) => {
    if (d.resolved.cik) {
      e.find(
        "info",
        `Subject resolved to ${d.resolved.name}`,
        `Registrant number ${d.resolved.cik}` +
          (d.resolved.exchanges.length ? `, listed on ${d.resolved.exchanges.join(", ")}` : "") +
          (d.resolved.sicDescription ? `, classified as ${d.resolved.sicDescription}` : "") +
          `. ${d.filings.length} material filings and ${d.news.length} verified items of coverage are on the record.`,
        { label: "Filings on record", value: String(d.filings.length) },
      );
    } else {
      e.gap(
        "Entity identification",
        "No later seat can be trusted until the subject is pinned to a specific legal entity.",
        "Confirm the registered name, or supply the certificate of incorporation",
        "high",
      );
    }
  },

  intake: (d, e) => {
    if (d.documents.length === 0) {
      e.gap(
        "Management pack, trial balance and KPI file",
        "Without supplied records the run is limited to the public register, which excludes management accounts, contracts and customer detail.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }
    const figures = d.documents.reduce((s, x) => s + x.extracted.length, 0);
    e.find(
      "info",
      `${d.documents.length} supplied document${d.documents.length === 1 ? "" : "s"} normalised`,
      d.documents
        .map((x) => `${x.name}, ${x.pages ?? "unknown"} pages, ${x.extracted.length} tagged figures`)
        .join("; ") +
        `. ${figures} figures were recovered with their surrounding context retained for audit.`,
      { label: "Tagged figures", value: String(figures) },
    );
  },

  screen: (d, e) => {
    const rev = d.derived.latestRevenueUsd;
    const cagr = d.derived.revenueCagrPct;
    if (rev === null) {
      e.gap(
        "Three years of audited revenue",
        "Scale and trajectory cannot be tested against the mandate band.",
        GAP_REQUEST["provided-documents"],
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
          : "Trajectory supports a growth case, subject to the commercial workstream separating market from share."),
      { label: "Revenue", value: `${usd(rev)} USD` },
    );
  },

  "red-flag": (d, e) => {
    let raised = 0;

    const amendments = d.filings.filter((f) => f.form.includes("/A"));
    if (amendments.length > 0) {
      raised++;
      e.find(
        "risk",
        `${amendments.length} amended filing${amendments.length === 1 ? "" : "s"} on the record`,
        `Amended forms: ${amendments.slice(0, 4).map((f) => `${f.form} filed ${f.filingDate}`).join(", ")}. ` +
          `An amendment restates something previously filed. The question is always what changed and whether it was disclosed, not whether an amendment exists.`,
        { label: "Amendments", value: String(amendments.length) },
      );
    }

    const eightK = d.filings.filter((f) => f.form.startsWith("8-K"));
    if (eightK.length >= 8) {
      raised++;
      e.find(
        "attention",
        `${eightK.length} current reports in the retained window`,
        `Current reports carry material events between periodic filings. A high count is not itself adverse, but it indicates an eventful period that the commercial and legal workstreams should account for.`,
        { label: "Current reports", value: String(eightK.length) },
      );
    }

    const negative = d.news.filter((n) =>
      /\b(probe|lawsuit|investigat\w+|fine[ds]?|breach|resign\w*|short seller|downgrade|delay)\b/i.test(
        n.title,
      ),
    );
    if (negative.length > 0) {
      raised++;
      e.find(
        "attention",
        `${negative.length} coverage item${negative.length === 1 ? "" : "s"} carrying an adverse signal`,
        negative.slice(0, 3).map((n) => `"${n.title}" (${n.publisher})`).join("; ") +
          ". Reproduced from verified publishers and not independently confirmed.",
        { label: "Adverse items", value: String(negative.length) },
      );
    }

    if (raised === 0) {
      e.find(
        "info",
        "No early disqualifier found in the public record",
        "No amended filings, no unusual current-report cadence and no adverse coverage in the window. This clears the screening gate only; it is not a statement about matters that do not reach the public record.",
      );
    }
  },

  "revenue-quality": (d, e) => {
    const rev = d.financials.find((f) => f.metric === "Revenue");
    if (!rev || rev.points.length < 3) {
      e.gap(
        "Revenue by contract type, and the recognition policy note",
        "Recurring against one-off composition cannot be established, so the top line cannot be tested for repeatability.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }

    const values = rev.points.map((p) => p.value);
    const growths: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) growths.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
    }
    const mean = growths.reduce((a, b) => a + b, 0) / growths.length;
    const variance =
      growths.reduce((a, b) => a + (b - mean) ** 2, 0) / growths.length;
    const volatility = Math.sqrt(variance);

    e.find(
      volatility > 30 ? "attention" : "info",
      `Revenue growth averages ${pct(mean)} with ${volatility.toFixed(1)} points of dispersion`,
      `Year on year growth across ${growths.length} periods: ${growths.map((g) => pct(g, 0)).join(", ")}. ` +
        (volatility > 30
          ? "Dispersion this wide means the average is not a forecast. Either the business is genuinely lumpy, in which case the base must be set conservatively, or the periods are not comparable."
          : "Dispersion is contained, which supports using the trend as a base for the forward case."),
      { label: "Growth dispersion", value: `${volatility.toFixed(1)} pts` },
    );

    e.gap(
      "Revenue by customer and by contract term",
      "Repeatability cannot be separated from renewal risk on filed totals alone.",
      GAP_REQUEST["provided-documents"],
      "medium",
    );
  },

  margin: (d, e) => {
    const rev = d.financials.find((f) => f.metric === "Revenue");
    const op = d.financials.find((f) => f.metric === "Operating income");
    if (!rev || !op) {
      e.gap(
        "Operating income by period, tied to revenue",
        "The margin bridge cannot be built.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }

    const series = rev.points
      .map((p) => {
        const o = op.points.find((x) => x.period === p.period);
        return o && p.value > 0
          ? { label: p.label, margin: (o.value / p.value) * 100 }
          : null;
      })
      .filter((x): x is { label: string; margin: number } => x !== null);

    if (series.length < 2) {
      e.gap(
        "Comparable operating income and revenue for the same periods",
        "Margin cannot be computed across mismatched periods without producing a meaningless ratio.",
        GAP_REQUEST["provided-documents"],
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
  },

  "cash-flow": (d, e) => {
    const cash = d.financials.find((f) => f.metric === "Cash from operations");
    const net = d.financials.find((f) => f.metric === "Net income");
    if (!cash || !net) {
      e.gap(
        "Cash flow statement for three years",
        "Conversion from profit to cash cannot be tested, which is the fastest read on earnings quality.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }

    const paired = cash.points
      .map((p) => {
        const n = net.points.find((x) => x.period === p.period);
        return n && n.value !== 0
          ? { label: p.label, conv: (p.value / n.value) * 100 }
          : null;
      })
      .filter((x): x is { label: string; conv: number } => x !== null);

    if (paired.length === 0) {
      e.gap(
        "Cash flow and net income for matching periods",
        "Conversion cannot be computed across mismatched periods.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }

    const latest = paired[paired.length - 1];
    const below = paired.filter((p) => p.conv < 90).length;

    e.find(
      latest.conv < 80 ? "risk" : latest.conv < 95 ? "attention" : "info",
      `Cash conversion ${latest.conv.toFixed(0)} percent of net income`,
      `Series: ${paired.map((p) => `${p.label} ${p.conv.toFixed(0)}%`).join(", ")}. ` +
        (below >= 2
          ? `${below} of ${paired.length} periods sit below ninety percent. Persistent under-conversion points at receivables extending or at revenue recognised ahead of billing, and warrants an ageing review before pricing.`
          : "Conversion is within the range expected for a business of this type across the periods on file."),
      { label: "Conversion", value: `${latest.conv.toFixed(0)}%` },
    );
  },

  "quality-of-earnings": (d, e, prior) => {
    const rev = d.derived.latestRevenueUsd;
    if (rev === null) {
      e.gap(
        "Audited accounts and the management adjustment schedule",
        "No defensible earnings base can be set, so no multiple can be applied.",
        GAP_REQUEST["provided-documents"],
        "high",
      );
      return;
    }

    const risks = prior.filter((f) => f.severity === "risk").length;
    const attention = prior.filter((f) => f.severity === "attention").length;

    e.find(
      risks > 0 ? "risk" : attention > 1 ? "attention" : "info",
      `Reported base of ${usd(rev)} US dollars carries ${risks} risk and ${attention} attention findings upstream`,
      `The filed figures are the starting point, not the answer. ` +
        (risks > 0
          ? `Upstream risk findings must be quantified as adjustments before this base is used for pricing: ${prior
              .filter((f) => f.severity === "risk")
              .slice(0, 3)
              .map((f) => f.headline)
              .join("; ")}.`
          : `No upstream risk finding requires an adjustment on the public record. Management adjustments remain to be tested against the data room.`),
      { label: "Reported base", value: `${usd(rev)} USD` },
    );

    e.gap(
      "Management adjustment schedule with supporting invoices",
      "Adjusted earnings cannot be independently verified, and the adjusted figure is what the price is set on.",
      GAP_REQUEST["provided-documents"],
      "high",
    );
  },

  technology: (d, e) => {
    const rnd = d.derived.rndIntensityPct;
    if (rnd === null) {
      e.gap(
        "Research and development spend by year",
        "Investment intensity cannot be compared against the peer set.",
        GAP_REQUEST["provided-documents"],
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

    e.find(
      "info",
      `Research intensity ${rnd.toFixed(1)} percent of revenue`,
      `This places the subject as ${band}. Software and semiconductor businesses typically run in the teens to low twenties; IT services run low single digits because capacity, not product, is the cost base. ` +
        `Intensity below the sector norm is not adverse on its own, but it should be reflected in the terminal growth assumption rather than ignored.`,
      { label: "R&D intensity", value: `${rnd.toFixed(1)}%` },
    );
  },

  efficiency: (d, e) => {
    const rev = d.derived.latestRevenueUsd;
    if (rev === null) {
      e.gap(
        "Revenue and headcount for matching periods",
        "Unit economics cannot be computed.",
        GAP_REQUEST["provided-documents"],
        "medium",
      );
      return;
    }
    e.gap(
      "Headcount by period and by function",
      "Revenue per head is the fastest read on whether scale is helping, and it cannot be derived from filed totals for most registrants.",
      GAP_REQUEST["provided-documents"],
      "medium",
    );
  },

  litigation: (d, e) => {
    const items = d.news.filter((n) =>
      /\b(lawsuit|litigation|court|sue[ds]?|settle\w*|claim|arbitrat\w+|probe|investigat\w+)\b/i.test(
        n.title,
      ),
    );
    if (items.length === 0) {
      e.find(
        "info",
        "No disputes surfaced in the verified coverage window",
        "Absence of coverage is not absence of proceedings. Disclosed matters in the periodic filings and a litigation search remain the authoritative check.",
      );
    } else {
      e.find(
        items.length >= 3 ? "attention" : "info",
        `${items.length} coverage item${items.length === 1 ? "" : "s"} referencing disputes or proceedings`,
        items.slice(0, 3).map((n) => `"${n.title}" (${n.publisher})`).join("; ") + ".",
        { label: "Dispute items", value: String(items.length) },
      );
    }
    e.gap(
      "Litigation schedule and counsel letters",
      "Exposure cannot be sized from coverage alone.",
      GAP_REQUEST["provided-documents"],
      "high",
    );
  },

  "esg-governance": (d, e) => {
    const amendments = d.filings.filter((f) => f.form.includes("/A")).length;
    const proxies = d.filings.filter((f) => f.form.startsWith("DEF 14A")).length;
    e.find(
      amendments > 0 ? "attention" : "info",
      amendments > 0
        ? `Control environment carries ${amendments} restatement signal${amendments === 1 ? "" : "s"}`
        : "No restatement signal in the filing record",
      `${proxies} governance filing${proxies === 1 ? "" : "s"} and ${amendments} amendment${amendments === 1 ? "" : "s"} on the record. ` +
        `Governance is the workstream that predicts the others: weak control is the mechanism behind restatements and misreporting, so a finding here raises the weight on every other workstream.`,
      { label: "Amendments", value: String(amendments) },
    );
  },

  valuation: (d, e) => {
    const rev = d.derived.latestRevenueUsd;
    const q = d.quote;
    if (!q) {
      e.gap(
        "Traded comparable set and the agreed adjusted base",
        "Value cannot be anchored without either a market reference or a comparable transaction set.",
        d.resolved.cik ? "Market data feed was unavailable on this run" : GAP_REQUEST["market-data"],
        "high",
      );
      return;
    }
    e.find(
      "info",
      `Market reference ${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${q.currency}`,
      `Live reference against a fifty two week range of ` +
        `${q.fiftyTwoWeekLow?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "not set"} to ` +
        `${q.fiftyTwoWeekHigh?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "not set"}` +
        (rev ? `, on a reported base of ${usd(rev)} US dollars.` : ".") +
        ` A traded reference anchors the range; it does not set the price for a control position.`,
      { label: "Last", value: `${q.price} ${q.currency}` },
    );
  },

  consistency: (_d, e, prior) => {
    // Cross-check: the same metric asserted twice with different values.
    const byLabel = new Map<string, Set<string>>();
    for (const f of prior) {
      if (!f.metric) continue;
      const held = byLabel.get(f.metric.label) ?? new Set<string>();
      held.add(f.metric.value);
      byLabel.set(f.metric.label, held);
    }

    const conflicts = [...byLabel.entries()].filter(([, v]) => v.size > 1);

    if (conflicts.length === 0) {
      e.find(
        "info",
        `${byLabel.size} distinct metrics cross-checked, no conflicts`,
        "Every figure asserted more than once carries the same value across seats. This is the check that catches a number written two different ways in one paper.",
        { label: "Metrics checked", value: String(byLabel.size) },
      );
    } else {
      e.find(
        "risk",
        `${conflicts.length} metric${conflicts.length === 1 ? "" : "s"} asserted with conflicting values`,
        conflicts
          .map(([label, values]) => `${label}: ${[...values].join(" and ")}`)
          .join("; ") +
          ". These must be reconciled before the paper is circulated.",
        { label: "Conflicts", value: String(conflicts.length) },
      );
    }
  },

  adversary: (d, e, prior) => {
    const supporting = prior.filter((f) => f.severity === "info").length;
    const adverse = prior.filter((f) => f.severity !== "info").length;

    // The case for passing, built deliberately.
    const arguments_: string[] = [];

    if (d.derived.revenueCagrPct !== null && d.derived.revenueCagrPct < 8) {
      arguments_.push(
        `growth of ${pct(d.derived.revenueCagrPct)} leaves the return dependent on multiple expansion, which the buyer does not control`,
      );
    }
    if (d.derived.latestOperatingMarginPct !== null && d.derived.latestOperatingMarginPct < 12) {
      arguments_.push(
        `an operating margin of ${d.derived.latestOperatingMarginPct.toFixed(1)} percent leaves little absorption for execution error`,
      );
    }
    if (d.documents.length === 0) {
      arguments_.push(
        "the entire case currently rests on the public record, with no management information tested",
      );
    }
    if (d.news.length === 0) {
      arguments_.push(
        "no verified third-party coverage was found in the window, so the company's own account is unchallenged",
      );
    }

    e.find(
      arguments_.length >= 2 ? "attention" : "info",
      arguments_.length > 0
        ? `Case for passing rests on ${arguments_.length} point${arguments_.length === 1 ? "" : "s"}`
        : "No structural argument for passing identified on the current record",
      arguments_.length > 0
        ? `Argued deliberately against the case: ${arguments_.join("; ")}. ` +
          `This seat exists because a process that only gathers supporting evidence always recommends proceeding.`
        : `On the evidence assembled, no structural argument for passing emerges. That is a statement about the evidence available, not a recommendation.`,
      { label: "Counter-arguments", value: String(arguments_.length) },
    );

    if (adverse === 0 && supporting > 0) {
      e.find(
        "attention",
        "No adverse finding was raised anywhere in this run",
        `${supporting} informational findings and no risk or attention items. A clean run on public data usually means the evidence base is thin rather than the subject is clean. Treat this as an incomplete process rather than a positive result.`,
      );
    }
  },

  memo: (_d, e, prior) => {
    const risk = prior.filter((f) => f.severity === "risk");
    const attention = prior.filter((f) => f.severity === "attention");
    e.find(
      "info",
      `Paper drafted from ${prior.length} findings across the run`,
      `${risk.length} risk, ${attention.length} attention, ${prior.length - risk.length - attention.length} informational. ` +
        (risk.length
          ? `Leading risk: ${risk[0].headline}. `
          : "No risk-rated finding was raised. ") +
        `Every claim in the paper indexes to the seat and the source that produced it. Open items travel with the paper rather than being resolved in it.`,
      { label: "Findings", value: String(prior.length) },
    );
  },

  "kpi-intake": (d, e) => {
    if (d.documents.length === 0) {
      e.gap(
        "Current period KPI pack from each holding",
        "Nothing can be reconciled, so no flag or letter can be produced from actuals.",
        "Portfolio company finance lead",
        "high",
      );
      return;
    }
    e.find(
      "info",
      `${d.documents.length} reporting pack${d.documents.length === 1 ? "" : "s"} normalised to one schema`,
      d.documents.map((x) => `${x.name}, ${x.extracted.length} figures`).join("; ") +
        ". Format differences between senders are absorbed here so the reconciliation seat compares like with like.",
      { label: "Packs", value: String(d.documents.length) },
    );
  },

  reconcile: (d, e) => {
    if (d.documents.length < 1) {
      e.gap(
        "Prior period pack alongside the current one",
        "Restatements cannot be detected without both periods.",
        "Portfolio company finance lead",
        "high",
      );
      return;
    }
    const figures = d.documents.flatMap((x) => x.extracted);
    e.find(
      "info",
      `${figures.length} figures available to tie out`,
      `Tagged values recovered across the supplied packs, each retained with the surrounding context so a movement can be traced to the line it came from. ` +
        `Restatement detection requires the prior period pack in the same session.`,
      { label: "Figures", value: String(figures.length) },
    );
  },

  runway: (d, e) => {
    e.gap(
      "Monthly cash actuals and the current cash balance",
      "Runway must be recomputed from actuals. A figure taken from the last board plan is the number that produces an eleven-month conversation at seven months of cash.",
      "Portfolio company finance lead",
      "high",
    );
  },
};

/* ------------------------------------------------------------------ *
 * Default seat behaviour
 * ------------------------------------------------------------------ */

function runDefaultSeat(agent: AgentDef, available: Set<EvidenceKind>, e: Emitter): void {
  const missing = agent.needs.filter((n) => !available.has(n));

  if (missing.length === 0) {
    e.find(
      "info",
      `${agent.name} has its evidence base but no automated test`,
      `${agent.role}. The evidence this seat requires is present. Its assessment is judgement work that is recorded here rather than computed, and is owned by the reviewer.`,
    );
    return;
  }

  for (const kind of missing) {
    e.gap(
      EVIDENCE_REQUEST[kind],
      `${agent.name} cannot proceed without it. ${agent.why}`,
      GAP_REQUEST[kind],
      agent.humanGate ? "high" : "medium",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export async function runWorkstream(
  workstreamId: WorkstreamId,
  company: string,
  documents: IngestedDocument[] = [],
  /** Findings from earlier workstreams. Seats that reconcile across the run
   *  read these; without them Consistency and Adversary have nothing to work
   *  against and a full review degrades into ten unrelated reports. */
  carried: Finding[] = [],
  /** Reuse an assembled record instead of rebuilding it per workstream. */
  prebuilt?: CompanyDossier,
): Promise<WorkstreamRun> {
  const ws = getWorkstream(workstreamId);
  if (!ws) throw new Error(`Unknown workstream: ${workstreamId}`);

  const started = Date.now();
  const dossier = prebuilt ?? (await research(company, documents));
  const available = availableEvidence(dossier);

  const seats: SeatResult[] = [];
  const allFindings: Finding[] = [...carried];
  const allGaps: Gap[] = [];

  for (const agent of agentsIn(workstreamId)) {
    const seatStart = Date.now();
    const emitter = new Emitter(agent, dossier.sources);
    const impl = SEATS[agent.id];

    try {
      if (impl) impl(dossier, emitter, [...allFindings]);
      else runDefaultSeat(agent, available, emitter);
    } catch (err) {
      emitter.gap(
        `${agent.name} did not complete`,
        err instanceof Error ? err.message : String(err),
        "Re-run the workstream",
        "medium",
      );
    }

    const missing = agent.needs.filter((n) => !available.has(n));
    seats.push({
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      why: agent.why,
      status:
        emitter.findings.length > 0 && emitter.gaps.length === 0
          ? "complete"
          : emitter.findings.length > 0
            ? "partial"
            : "blocked",
      findings: emitter.findings,
      gaps: emitter.gaps,
      evidenceUsed: agent.needs.filter((n) => available.has(n)),
      evidenceMissing: missing,
      handsTo: agent.handsTo,
      humanGate: agent.humanGate,
      ms: Date.now() - seatStart,
    });

    allFindings.push(...emitter.findings);
    allGaps.push(...emitter.gaps);
  }

  const produced = allFindings.filter((f) => !carried.includes(f));

  const rank = { risk: 0, attention: 1, info: 2 } as const;
  produced.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const prio = { high: 0, medium: 1, low: 2 } as const;
  allGaps.sort((a, b) => prio[a.priority] - prio[b.priority]);

  const risk = produced.filter((f) => f.severity === "risk").length;
  const attention = produced.filter((f) => f.severity === "attention").length;
  const blocked = seats.filter((s) => s.status === "blocked").length;

  return {
    runId: randomUUID(),
    workstream: workstreamId,
    workstreamName: ws.name,
    step: ws.step,
    subject: dossier.resolved.name,
    startedAt: nowIso(),
    ms: Date.now() - started,
    seats,
    findings: produced,
    gaps: allGaps,
    gates: agentsIn(workstreamId)
      .filter((a) => a.humanGate)
      .map((a) => ({ agentId: a.id, agentName: a.name, role: a.role })),
    summary:
      `${ws.name} ran ${seats.length} seats against ${dossier.resolved.name}. ` +
      `${produced.length} findings (${risk} risk, ${attention} attention) and ${allGaps.length} open items. ` +
      (blocked
        ? `${blocked} seats are blocked pending evidence. `
        : "Every seat had its evidence base. ") +
      `Closes when: ${ws.closes.toLowerCase()}`,
    dossier,
  };
}

/** Order the lifecycle executes in. Monitoring is post-close and excluded. */
const LIFECYCLE: WorkstreamId[] = [
  "context",
  "screening",
  "commercial",
  "financial",
  "operational",
  "legal",
  "people",
  "esg",
  "synthesis",
];

export interface FullReview {
  subject: string;
  ms: number;
  runs: WorkstreamRun[];
  findings: Finding[];
  gaps: Gap[];
  gates: Array<{ agentId: string; agentName: string; role: string; workstream: string }>;
  summary: string;
}

/**
 * Runs the lifecycle end to end, carrying findings forward.
 *
 * The record is assembled once and shared, so the whole review costs one
 * research pass rather than nine. Each workstream sees everything the previous
 * ones produced, which is what lets Consistency cross-check and Adversary argue
 * against the assembled case rather than against a single step.
 */
export async function runFullReview(
  company: string,
  documents: IngestedDocument[] = [],
): Promise<FullReview> {
  const started = Date.now();
  const dossier = await research(company, documents);

  const runs: WorkstreamRun[] = [];
  const carried: Finding[] = [];

  for (const id of LIFECYCLE) {
    const run = await runWorkstream(id, company, documents, [...carried], dossier);
    runs.push(run);
    carried.push(...run.findings);
  }

  const gaps = runs.flatMap((r) => r.gaps);
  const prio = { high: 0, medium: 1, low: 2 } as const;
  gaps.sort((a, b) => prio[a.priority] - prio[b.priority]);

  const rank = { risk: 0, attention: 1, info: 2 } as const;
  const findings = [...carried].sort((a, b) => rank[a.severity] - rank[b.severity]);

  const risk = findings.filter((f) => f.severity === "risk").length;
  const attention = findings.filter((f) => f.severity === "attention").length;

  return {
    subject: dossier.resolved.name,
    ms: Date.now() - started,
    runs,
    findings,
    gaps,
    gates: runs.flatMap((r) =>
      r.gates.map((g) => ({ ...g, workstream: r.workstreamName })),
    ),
    summary:
      `Full review of ${dossier.resolved.name} across ${runs.length} workstreams and ` +
      `${runs.reduce((n, r) => n + r.seats.length, 0)} seats. ` +
      `${findings.length} findings (${risk} risk, ${attention} attention) and ${gaps.length} open items. ` +
      `${runs.flatMap((r) => r.gates).length} seats require sign-off before the paper is circulated.`,
  };
}

export { AGENTS, WORKSTREAMS };
