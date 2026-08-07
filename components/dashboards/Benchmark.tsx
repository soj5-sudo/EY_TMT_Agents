"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { NotSet, Panel, Prov } from "@/components/ui/Bits";
import { REGIONS, UNIVERSE } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";

interface Measure {
  key: string;
  label: string;
  unit: string;
  betterHigh: boolean | null;
  subject: number | null;
  period: string | null;
  points: Array<{ label: string; value: number }>;
  cohortMedian: number | null;
  best: { short: string; value: number } | null;
  worst: { short: string; value: number } | null;
  rank: number | null;
  ranked: number;
  percentile: number | null;
  cohort: Array<{ short: string; value: number; isSubject: boolean }>;
}

interface Payload {
  subject: {
    symbol: string;
    name: string;
    short: string;
    sector: string;
    subsector: string;
    region: string;
    themes: string[];
  };
  scope: string;
  region: string;
  cohortNames: string[];
  cohortSize: number;
  withData: number;
  measures: Measure[];
  standing: { ranked: number; leads: string[]; strong: string[]; weak: string[] };
  provenance: Provenance;
}

function fmt(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "Not reported";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(0)} days`;
  if (unit === "count") return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const a = Math.abs(value);
  if (a >= 1e12) return `${(value / 1e12).toFixed(2)}tn`;
  if (a >= 1e9) return `${(value / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function Distribution({ m }: { m: Measure }) {
  if (m.cohort.length < 2) return null;
  const values = m.cohort.map((c) => c.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const at = (v: number) => ((v - min) / span) * 100;

  return (
    <div className="bm-strip" role="img" aria-label={`${m.label}, ${m.cohort.length} companies`}>
      <span className="bm-axis" />
      {m.cohortMedian !== null && (
        <span
          className="bm-median"
          style={{ left: `${at(m.cohortMedian)}%` }}
          title={`Cohort median ${fmt(m.cohortMedian, m.unit)}`}
        />
      )}
      {m.cohort.map((c) => (
        <span
          key={c.short}
          className="bm-dot"
          data-subject={c.isSubject}
          style={{ left: `${at(c.value)}%` }}
          title={`${c.short} ${fmt(c.value, m.unit)}`}
        />
      ))}
    </div>
  );
}

const TRACKED = UNIVERSE.map((c) => c.short).sort((a, b) => a.localeCompare(b));

export function Benchmark() {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"subsector" | "sector">("subsector");
  const [region, setRegion] = useState("All");
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length === 0) return [];
    return TRACKED.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  }, [name]);

  const run = useCallback(
    async (who: string, sc = scope, rg = region) => {
      const target = who.trim();
      if (target.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const json = await apiFetch<Payload>(
          `/api/benchmark?company=${encodeURIComponent(target)}&scope=${sc}&region=${encodeURIComponent(rg)}`,
          { timeoutMs: 290_000 },
        );
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      } finally {
        setBusy(false);
      }
    },
    [scope, region],
  );

  return (
    <Panel
      title="Where they stand"
      hint="One company against a named peer cohort on every measure the console can compute. The comparison set is stated so it can be argued with."
      actions={data && <Prov p={data.provenance} />}
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 260px", position: "relative" }}>
            <label className="t-label" htmlFor="bm">Company</label>
            <input
              id="bm"
              className="input"
              value={name}
              maxLength={80}
              placeholder="TCS"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = suggestions[0] ?? name;
                  setName(pick);
                  run(pick);
                }
              }}
            />
            {suggestions.length > 0 && name.trim() !== suggestions[0] && (
              <div className="cmp-suggest">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="cmp-suggest-item"
                    onClick={() => {
                      setName(s);
                      run(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => run(name)}
            disabled={busy || name.trim().length === 0}
            data-loading={busy}
          >
            {busy ? "Positioning" : "Position"}
          </button>
        </div>

        <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
          <div className="filter-row">
            <span className="t-label filter-row-label">Cohort</span>
            <div className="filter-row-chips">
              {(["subsector", "sector"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  data-active={scope === s}
                  aria-pressed={scope === s}
                  onClick={() => {
                    setScope(s);
                    if (data) run(data.subject.short, s, region);
                  }}
                >
                  {s === "subsector" ? "Same segment" : "Whole sector"}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="t-label filter-row-label">Region</span>
            <div className="filter-row-chips">
              {["All", ...REGIONS].map((rg) => (
                <button
                  key={rg}
                  type="button"
                  className="chip"
                  data-active={region === rg}
                  aria-pressed={region === rg}
                  onClick={() => {
                    setRegion(rg);
                    if (data) run(data.subject.short, scope, rg);
                  }}
                >
                  {rg}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {data && (
          <>
            <div className="bm-head">
              <div>
                <span className="t-label" style={{ fontSize: 10 }}>Subject</span>
                <p className="bm-subject">{data.subject.name}</p>
                <p className="t-small" style={{ margin: 0 }}>
                  {data.subject.subsector}, listed in {data.subject.region}
                </p>
              </div>
              <div>
                <span className="t-label" style={{ fontSize: 10 }}>
                  Cohort, {data.withData} of {data.cohortSize} reporting
                </span>
                <p className="bm-cohort">{data.cohortNames.join(", ")}</p>
              </div>
            </div>

            {data.standing.ranked > 0 && (
              <div className="bm-standing">
                {data.standing.leads.length > 0 && (
                  <p>
                    <strong>Leads the cohort on</strong> {data.standing.leads.join(", ")}.
                  </p>
                )}
                {data.standing.strong.length > 0 && (
                  <p>
                    <strong>Top quartile on</strong> {data.standing.strong.join(", ")}.
                  </p>
                )}
                {data.standing.weak.length > 0 && (
                  <p>
                    <strong>Bottom quartile on</strong> {data.standing.weak.join(", ")}.
                  </p>
                )}
                {data.standing.leads.length === 0 &&
                  data.standing.strong.length === 0 &&
                  data.standing.weak.length === 0 && (
                    <p>Mid cohort on every measure with a comparable set.</p>
                  )}
              </div>
            )}

            <div className="table-scroll">
              <table className="table bm-table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th className="num">{data.subject.short}</th>
                    <th className="num">Cohort median</th>
                    <th className="num">Rank</th>
                    <th>Position in cohort</th>
                    <th className="num">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {data.measures
                    .filter((m) => m.subject !== null || m.cohort.length > 0)
                    .map((m) => (
                      <tr key={m.key}>
                        <td>
                          {m.label}
                          {m.period && <span className="cmp-period"> {m.period}</span>}
                        </td>
                        <td className="num">
                          <span className="tnum" data-best={m.rank === 1}>
                            {fmt(m.subject, m.unit)}
                          </span>
                        </td>
                        <td className="num tnum">{fmt(m.cohortMedian, m.unit)}</td>
                        <td className="num tnum">
                          {m.rank !== null ? (
                            <>
                              {m.rank} of {m.ranked}
                            </>
                          ) : (
                            <span className="t-small">
                              {m.betterHigh === null ? "No better side" : "Too few reporting"}
                            </span>
                          )}
                        </td>
                        <td style={{ minWidth: 160 }}>
                          <Distribution m={m} />
                        </td>
                        <td className="num">
                          {m.best ? (
                            <span className="t-small">
                              {m.best.short} {fmt(m.best.value, m.unit)}
                            </span>
                          ) : (
                            <NotSet />
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p className="t-small" style={{ fontSize: 12, margin: 0 }}>
              {data.provenance.note}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
