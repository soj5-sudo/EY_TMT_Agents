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
import { SEATS, scopeReport } from "@/lib/agents/analysis";

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
  item: string;
  blocks: string;
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
  gates: Array<{ agentId: string; agentName: string; role: string }>;
  summary: string;
  dossier: CompanyDossier;
}

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

const HOLDER: Record<EvidenceKind, string> = {
  "public-filings": "Public register. Available for registrants only.",
  "market-data": "Market data feed. Listed subjects only.",
  "verified-news": "Verified publisher set.",
  "provided-documents": "Company or vendor data room.",
  "prior-findings": "Earlier workstream in this run.",
};

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

function runDefaultSeat(agent: AgentDef, available: Set<EvidenceKind>, e: Emitter): void {
  const missing = agent.needs.filter((n) => !available.has(n));

  if (missing.length === 0) {
    e.find(
      "info",
      `${agent.name} has its evidence base but no automated test`,
      `${agent.role}. The evidence this agent requires is present. Its assessment is judgement work that is recorded here rather than computed, and is owned by the reviewer.`,
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

export async function runWorkstream(
  workstreamId: WorkstreamId,
  company: string,
  documents: IngestedDocument[] = [],
  carried: Finding[] = [],
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

    if (emitter.findings.length === 0) {
      scopeReport(agent.id, agent.name, dossier, emitter);
    }

    if (emitter.gaps.length === 0 && emitter.findings.length === 0) {
      emitter.gap(
        `${agent.name} produced no output on this run`,
        "The agent ran without error but returned neither a finding nor a request. This is a defect in the console rather than an absence of evidence.",
        "Report the subject and workstream so the seat can be corrected",
        "high",
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
      `${ws.name} ran ${seats.length} agents against ${dossier.resolved.name}. ` +
      `${produced.length} findings (${risk} risk, ${attention} attention) and ${allGaps.length} open items. ` +
      (blocked
        ? `${blocked} agents are blocked pending evidence. `
        : "Every agent had its evidence base. ") +
      `Closes when: ${ws.closes.toLowerCase()}`,
    dossier,
  };
}

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
      `${runs.reduce((n, r) => n + r.seats.length, 0)} agents. ` +
      `${findings.length} findings (${risk} risk, ${attention} attention) and ${gaps.length} open items. ` +
      `${runs.flatMap((r) => r.gates).length} agents require sign-off before the paper is circulated.`,
  };
}

export { AGENTS, WORKSTREAMS };
