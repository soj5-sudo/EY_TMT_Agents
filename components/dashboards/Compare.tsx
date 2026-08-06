"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { Panel, Prov } from "@/components/ui/Bits";
import { UNIVERSE } from "@/lib/data/universe";
import type { Provenance } from "@/lib/core/types";

/**
 * Side by side comparison.
 *
 * Two names on one measure is the question a reader asks constantly, and the
 * alternative is running the research flow twice and reading two pages against
 * each other, which is where transcription errors enter a paper.
 *
 * The period is printed against every figure rather than once at the top,
 * because two companies rarely report to the same date and a comparison that
 * hides that reads as like for like when it is not.
 */

interface Series {
  key: string;
  label: string;
  unit: string;
  betterHigh: boolean | null;
  points: Array<{ label: string; value: number }>;
  latest: number | null;
  period: string | null;
}

interface CompareCompany {
  symbol: string;
  name: string;
  short: string;
  sector: string;
  subsector: string;
  region: string;
  themes: string[];
  measures: Series[];
  provenance: Provenance | null;
  unavailable: string | null;
}

interface Payload {
  companies: CompareCompany[];
  rows: Array<{ key: string; label: string; unit: string; betterHigh: boolean | null }>;
  unresolved: string[];
  note: string;
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

/** A compact run of the series, so the level is read with its direction. */
function Spark({ points, unit }: { points: Array<{ value: number }>; unit: string }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 64;
  const h = 18;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const rising = values[values.length - 1] >= values[0];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-label={`${points.length} periods, ${rising ? "rising" : "falling"}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <path
        d={d}
        fill="none"
        stroke={rising ? "var(--positive, #1a7f5a)" : "var(--negative, #b3261e)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={unit === "count" ? 0.7 : 1}
      />
    </svg>
  );
}

const TRACKED = UNIVERSE.map((c) => c.short).sort((a, b) => a.localeCompare(b));

export function Compare() {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return TRACKED.filter(
      (n) => n.toLowerCase().includes(q) && !picked.includes(n),
    ).slice(0, 8);
  }, [query, picked]);

  const add = useCallback((name: string) => {
    setPicked((prev) => (prev.includes(name) || prev.length >= 6 ? prev : [...prev, name]));
    setQuery("");
  }, []);

  const run = useCallback(async () => {
    if (picked.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<Payload>(
        `/api/compare?companies=${encodeURIComponent(picked.join(","))}`,
        { timeoutMs: 290_000 },
      );
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [picked]);

  return (
    <Panel
      title="Compare companies"
      hint="Two or more tracked names on every measure the console can compute, from the same ledger and on the same basis."
      actions={
        data?.companies.find((c) => c.provenance)?.provenance ? (
          <Prov p={data.companies.find((c) => c.provenance)!.provenance!} />
        ) : undefined
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 280px", position: "relative" }}>
            <label className="t-label" htmlFor="cmp">Add a company</label>
            <input
              id="cmp"
              className="input"
              value={query}
              maxLength={80}
              placeholder="Accenture"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && suggestions.length > 0) {
                  e.preventDefault();
                  add(suggestions[0]);
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="cmp-suggest">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="cmp-suggest-item" onClick={() => add(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
            disabled={busy || picked.length < 2}
            data-loading={busy}
          >
            {busy ? "Comparing" : "Compare"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", minHeight: 30 }}>
          {picked.length === 0 && (
            <span className="t-small" style={{ fontSize: 12 }}>
              Pick at least two names. Up to six.
            </span>
          )}
          {picked.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              data-active="true"
              onClick={() => setPicked((prev) => prev.filter((x) => x !== p))}
              aria-label={`Remove ${p}`}
            >
              {p} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {data && data.unresolved.length > 0 && (
          <div className="notice" data-kind="warning">
            Not in the coverage universe: {data.unresolved.join(", ")}
          </div>
        )}

        {data && data.companies.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="table cmp-table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    {data.companies.map((c) => (
                      <th key={c.symbol} className="num">
                        <span style={{ display: "block" }}>{c.short}</span>
                        <span className="t-small" style={{ fontSize: 10, fontWeight: 400 }}>
                          {c.subsector}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const cells = data.companies.map((c) =>
                      c.measures.find((m) => m.key === row.key),
                    );
                    const values = cells
                      .map((m) => m?.latest)
                      .filter((v): v is number => v !== null && v !== undefined);
                    // The leader is only marked where the direction is a
                    // judgement. Research intensity has no better side.
                    const best =
                      row.betterHigh === null || values.length < 2
                        ? null
                        : row.betterHigh
                          ? Math.max(...values)
                          : Math.min(...values);

                    return (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        {cells.map((m, i) => (
                          <td key={data.companies[i].symbol} className="num">
                            {m ? (
                              <span className="cmp-cell">
                                <span
                                  className="cmp-value tnum"
                                  data-best={best !== null && m.latest === best}
                                >
                                  {fmt(m.latest, row.unit)}
                                </span>
                                <span className="cmp-period t-small">{m.period}</span>
                                <Spark points={m.points} unit={row.unit} />
                              </span>
                            ) : (
                              <span className="t-small">Not reported</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data.companies.some((c) => c.unavailable) && (
              <div style={{ display: "grid", gap: 8 }}>
                {data.companies
                  .filter((c) => c.unavailable)
                  .map((c) => (
                    <div key={c.symbol} className="notice" data-kind="warning">
                      <strong>{c.short}</strong> {c.unavailable}
                    </div>
                  ))}
              </div>
            )}

            <p className="t-small" style={{ fontSize: 12, margin: 0 }}>
              {data.note}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
