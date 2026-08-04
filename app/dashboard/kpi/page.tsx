"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComboChart } from "@/components/charts/ComboChart";
import { ScatterQuadrant } from "@/components/charts/Scatter";
import { CompanyPicker } from "@/components/ui/CompanyPicker";
import {
  Delta,
  NotSet,
  PageHeader,
  Panel,
  Prov,
  Stack,
  StatBlock,
  StatRow,
} from "@/components/ui/Bits";
import type { Provenance } from "@/lib/core/types";
import { apiFetch } from "@/lib/client/api";

interface Ratio {
  label: string;
  value: number | null;
  unit: string;
  reading: string;
}

interface Financials {
  company: { name: string; cik: string; ticker: string; subsector: string | null };
  latestFy: string | null;
  years: Array<{ label: string; end: string; values: Record<string, number | null> }>;
  ratios: { period: string | null; ratios: Ratio[] };
  provenance: Provenance;
}

interface PeerRow {
  symbol: string;
  short: string;
  name: string;
  period: string | null;
  isSubject: boolean;
  revenue: number | null;
  ratios: Record<string, number | null>;
  unavailable?: boolean;
}

interface Peers {
  subject: { symbol: string; short: string; subsector: string };
  cohort: PeerRow[];
  provenance: Provenance;
}

const BENCH = ["Gross margin", "Operating margin", "Net margin", "Research intensity", "Cash conversion", "Return on equity"];

function bn(v: number | null): string {
  if (v === null) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}m`;
  return v.toLocaleString("en-US");
}

export default function KpiPage() {
  const [symbol, setSymbol] = useState("ACN");
  const [fin, setFin] = useState<Financials | null>(null);
  const [peers, setPeers] = useState<Peers | null>(null);
  const [busy, setBusy] = useState(true);
  const [peersBusy, setPeersBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sym: string) => {
    setBusy(true);
    setError(null);
    setPeers(null);
    try {
      const json = await apiFetch<Financials>(
        `/api/financials?company=${encodeURIComponent(sym)}`,
        { timeoutMs: 90_000 },
      );
      setFin(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFin(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadPeers = useCallback(async (sym: string) => {
    setPeersBusy(true);
    try {
      const json = await apiFetch<Peers>(
        `/api/peers?company=${encodeURIComponent(sym)}`,
        { timeoutMs: 180_000 },
      );
      setPeers(json);
    } catch {
      // Benchmarking is additive. Its absence does not block the page.
    } finally {
      setPeersBusy(false);
    }
  }, []);

  useEffect(() => {
    load(symbol);
  }, [symbol, load]);

  const years = fin?.years ?? [];

  const marginTrend = useMemo(
    () =>
      years
        .filter((y) => y.values.revenue !== null && y.values.operatingIncome !== null)
        .map((y) => ({
          label: y.label.replace("FY", ""),
          bar: (y.values.revenue ?? 0) / 1e9,
          line: ((y.values.operatingIncome ?? 0) / (y.values.revenue ?? 1)) * 100,
        })),
    [years],
  );

  const investTrend = useMemo(
    () =>
      years
        .filter((y) => y.values.revenue !== null && y.values.rnd !== null)
        .map((y) => ({
          label: y.label.replace("FY", ""),
          bar: (y.values.rnd ?? 0) / 1e9,
          line: ((y.values.rnd ?? 0) / (y.values.revenue ?? 1)) * 100,
        })),
    [years],
  );

  const scatter = useMemo(() => {
    if (!peers) return [];
    return peers.cohort
      .filter((p) => !p.unavailable && p.revenue && p.ratios["Operating margin"] !== null)
      .map((p) => ({
        label: p.short,
        share: p.revenue! / 1e9,
        growth: p.ratios["Operating margin"]!,
      }));
  }, [peers]);

  const ratio = (label: string) => fin?.ratios.ratios.find((r) => r.label === label);

  return (
    <div className="shell">
      <PageHeader
        index="03"
        title="KPI detail"
        lede="Unit economics and capital efficiency for any company in the universe, computed from filed statements and benchmarked against its own subsector. Every measure is derived only where the numerator and denominator cover the same reporting period."
        meta={fin && <Prov p={fin.provenance} />}
      />

      <Stack gap={32}>
        <Panel title="Subject" hint="Benchmarks compare like with like: the cohort is the subsector, not the whole sector.">
          <CompanyPicker value={symbol} onChange={setSymbol} />
        </Panel>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skel" style={{ height: 96 }} />
            <div className="skel" style={{ height: 260 }} />
          </div>
        )}

        {fin && !busy && (
          <>
            <StatRow>
              <StatBlock
                label={`Revenue, ${fin.ratios.period ?? "latest"}`}
                value={bn(years.at(-1)?.values.revenue ?? null) || <NotSet />}
                sub={`USD · ${fin.company.name}`}
                emphasis
              />
              {["Operating margin", "Net margin", "Cash conversion", "Return on equity"].map((label) => {
                const r = ratio(label);
                return (
                  <StatBlock
                    key={label}
                    label={label}
                    value={r?.value != null ? `${r.value.toFixed(1)}%` : <NotSet />}
                    sub={r?.reading ?? "Not reported"}
                  />
                );
              })}
            </StatRow>

            <Panel
              title="Quality measures"
              hint="Each measure with a plain reading of what it indicates. Bands are sector conventions, not thresholds from a model."
              actions={<Prov p={fin.provenance} />}
              flush
            >
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col" className="num">Value</th>
                      <th scope="col">Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fin.ratios.ratios.map((r) => (
                      <tr key={r.label}>
                        <th scope="row" className="tbl-rowhead">{r.label}</th>
                        <td className="num" style={{ fontWeight: 500 }}>
                          {r.value === null ? (
                            <NotSet />
                          ) : (
                            `${r.value.toFixed(1)}${r.unit === "days" ? " days" : r.unit}`
                          )}
                        </td>
                        <td>
                          <span className="t-small" style={{ fontSize: 12.5 }}>{r.reading}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {marginTrend.length > 1 && (
              <Panel
                title="Revenue and operating margin by year"
                hint="Annual figures as filed. The line shows whether scale is translating into margin."
                actions={<Prov p={fin.provenance} />}
              >
                <ComboChart
                  data={marginTrend}
                  barLabel="Revenue, USD bn"
                  lineLabel="Operating margin"
                  barFormat={(v) => `${v.toFixed(0)}bn`}
                  caption="Where a year has been restated, the most recently filed value is used."
                />
              </Panel>
            )}

            {investTrend.length > 1 && (
              <Panel
                title="Research spend and intensity"
                hint="Absolute investment against its share of revenue. Rising spend with falling intensity means revenue is outgrowing investment."
                actions={<Prov p={fin.provenance} />}
              >
                <ComboChart
                  data={investTrend}
                  barLabel="R&D, USD bn"
                  lineLabel="Percent of revenue"
                  barFormat={(v) => `${v.toFixed(1)}bn`}
                  caption="Filers that do not tag research spend separately are absent from this view."
                />
              </Panel>
            )}

            <Panel
              title={`Subsector benchmark${peers ? `: ${peers.subject.subsector}` : ""}`}
              hint="The same measures across the cohort, from the same source and the same tagging rules."
              actions={
                peers ? (
                  <Prov p={peers.provenance} />
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loadPeers(symbol)}
                    disabled={peersBusy}
                    data-loading={peersBusy}
                    style={{ minHeight: 32, padding: "6px 14px" }}
                  >
                    {peersBusy ? "Loading cohort" : "Load benchmark"}
                  </button>
                )
              }
              flush
            >
              {!peers && !peersBusy && (
                <div className="empty">
                  <p className="empty-title">Benchmark not loaded</p>
                  <p className="empty-body">
                    Loading the cohort makes one filing request per peer, so it is opt-in
                    rather than automatic.
                  </p>
                </div>
              )}
              {peersBusy && (
                <div style={{ padding: 24, display: "grid", gap: 8 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skel" style={{ height: 30 }} />
                  ))}
                </div>
              )}
              {peers && (
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Company</th>
                        <th scope="col" className="num">Revenue</th>
                        {BENCH.map((b) => (
                          <th key={b} scope="col" className="num">{b.replace(" margin", "")}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {peers.cohort.map((p) => (
                        <tr key={p.symbol} style={p.isSubject ? { background: "var(--ey-off-white)" } : undefined}>
                          <th scope="row" className="tbl-rowhead" style={{ fontWeight: p.isSubject ? 600 : 400 }}>
                            {p.short}
                            {p.isSubject && (
                              <span className="t-label" style={{ fontSize: 9, marginLeft: 8 }}>subject</span>
                            )}
                          </th>
                          <td className="num">{p.revenue === null ? <NotSet /> : bn(p.revenue)}</td>
                          {BENCH.map((b) => (
                            <td key={b} className="num">
                              {p.ratios[b] == null ? <NotSet /> : `${p.ratios[b]!.toFixed(1)}%`}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {scatter.length > 2 && (
              <Panel
                title="Scale against profitability"
                hint="Each circle is a peer. Revenue on the horizontal, operating margin on the vertical. The yellow line is the cohort's revenue-weighted margin."
                actions={peers && <Prov p={peers.provenance} />}
              >
                <ScatterQuadrant
                  points={scatter}
                  xLabel="Revenue, USD bn"
                  yLabel="Operating margin, percent"
                  caption="Names above the line earn more per unit of revenue than the cohort average. Position is not a judgement: a lower margin at greater scale can be the better business."
                />
              </Panel>
            )}
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
