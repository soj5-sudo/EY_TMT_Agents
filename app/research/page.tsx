"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ComboChart } from "@/components/charts/ComboChart";
import { Delta, NotSet, PageHeader, Panel, Prov, Stack, StatBlock, StatRow } from "@/components/ui/Bits";
import { SourceList } from "@/components/ui/SourceList";
import type { AgentFinding, NewsItem, Provenance, Quote } from "@/lib/core/types";
import { useDocuments } from "@/lib/client/documents";
import { Compare } from "@/components/dashboards/Compare";
import { apiFetch } from "@/lib/client/api";

interface FinancialSeries {
  metric: string;
  tag: string;
  points: Array<{ period: string; label: string; value: number; form: string; filed: string }>;
}

interface Dossier {
  query: string;
  resolved: {
    name: string;
    cik: string | null;
    tickers: string[];
    exchanges: string[];
    sicDescription: string | null;
    inUniverse: { sector: string; subsector: string; themes: string[] } | null;
  };
  quote: Quote | null;
  filings: Array<{ form: string; filingDate: string; reportDate: string | null; url: string; description: string | null }>;
  financials: FinancialSeries[];
  derived: {
    revenueCagrPct: number | null;
    latestRevenueUsd: number | null;
    latestNetMarginPct: number | null;
    latestOperatingMarginPct: number | null;
    rndIntensityPct: number | null;
    years: number;
  };
  news: NewsItem[];
  findings: AgentFinding[];
  documents: Array<{ id: string; name: string; pages: number | null; characters: number; extracted: Array<{ label: string; value: string; context: string }> }>;
  sources: Provenance[];
  warnings: string[];
}

const SUGGESTIONS = ["Accenture", "NVIDIA", "Infosys", "Palantir", "T-Mobile", "Netflix"];

export default function ResearchPage() {
  const [company, setCompany] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { documents, add: addDocuments, clear: clearDocuments } = useDocuments();
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<Dossier>("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: trimmed, documents }),
        timeoutMs: 150_000,
      });
      setDossier(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, documents]);

  const upload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadNote(null);

    const form = new FormData();
    for (const f of Array.from(files).slice(0, 5)) form.append("files", f);

    try {
      const res = await fetch("/api/research/documents", { method: "POST", body: form });
      if (res.status === 413) {
        setUploadNote(
          "That file is larger than the hosted deployment accepts, which caps uploads at about 4 MB. Run the console locally for files up to 120 MB.",
        );
        return;
      }
      const json = await res.json();
      if (json.added?.length) addDocuments(json.added);
      const parts: string[] = [];
      if (json.added?.length) parts.push(`${json.added.length} added`);
      if (json.failed?.length) {
        parts.push(json.failed.map((f: { name: string; reason: string }) => `${f.name}: ${f.reason}`).join("; "));
      }
      setUploadNote(parts.join(". ") || null);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [addDocuments]);

  const clearDocs = useCallback(() => {
    clearDocuments();
    setUploadNote(null);
  }, [clearDocuments]);

  const revenue = dossier?.financials.find((f) => f.metric === "Revenue");
  const operating = dossier?.financials.find((f) => f.metric === "Operating income");

  const revenueChart =
    revenue && revenue.points.length > 1
      ? revenue.points.map((p, i) => {
          const op = operating?.points.find((o) => o.period === p.period);
          return {
            label: p.label,
            bar: p.value / 1e9,
            line: op && p.value ? (op.value / p.value) * 100 : 0,
          };
        }).filter((d) => d.line !== 0 || !operating)
      : [];

  return (
    <div className="shell">
      <PageHeader
        index="04"
        title="Company research"
        lede="Name any company. The agent resolves it against the SEC register, pulls its filing history and tagged financials, checks its market position, and reads verified coverage. Private documents can be added alongside the public record."
      />

      <Stack gap={32}>
        <Panel
          title="Subject"
          hint="Public companies resolve against the SEC register. Private companies resolve against uploaded documents and verified coverage only."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(company);
            }}
            style={{ display: "grid", gap: 16 }}
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 320px" }}>
                <label className="t-label" htmlFor="company">Company name or ticker</label>
                <input
                  id="company"
                  className="input"
                  value={company}
                  maxLength={120}
                  placeholder="Accenture"
                  onChange={(e) => setCompany(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || company.trim().length === 0}
                data-loading={busy}
              >
                {busy ? "Researching" : "Run research"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="t-label" style={{ fontSize: 10 }}>Try</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setCompany(s);
                    run(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </form>
        </Panel>

        <Compare />

        <Panel
          title="Private records"
          hint="Management accounts, data room exports, board packs, spreadsheets. Parsed in the request that carries them and returned straight to your browser. The server keeps nothing, and a refresh or tab close removes them permanently."
          actions={
            documents.length > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={clearDocs}>
                Clear {documents.length}
              </button>
            ) : undefined
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.xlsx,.xlsm,.csv,.txt,.md,.json"
                onChange={(e) => upload(e.target.files)}
                style={{ display: "none" }}
                id="docs"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                data-loading={uploading}
              >
                {uploading ? "Reading" : "Attach documents"}
              </button>
              <span className="t-small" style={{ fontSize: 12 }}>
                PDF, XLSX, CSV, TXT, MD or JSON. Up to 120 MB each locally; the
                hosted deployment accepts about 4 MB per upload.
              </span>
            </div>

            {uploadNote && (
              <div className="notice" data-kind="warning">{uploadNote}</div>
            )}

            {documents.length === 0 ? (
              <p className="t-small">No documents attached. Research will run on public records alone.</p>
            ) : (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col" className="num">Pages</th>
                      <th scope="col" className="num">Characters</th>
                      <th scope="col" className="num">Figures found</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((d: import("@/lib/client/documents").ClientDocument) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td className="num">{d.pages ?? <NotSet />}</td>
                        <td className="num">{d.characters.toLocaleString("en-US")}</td>
                        <td className="num">{d.extracted.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && !dossier && (
          <div style={{ display: "grid", gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 72 }} />
            ))}
          </div>
        )}

        {dossier && (
          <>
            {!dossier.resolved.cik && !dossier.resolved.inUniverse && (
              <div className="notice" data-kind="warning">
                <strong style={{ fontWeight: 600 }}>
                  No public record found for {dossier.query}.
                </strong>{" "}
                Verified coverage was checked{dossier.news.length > 0 ? ` and ${dossier.news.length} items surfaced` : " and nothing surfaced"}.
                If this is a private company, attach its management accounts or a
                spreadsheet above and run again: the agents read whatever the
                documents carry and work from that. Attachments are parsed in your
                browser session only and vanish on refresh.
              </div>
            )}
            {dossier.warnings.length > 0 && (
              <div className="notice" data-kind="warning">
                {dossier.warnings.map((w, i) => (
                  <p key={i} style={{ marginTop: i ? 8 : 0 }}>{w}</p>
                ))}
              </div>
            )}

            <StatRow>
              <StatBlock
                label="Subject"
                value={<span style={{ fontSize: 20 }}>{dossier.resolved.name}</span>}
                sub={dossier.resolved.sicDescription ?? "Classification not set"}
                emphasis
              />
              <StatBlock
                label="Revenue, latest year"
                value={
                  dossier.derived.latestRevenueUsd
                    ? `${(dossier.derived.latestRevenueUsd / 1e9).toFixed(2)}bn`
                    : <NotSet />
                }
                sub="USD, as tagged in the annual filing"
              />
              <StatBlock
                label={`Revenue CAGR, ${dossier.derived.years}y span`}
                value={
                  dossier.derived.revenueCagrPct !== null
                    ? <Delta value={dossier.derived.revenueCagrPct} />
                    : <NotSet />
                }
                sub="Compound annual, from filings"
              />
              <StatBlock
                label="Operating margin"
                value={
                  dossier.derived.latestOperatingMarginPct !== null
                    ? `${dossier.derived.latestOperatingMarginPct.toFixed(1)}%`
                    : <NotSet />
                }
                sub="Latest reported year"
              />
              <StatBlock
                label="R&D intensity"
                value={
                  dossier.derived.rndIntensityPct !== null
                    ? `${dossier.derived.rndIntensityPct.toFixed(1)}%`
                    : <NotSet />
                }
                sub="Research spend over revenue"
              />
            </StatRow>

            {revenueChart.length > 1 && (
              <Panel
                title="Reported revenue and operating margin"
                hint="Annual figures as tagged in the company's own filings. Where a year has been restated the most recently filed value is used."
                actions={<Prov p={dossier.sources.find((s) => s.kind === "filing") ?? dossier.sources[0]} />}
              >
                <ComboChart
                  data={revenueChart}
                  barLabel="Revenue, USD bn"
                  lineLabel="Operating margin"
                  barFormat={(v) => `${v.toFixed(0)}bn`}
                  caption={`XBRL concept ${revenue?.tag}. Source filings are listed below.`}
                />
              </Panel>
            )}

            {dossier.findings.length > 0 && (
              <Panel title="Findings" hint="Computed from the retrieved figures, ranked by severity.">
                <div style={{ display: "grid", gap: 16 }}>
                  {dossier.findings.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        borderLeft: `3px solid ${
                          f.severity === "risk"
                            ? "var(--danger)"
                            : f.severity === "attention"
                              ? "var(--accent)"
                              : "var(--border-strong)"
                        }`,
                        paddingLeft: 16,
                      }}
                    >
                      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span
                          className="t-label"
                          style={{
                            fontSize: 10,
                            color:
                              f.severity === "risk"
                                ? "var(--danger)"
                                : f.severity === "attention"
                                  ? "var(--warning)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {f.severity === "risk" ? "Risk" : f.severity === "attention" ? "Attention" : "Information"}
                        </span>
                        {f.metric && (
                          <span className="chip chip-static" style={{ height: 20, fontSize: 10 }}>
                            {f.metric.label}: {f.metric.value}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 500, marginTop: 6 }}>{f.headline}</p>
                      <p className="t-body" style={{ fontSize: 13, marginTop: 6 }}>{f.detail}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {dossier.documents.length > 0 &&
              dossier.documents.some((d) => d.extracted.length > 0) && (
                <Panel
                  title="Figures read from your documents"
                  hint="Each value is shown with the text around it, so it can be traced back to the line it came from."
                  flush
                >
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Document</th>
                          <th scope="col">Measure</th>
                          <th scope="col" className="num">Value</th>
                          <th scope="col">Context</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dossier.documents.flatMap((doc) =>
                          doc.extracted.slice(0, 14).map((f, i) => (
                            <tr key={`${doc.id}-${i}`}>
                              <td>
                                <span className="t-small" style={{ fontSize: 12 }}>
                                  {doc.name}
                                </span>
                              </td>
                              <td style={{ fontWeight: 500 }}>{f.label}</td>
                              <td className="num">{f.value}</td>
                              <td style={{ maxWidth: 420 }}>
                                <span className="t-small" style={{ fontSize: 12 }}>
                                  {f.context}
                                </span>
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

            {dossier.filings.length > 0 && (
              <Panel title="Filing history" hint="Material forms only. Ownership and insider filings are excluded." flush>
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Form</th>
                        <th scope="col">Filed</th>
                        <th scope="col">Period</th>
                        <th scope="col">Document</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dossier.filings.slice(0, 15).map((f, i) => (
                        <tr key={`${f.form}-${f.filingDate}-${i}`}>
                          <td style={{ fontWeight: 500 }}>{f.form}</td>
                          <td>{f.filingDate}</td>
                          <td>{f.reportDate ?? <NotSet />}</td>
                          <td>
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              style={{ textDecoration: "underline", textUnderlineOffset: 3 }}
                            >
                              {f.description ?? "Open on SEC EDGAR"}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            {dossier.news.length > 0 && (
              <Panel
                title="Verified coverage"
                hint="Outlets outside the publisher allowlist were discarded at ingestion."
                flush
              >
                <SourceList items={dossier.news} />
              </Panel>
            )}
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
