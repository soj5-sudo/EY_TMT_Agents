"use client";

import { useState } from "react";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { Panel } from "@/components/ui/Bits";
import {
  HEADCOUNT_YOY,
  HISTORY,
  HISTORY_SOURCE,
  MARGIN_MATRIX,
  MARGIN_NOTE,
  MARGIN_PERIODS,
  PER_EMPLOYEE,
  UTILISATION,
  UTILISATION_NOTE,
} from "@/lib/data/sector-history";

function fmt(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "thousands") return `${v.toFixed(0)}k`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function SectorHistory() {
  const [setId, setSetId] = useState(HISTORY[0].id);
  const [cohort, setCohort] = useState<"all" | "Indian tier-1" | "Global tier-1">("all");

  const active = HISTORY.find((h) => h.id === setId) ?? HISTORY[0];

  const series: LineSeries[] = active.series.map((s) => ({
    key: s.cohort,
    label: s.cohort,
    points: s.values
      .map((v, i) => (v === null ? null : { t: i, v }))
      .filter((p): p is { t: number; v: number } => p !== null),
  }));

  const marginRows = MARGIN_MATRIX.filter((r) => cohort === "all" || r.cohort === cohort);

  return (
    <>
      <Panel
        title="Quarterly history"
        hint="Five years of sector trend, on the cohorts the sector report uses. Select a measure."
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
            <div className="filter-row">
              <span className="t-label filter-row-label">Measure</span>
              <div className="filter-row-chips">
                {HISTORY.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="chip"
                    data-active={setId === h.id}
                    aria-pressed={setId === h.id}
                    onClick={() => setSetId(h.id)}
                  >
                    {h.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <LineChart
            series={series}
            height={330}
            valueFormat={(v) => fmt(v, active.unit)}
            baselineAt={active.unit === "%" || active.unit === "thousands" ? 0 : undefined}
            caption={`${active.periods[0]} to ${active.periods[active.periods.length - 1]}. ${active.note}`}
          />

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Cohort</th>
                  {active.periods.map((p) => (
                    <th key={p} className="num" style={{ fontSize: 10 }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.series.map((s) => (
                  <tr key={s.cohort}>
                    <td style={{ whiteSpace: "nowrap" }}>{s.cohort}</td>
                    {s.values.map((v, i) => (
                      <td key={active.periods[i]} className="num tnum" style={{ fontSize: 11 }}>
                        {v === null ? "n/a" : fmt(v, active.unit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel
        title="EBIT margin by quarter"
        hint="Thirteen quarters per company. The cohort filter narrows the table."
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
            <div className="filter-row">
              <span className="t-label filter-row-label">Cohort</span>
              <div className="filter-row-chips">
                {(["all", "Indian tier-1", "Global tier-1"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    data-active={cohort === c}
                    aria-pressed={cohort === c}
                    onClick={() => setCohort(c)}
                  >
                    {c === "all" ? "All" : c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  {MARGIN_PERIODS.map((p) => (
                    <th key={p} className="num" style={{ fontSize: 10 }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marginRows.map((r) => (
                  <tr key={r.company}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.company}
                      <span className="cmp-period"> {r.cohort}</span>
                    </td>
                    {r.values.map((v, i) => {
                      const prev = i > 0 ? r.values[i - 1] : null;
                      const up = v !== null && prev !== null && v > prev;
                      const down = v !== null && prev !== null && v < prev;
                      return (
                        <td
                          key={MARGIN_PERIODS[i]}
                          className="num tnum"
                          style={{
                            fontSize: 11,
                            color: down ? "var(--negative, #b3261e)" : up ? "var(--positive, #1a7f5a)" : undefined,
                          }}
                        >
                          {v === null ? "n/a" : `${v.toFixed(1)}%`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t-small" style={{ margin: 0, fontSize: 12 }}>{MARGIN_NOTE}</p>
        </div>
      </Panel>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
        <Panel title="Per employee" hint="Where India sits against its global peers.">
          <div style={{ display: "grid", gap: 20 }}>
            {Object.entries(PER_EMPLOYEE).map(([key, block]) => {
              const max = Math.max(...block.points.map((p) => Math.max(p.first, p.last)));
              return (
                <div key={key}>
                  <span className="t-label" style={{ fontSize: 10 }}>{block.title}</span>
                  <p className="t-small" style={{ margin: "2px 0 8px", fontSize: 11 }}>{block.unit}</p>
                  {block.points.map((p) => (
                    <div key={p.cohort} className="pe-row">
                      <span className="pe-name">{p.cohort}</span>
                      <span className="pe-track">
                        <span className="pe-fill" style={{ width: `${(p.last / max) * 100}%` }} />
                        <span className="pe-first" style={{ left: `${(p.first / max) * 100}%` }} title={`Was ${p.first}`} />
                      </span>
                      <span className="pe-val tnum">${p.last.toFixed(1)}</span>
                    </div>
                  ))}
                  <p className="t-small" style={{ margin: "6px 0 0", fontSize: 11 }}>{block.note}</p>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Utilisation and headcount" hint="Latest reported, with the names that do not disclose.">
          <div style={{ display: "grid", gap: 20 }}>
            <div>
              <span className="t-label" style={{ fontSize: 10 }}>Capacity utilisation, Dec-24</span>
              <div style={{ marginTop: 8 }}>
                {UTILISATION.map((u) => (
                  <div key={u.company} className="pe-row">
                    <span className="pe-name">{u.company}</span>
                    <span className="pe-track">
                      {u.latest !== null && <span className="pe-fill" style={{ width: `${u.latest}%` }} />}
                    </span>
                    <span className="pe-val tnum">
                      {u.latest === null ? <span className="t-small">Not disclosed</span> : `${u.latest.toFixed(1)}%`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="t-small" style={{ margin: "6px 0 0", fontSize: 11 }}>{UTILISATION_NOTE}</p>
            </div>

            <div>
              <span className="t-label" style={{ fontSize: 10 }}>
                Headcount change, {HEADCOUNT_YOY.periodLabel}
              </span>
              <div style={{ marginTop: 8 }}>
                {HEADCOUNT_YOY.cohorts.map((c) => (
                  <div key={c.cohort} className="pe-row">
                    <span className="pe-name">{c.cohort}</span>
                    <span className="pe-track">
                      <span
                        className="pe-fill"
                        data-negative={c.value < 0}
                        style={{ width: `${(Math.abs(c.value) / 10) * 100}%` }}
                      />
                    </span>
                    <span className="pe-val tnum">{c.value > 0 ? "+" : ""}{c.value.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <p className="t-small" style={{ fontSize: 12, margin: 0 }}>
        Quarterly history is a fixed record from the {HISTORY_SOURCE}. It does not refresh on load. Everything
        else on this console is computed from filings on every request.
      </p>
    </>
  );
}
