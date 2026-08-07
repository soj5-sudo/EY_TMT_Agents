"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Donut } from "@/components/charts/Donut";
import { Panel, Prov } from "@/components/ui/Bits";
import { apiFetch } from "@/lib/client/api";
import type { Provenance } from "@/lib/core/types";

interface Company {
  name: string;
  state: string;
  city: string;
  vertical: string;
  revenueUsdM: number | null;
  operatingMarginPct: number | null;
  headcount: number | null;
  period: string | null;
  origin: "filing" | "tracker" | "workbook";
}

interface StateRow {
  state: string;
  companies: number;
  revenueUsdM: number;
  cities: string[];
  names: string[];
}

interface Payload {
  vertical: string;
  states: StateRow[];
  companies: Company[];
  totals: { companies: number; states: number; revenueUsdM: number; filed: number };
  verticals: string[];
  note: string;
  provenance: Provenance;
}

const ORIGIN: Record<Company["origin"], string> = {
  filing: "Its own filing",
  tracker: "Quarterly tracker",
  workbook: "Peer workbook",
};

function bn(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}bn`;
  return `$${v.toFixed(0)}m`;
}

export function IndiaMap() {
  const [data, setData] = useState<Payload | null>(null);
  const [vertical, setVertical] = useState("all");
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (v: string) => {
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<Payload>(`/api/india?vertical=${encodeURIComponent(v)}`, {
        timeoutMs: 290_000,
      });
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(vertical);
  }, [vertical, load]);

  const shown = useMemo(
    () => (data ? data.companies.filter((c) => state === null || c.state === state) : []),
    [data, state],
  );

  const slices = useMemo(
    () => (data ? data.states.map((s) => ({ label: s.state, value: s.revenueUsdM })) : []),
    [data],
  );

  const maxRevenue = data?.states[0]?.revenueUsdM ?? 1;

  return (
    <Panel
      title="India by state"
      hint="Where the Indian coverage sits, and what each state carries. Select a state for its companies."
      actions={data && <Prov p={data.provenance} />}
    >
      <div style={{ display: "grid", gap: 18 }}>
        <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
          <div className="filter-row">
            <span className="t-label filter-row-label">Vertical</span>
            <div className="filter-row-chips">
              <button
                type="button"
                className="chip"
                data-active={vertical === "all"}
                aria-pressed={vertical === "all"}
                onClick={() => {
                  setVertical("all");
                  setState(null);
                }}
              >
                All
              </button>
              {(data?.verticals ?? []).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip"
                  data-active={vertical === v}
                  aria-pressed={vertical === v}
                  onClick={() => {
                    setVertical(v);
                    setState(null);
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {data && data.states.length > 0 && (
            <div className="filter-row">
              <span className="t-label filter-row-label">State</span>
              <div className="filter-row-chips">
                <button
                  type="button"
                  className="chip"
                  data-active={state === null}
                  aria-pressed={state === null}
                  onClick={() => setState(null)}
                >
                  All
                </button>
                {data.states.map((s) => (
                  <button
                    key={s.state}
                    type="button"
                    className="chip"
                    data-active={state === s.state}
                    aria-pressed={state === s.state}
                    onClick={() => setState(state === s.state ? null : s.state)}
                  >
                    {s.state}
                    <span className="chip-count">{s.companies}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <div className="notice" data-kind="error">{error}</div>}
        {busy && !data && <p className="t-small">Reading the Indian coverage.</p>}

        {data && (
          <>
            <div
              style={{
                display: "grid",
                gap: 24,
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              }}
            >
              <div>
                <span className="t-label" style={{ fontSize: 10 }}>Revenue by state</span>
                <div style={{ marginTop: 10 }}>
                  {data.states.map((s) => (
                    <button
                      key={s.state}
                      type="button"
                      className="st-row"
                      data-active={state === s.state}
                      onClick={() => setState(state === s.state ? null : s.state)}
                    >
                      <span className="st-name">{s.state}</span>
                      <span className="st-track">
                        <span
                          className="st-fill"
                          data-active={state === s.state}
                          style={{ width: `${(s.revenueUsdM / maxRevenue) * 100}%` }}
                        />
                      </span>
                      <span className="st-val tnum">{bn(s.revenueUsdM)}</span>
                      <span className="st-count">{s.companies}</span>
                    </button>
                  ))}
                </div>
                <p className="t-small" style={{ margin: "10px 0 0", fontSize: 11 }}>
                  {data.totals.companies} companies, {data.totals.states} states,{" "}
                  {bn(data.totals.revenueUsdM)} of revenue. {data.totals.filed} carry figures computed
                  from their own filed or published documents on this request.
                </p>
              </div>

              <Donut
                slices={slices}
                total={data.totals.revenueUsdM}
                totalLabel="India revenue"
                format={(v) => bn(v)}
                caption="Revenue by state of registered office. Selecting a slice is the same as selecting the state."
              />
            </div>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>City</th>
                    <th>State</th>
                    <th>Vertical</th>
                    <th className="num">Revenue</th>
                    <th className="num">Margin</th>
                    <th className="num">Headcount</th>
                    <th>Period</th>
                    <th>Read from</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.name}>
                      <td>
                        {c.name}
                        {c.origin === "filing" && <span className="st-live">filed</span>}
                      </td>
                      <td>{c.city}</td>
                      <td>{c.state}</td>
                      <td className="t-small">{c.vertical}</td>
                      <td className="num tnum">
                        {c.revenueUsdM === null ? (
                          <span className="t-small">Not reported</span>
                        ) : (
                          bn(c.revenueUsdM)
                        )}
                      </td>
                      <td className="num tnum">
                        {c.operatingMarginPct === null ? (
                          <span className="t-small">Not reported</span>
                        ) : (
                          `${c.operatingMarginPct.toFixed(1)}%`
                        )}
                      </td>
                      <td className="num tnum">
                        {c.headcount === null ? (
                          <span className="t-small">Not reported</span>
                        ) : (
                          Math.round(c.headcount).toLocaleString("en-US")
                        )}
                      </td>
                      <td className="t-small">{c.period ?? "Not stated"}</td>
                      <td className="t-small">{ORIGIN[c.origin]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="t-small" style={{ margin: 0, fontSize: 12 }}>{data.note}</p>
          </>
        )}
      </div>
    </Panel>
  );
}
