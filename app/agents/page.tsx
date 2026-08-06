"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, Panel, Stack } from "@/components/ui/Bits";
import { WORKSTREAMS, AGENTS, type WorkstreamId } from "@/lib/agents/registry";
import { useDocuments } from "@/lib/client/documents";
import { apiFetch } from "@/lib/client/api";

interface Finding {
  id: string;
  agentName: string;
  severity: "risk" | "attention" | "info";
  headline: string;
  detail: string;
  metric?: { label: string; value: string };
}

interface Gap {
  id: string;
  agentName: string;
  item: string;
  blocks: string;
  requestFrom: string;
  priority: "high" | "medium" | "low";
}

interface Seat {
  agentId: string;
  agentName: string;
  role: string;
  why: string;
  status: "complete" | "partial" | "blocked";
  findings: Finding[];
  gaps: Gap[];
  evidenceUsed: string[];
  evidenceMissing: string[];
  handsTo: string[];
  humanGate: boolean;
  ms: number;
}

interface Run {
  runId: string;
  workstreamName: string;
  step: string;
  subject: string;
  ms: number;
  seats: Seat[];
  findings: Finding[];
  gaps: Gap[];
  gates: Array<{ agentId: string; agentName: string; role: string }>;
  summary: string;
  subjectDetail: {
    name: string;
    cik: string | null;
    exchanges: string[];
    sicDescription: string | null;
    filings: number;
    news: number;
    documents: number;
    financials: string[];
  };
  warnings: string[];
}

const SEV_COLOR = {
  risk: "var(--danger)",
  attention: "var(--accent)",
  info: "var(--border-strong)",
} as const;

const SEV_TEXT = {
  risk: "var(--danger)",
  attention: "var(--warning)",
  info: "var(--text-muted)",
} as const;

export default function OperatingSystemPage() {
  const [company, setCompany] = useState("");
  const [active, setActive] = useState<WorkstreamId | "full">("full");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"findings" | "gaps" | "seats">("findings");
  const { documents } = useDocuments();

  const execute = useCallback(async () => {
    if (!company.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<any>("/api/workstream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workstream: active, company: company.trim(), documents }),
        timeoutMs: active === "full" ? 180_000 : 90_000,
      });
      if (json.mode === "full") {
        setRun({
          runId: "full",
          workstreamName: "Full review",
          step: "All",
          subject: json.subject,
          ms: json.ms,
          seats: json.runs.flatMap((r: { seats: Seat[] }) => r.seats),
          findings: json.findings,
          gaps: json.gaps,
          gates: json.gates,
          summary: json.summary,
          subjectDetail: json.runs[0]?.subjectDetail ?? {
            name: json.subject,
            cik: null,
            exchanges: [],
            sicDescription: null,
            filings: 0,
            news: 0,
            documents: 0,
            financials: [],
          },
          warnings: json.runs[0]?.warnings ?? [],
        });
      } else {
        setRun(json);
      }
      setView(json.findings.length > 0 ? "findings" : "gaps");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [company, active, busy, documents]);

  const activeWs = WORKSTREAMS.find((w) => w.id === active) ?? null;
  const seatsInActive = useMemo(
    () =>
      active === "full" ? AGENTS : AGENTS.filter((a) => a.workstream === active),
    [active],
  );

  return (
    <div className="shell">
      <PageHeader
        index="05"
        title="Diligence operating system"
        lede={`${AGENTS.length} agents across ten workstreams. Each holds a defined role, declares the evidence it needs, and hands to the agent after it. An agent with evidence returns a finding. An agent without it returns the document request that would close the gap, because an open item is more useful than an invented answer.`}
      />

      <Stack gap={32}>
        <Panel
          title="Run a workstream"
          hint={
            documents.length > 0
              ? `${documents.length} private document${documents.length === 1 ? "" : "s"} attached in this tab. Seats that read supplied records will use them.`
              : "Attach private documents on the Company research page to unlock the agents that read management information."
          }
        >
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 300px" }}>
                <label className="t-label" htmlFor="subject">Subject company</label>
                <input
                  id="subject"
                  className="input"
                  value={company}
                  maxLength={120}
                  placeholder="Accenture"
                  onChange={(e) => setCompany(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && execute()}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={execute}
                disabled={busy || !company.trim()}
                data-loading={busy}
              >
                {busy ? "Running" : activeWs ? `Run step ${activeWs.step}` : "Run full review"}
              </button>
            </div>

            <div>
              <p className="t-label" style={{ fontSize: 10, marginBottom: 10 }}>Workstream</p>
              <div className="ws-grid">
                <button
                  type="button"
                  className="ws-card"
                  data-active={active === "full"}
                  onClick={() => setActive("full")}
                  aria-pressed={active === "full"}
                >
                  <span className="ws-step">All</span>
                  <span className="ws-name">Full review</span>
                  <span className="ws-count">{AGENTS.filter((a) => a.workstream !== "monitoring").length} agents</span>
                </button>
                {WORKSTREAMS.map((w) => {
                  const count = AGENTS.filter((a) => a.workstream === w.id).length;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className="ws-card"
                      data-active={active === w.id}
                      onClick={() => setActive(w.id)}
                      aria-pressed={active === w.id}
                    >
                      <span className="ws-step">{w.step}</span>
                      <span className="ws-name">{w.name}</span>
                      <span className="ws-count">{count} agents</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="notice">
              {activeWs ? (
                <>
                  <strong style={{ fontWeight: 600 }}>{activeWs.name}.</strong>{" "}
                  {activeWs.purpose}{" "}
                  <em style={{ fontStyle: "normal", color: "var(--text-muted)" }}>
                    Closes when: {activeWs.closes.toLowerCase()}
                  </em>
                </>
              ) : (
                <>
                  <strong style={{ fontWeight: 600 }}>Full review.</strong> Runs
                  screening through to the committee paper in order, carrying
                  findings forward so the synthesis agents reconcile against the
                  whole case rather than one step. The record is assembled once
                  and shared, so a full pass costs one research call.{" "}
                  <em style={{ fontStyle: "normal", color: "var(--text-muted)" }}>
                    Monitoring runs separately, after close.
                  </em>
                </>
              )}
            </div>
          </div>
        </Panel>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && (
          <div style={{ display: "grid", gap: 10 }}>
            {seatsInActive.map((s) => (
              <div key={s.id} className="skel" style={{ height: 54 }} />
            ))}
          </div>
        )}

        {run && !busy && (
          <>
            <Panel title={`Step ${run.step} · ${run.workstreamName}`} hint={run.summary}>
              <div className="run-stats">
                <div>
                  <span className="t-label" style={{ fontSize: 10 }}>Subject</span>
                  <p style={{ fontSize: 15, marginTop: 4 }}>{run.subjectDetail.name}</p>
                  <p className="t-small" style={{ fontSize: 11 }}>
                    {run.subjectDetail.sicDescription ?? "Classification not set"}
                    {run.subjectDetail.cik ? ` · CIK ${run.subjectDetail.cik}` : ""}
                  </p>
                </div>
                <div>
                  <span className="t-label" style={{ fontSize: 10 }}>Evidence base</span>
                  <p className="t-small" style={{ fontSize: 12, marginTop: 6 }}>
                    {run.subjectDetail.filings} filings · {run.subjectDetail.financials.length} financial series ·{" "}
                    {run.subjectDetail.news} verified items · {run.subjectDetail.documents} supplied documents
                  </p>
                </div>
                <div>
                  <span className="t-label" style={{ fontSize: 10 }}>Human gates</span>
                  <p className="t-small" style={{ fontSize: 12, marginTop: 6 }}>
                    {run.gates.length === 0
                      ? "No sign-off required in this workstream"
                      : run.gates.map((g) => g.agentName).join(", ")}
                  </p>
                </div>
              </div>

              {run.warnings.length > 0 && (
                <div className="notice" data-kind="warning" style={{ marginTop: 18 }}>
                  {run.warnings.map((w, i) => (
                    <p key={i} style={{ marginTop: i ? 6 : 0 }}>{w}</p>
                  ))}
                </div>
              )}
            </Panel>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([
                ["findings", `Findings (${run.findings.length})`],
                ["gaps", `Open items (${run.gaps.length})`],
                ["seats", `Agents (${run.seats.length})`],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  data-active={view === k}
                  onClick={() => setView(k)}
                  aria-pressed={view === k}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "findings" && (
              <Panel title="Findings" hint="Computed from the assembled record. Each carries the agent that produced it.">
                {run.findings.length === 0 ? (
                  <div className="empty">
                    <p className="empty-title">No findings in this workstream</p>
                    <p className="empty-body">
                      Every agent here is blocked on evidence. Review the open items for the documents that would unblock them.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 16 }}>
                    {run.findings.map((f) => (
                      <div key={f.id} style={{ borderLeft: `3px solid ${SEV_COLOR[f.severity]}`, paddingLeft: 16 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                          <span className="t-label" style={{ fontSize: 10, color: SEV_TEXT[f.severity] }}>
                            {f.severity === "risk" ? "Risk" : f.severity === "attention" ? "Attention" : "Information"}
                          </span>
                          <span className="chip chip-static" style={{ height: 19, fontSize: 10 }}>{f.agentName}</span>
                          {f.metric && (
                            <span className="chip chip-static" style={{ height: 19, fontSize: 10 }}>
                              {f.metric.label}: {f.metric.value}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 14, fontWeight: 500, marginTop: 6 }}>{f.headline}</p>
                        <p className="t-body" style={{ fontSize: 13, marginTop: 6 }}>{f.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {view === "gaps" && (
              <Panel
                title="Open items"
                hint="The document request list this run generates. Each item names what is missing, what it blocks and who holds it."
                flush
              >
                {run.gaps.length === 0 ? (
                  <div className="empty">
                    <p className="empty-title">No open items</p>
                    <p className="empty-body">Every agent in this workstream had the evidence it needs.</p>
                  </div>
                ) : (
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Priority</th>
                          <th scope="col">Item</th>
                          <th scope="col">Blocks</th>
                          <th scope="col">Request from</th>
                          <th scope="col">Agent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.gaps.map((g) => (
                          <tr key={g.id}>
                            <td>
                              <span
                                className="t-label"
                                style={{
                                  fontSize: 10,
                                  color: g.priority === "high" ? "var(--danger)" : "var(--text-muted)",
                                }}
                              >
                                {g.priority}
                              </span>
                            </td>
                            <td style={{ fontWeight: 500 }}>{g.item}</td>
                            <td style={{ maxWidth: 380 }}>
                              <span className="t-small" style={{ fontSize: 12 }}>{g.blocks}</span>
                            </td>
                            <td>
                              <span className="t-small" style={{ fontSize: 12 }}>{g.requestFrom}</span>
                            </td>
                            <td>
                              <span className="t-small" style={{ fontSize: 12 }}>{g.agentName}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}

            {view === "seats" && (
              <Panel title="Agents" hint="Every agent in the workstream, what it holds, and where it hands off.">
                <div style={{ display: "grid", gap: 0 }}>
                  {run.seats.map((seat) => (
                    <div key={seat.agentId} className="seat-row">
                      <div className="seat-head">
                        <span className="seat-name">{seat.agentName}</span>
                        <span className="seat-status" data-status={seat.status}>{seat.status}</span>
                        {seat.humanGate && <span className="seat-gate">Sign-off required</span>}
                        <span className="seat-spacer" />
                        <span className="t-small" style={{ fontSize: 11 }}>
                          {seat.findings.length} findings · {seat.gaps.length} open
                        </span>
                      </div>
                      <p className="seat-role">{seat.role}</p>
                      <p className="seat-why">{seat.why}</p>
                      {seat.handsTo.length > 0 && (
                        <p className="t-small" style={{ fontSize: 11, marginTop: 6 }}>
                          Hands to: {seat.handsTo.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}

        {!run && !busy && (
          <Panel
            title="The full roster"
            hint={`${AGENTS.length} agents. Select a workstream above to run one, or read what each agent is for.`}
          >
            <div style={{ display: "grid", gap: 28 }}>
              {WORKSTREAMS.map((w) => (
                <div key={w.id}>
                  <div className="roster-head">
                    <span className="t-label" style={{ fontSize: 10 }}>Step {w.step}</span>
                    <span className="roster-name">{w.name}</span>
                  </div>
                  <div className="roster-grid">
                    {AGENTS.filter((a) => a.workstream === w.id).map((a) => (
                      <div key={a.id} className="roster-seat">
                        <span className="roster-seat-name">
                          {a.name}
                          {a.humanGate && <span className="roster-gate" title="Requires sign-off" />}
                        </span>
                        <span className="roster-seat-role">{a.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
