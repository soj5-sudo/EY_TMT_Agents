"use client";

import { useState } from "react";
import {
  ChartFrame,
  Legend,
  SERIES_COLORS,
  XLabels,
  linearScale,
  niceTicks,
  useSeriesToggle,
  useTooltip,
} from "./kit";

export interface StackSeries {
  key: string;
  label: string;
  values: number[];
}

export function StackedBars({
  categories,
  series,
  height = 320,
  unit = "% of revenue",
  caption,
}: {
  categories: string[];
  series: StackSeries[];
  height?: number;
  unit?: string;
  caption?: string;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<number | null>(null);
  const { hidden, toggle } = useSeriesToggle(series.map((s) => s.key));

  const width = 760;
  const m = { top: 16, right: 16, bottom: 34, left: 46 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const visible = series.filter((s) => !hidden.has(s.key));

  if (categories.length === 0 || visible.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Nothing to stack</p>
        <p className="empty-body">Select at least one series from the legend.</p>
      </div>
    );
  }

  const totals = categories.map((_, i) =>
    visible.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
  );
  const maxTotal = Math.max(...totals, 1);
  const y = linearScale([0, maxTotal * 1.06], [m.top + plotH, m.top]);
  const ticks = niceTicks(0, maxTotal * 1.06, 5);

  const band = plotW / categories.length;
  const barW = Math.min(74, band * 0.56);
  const cx = (i: number) => m.left + band * i + band / 2;

  return (
    <>
      <ChartFrame height={height} tooltip={node} hostRef={hostRef} caption={caption}>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Stacked composition of ${series.map((s) => s.label).join(", ")} across ${categories.length} periods.`}
          style={{ height }}
          onMouseLeave={() => {
            hide();
            setActive(null);
          }}
        >
          <g className="chart-grid" aria-hidden="true">
            {ticks.map((t) => (
              <line key={t} x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} />
            ))}
          </g>

          <g aria-hidden="true">
            {ticks.map((t) => (
              <text
                key={t}
                className="chart-tick"
                x={m.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {t.toFixed(0)}
              </text>
            ))}
          </g>

          {categories.map((cat, i) => {
            let cursor = 0;
            return (
              <g key={cat}>
                {visible.map((s) => {
                  const v = s.values[i] ?? 0;
                  const top = y(cursor + v);
                  const bottom = y(cursor);
                  cursor += v;
                  const colorIdx = series.findIndex((x) => x.key === s.key);
                  return (
                    <rect
                      key={s.key}
                      x={cx(i) - barW / 2}
                      y={top}
                      width={barW}
                      height={Math.max(0, bottom - top)}
                      fill={SERIES_COLORS[colorIdx % SERIES_COLORS.length]}
                      opacity={active === null || active === i ? 1 : 0.42}
                      style={{ transition: "opacity 150ms cubic-bezier(0,0,0.2,1)" }}
                    />
                  );
                })}
              </g>
            );
          })}

          <g className="chart-axis" aria-hidden="true">
            <line x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />
          </g>

          <XLabels
            labels={categories}
            positions={categories.map((_, i) => cx(i))}
            y={m.top + plotH + 20}
          />

          {categories.map((cat, i) => (
            <rect
              key={`hit-${cat}`}
              className="chart-hit"
              x={m.left + band * i}
              y={m.top}
              width={band}
              height={plotH}
              onMouseMove={(e) => {
                const host = hostRef.current;
                if (!host) return;
                const box = host.getBoundingClientRect();
                setActive(i);
                show({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  title: `${cat} · ${totals[i].toFixed(1)} ${unit}`,
                  rows: visible
                    .map((s) => ({
                      label: s.label,
                      value: `${(s.values[i] ?? 0).toFixed(1)}`,
                      color:
                        SERIES_COLORS[
                          series.findIndex((x) => x.key === s.key) % SERIES_COLORS.length
                        ],
                    }))
                    .filter((r) => Number(r.value) > 0)
                    .reverse(),
                });
              }}
            />
          ))}
        </svg>
      </ChartFrame>

      <Legend
        items={series.map((s, i) => ({
          key: s.key,
          label: s.label,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
        }))}
        hidden={hidden}
        onToggle={toggle}
      />
    </>
  );
}
