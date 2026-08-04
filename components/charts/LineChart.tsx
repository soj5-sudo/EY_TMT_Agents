"use client";

import { useMemo, useState } from "react";
import {
  ChartFrame,
  GridLines,
  Legend,
  SERIES_COLORS,
  XLabels,
  YAxis,
  linearScale,
  niceTicks,
  padDomain,
  useSeriesToggle,
  useTooltip,
} from "./kit";

/**
 * Multi-series line with a shared crosshair.
 *
 * Used for rebased relative performance, where every series starts at 100 so
 * instruments priced in different currencies can share one axis. Series can be
 * toggled from the legend; the axis rescales to what remains visible, which is
 * the point of toggling in the first place.
 */

export interface LineSeries {
  key: string;
  label: string;
  points: Array<{ t: number; v: number }>;
}

export function LineChart({
  series,
  height = 320,
  valueFormat = (v: number) => v.toFixed(1),
  caption,
  baselineAt,
}: {
  series: LineSeries[];
  height?: number;
  valueFormat?: (v: number) => string;
  caption?: string;
  baselineAt?: number;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const { hidden, toggle } = useSeriesToggle(series.map((s) => s.key));

  const width = 760;
  const m = { top: 16, right: 20, bottom: 34, left: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const visible = useMemo(
    () => series.filter((s) => !hidden.has(s.key) && s.points.length > 0),
    [series, hidden],
  );

  const frame = useMemo(() => {
    if (visible.length === 0) return null;
    const length = Math.max(...visible.map((s) => s.points.length));
    const allV = visible.flatMap((s) => s.points.map((p) => p.v));
    const domain = padDomain(Math.min(...allV), Math.max(...allV), 0.1);
    return { length, domain };
  }, [visible]);

  if (series.length === 0 || !frame) {
    return (
      <div className="empty">
        <p className="empty-title">Price history is not available</p>
        <p className="empty-body">
          The upstream series did not resolve on this request. Reload to retry.
        </p>
      </div>
    );
  }

  const y = linearScale(frame.domain, [m.top + plotH, m.top]);
  const x = (i: number, total: number) =>
    m.left + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);

  const ticks = niceTicks(frame.domain[0], frame.domain[1], 5);

  const labelPositions = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    Math.round(f * (frame.length - 1)),
  );
  const reference = visible[0];
  const labels = labelPositions.map((i) => {
    const p = reference.points[Math.min(i, reference.points.length - 1)];
    if (!p) return "";
    return new Date(p.t * 1000).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  });

  return (
    <>
      <ChartFrame height={height} tooltip={node} hostRef={hostRef} caption={caption}>
        <svg
          className="chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Relative performance of ${series.map((s) => s.label).join(", ")}.`}
          style={{ height }}
          onMouseLeave={() => {
            hide();
            setActiveIdx(null);
          }}
        >
          <GridLines ticks={ticks} scale={y} x0={m.left} x1={m.left + plotW} />
          <YAxis ticks={ticks} scale={y} x={m.left} format={valueFormat} />

          {baselineAt !== undefined &&
            baselineAt >= frame.domain[0] &&
            baselineAt <= frame.domain[1] && (
              <line
                x1={m.left}
                x2={m.left + plotW}
                y1={y(baselineAt)}
                y2={y(baselineAt)}
                stroke="var(--border-emphasis)"
                strokeWidth={1}
                strokeDasharray="3 3"
                shapeRendering="crispEdges"
              />
            )}

          {activeIdx !== null && (
            <line
              x1={x(activeIdx, frame.length)}
              x2={x(activeIdx, frame.length)}
              y1={m.top}
              y2={m.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          )}

          {series.map((s, si) => {
            const off = hidden.has(s.key);
            if (off || s.points.length === 0) return null;
            const color = SERIES_COLORS[si % SERIES_COLORS.length];
            const d = s.points
              .map(
                (p, i) =>
                  `${i === 0 ? "M" : "L"} ${x(i, s.points.length)} ${y(p.v)}`,
              )
              .join(" ");
            return (
              <path
                key={s.key}
                className="chart-series"
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={s.key === "TCS.NS" ? 2.4 : 1.6}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {activeIdx !== null &&
            series.map((s, si) => {
              if (hidden.has(s.key)) return null;
              const p = s.points[Math.min(activeIdx, s.points.length - 1)];
              if (!p) return null;
              return (
                <circle
                  key={`m-${s.key}`}
                  cx={x(activeIdx, frame.length)}
                  cy={y(p.v)}
                  r={4}
                  fill="var(--surface)"
                  stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
                  strokeWidth={2}
                />
              );
            })}

          <XLabels
            labels={labels}
            positions={labelPositions.map((i) => x(i, frame.length))}
            y={m.top + plotH + 20}
          />

          <rect
            className="chart-hit"
            x={m.left}
            y={m.top}
            width={plotW}
            height={plotH}
            onMouseMove={(e) => {
              const host = hostRef.current;
              if (!host) return;
              const box = host.getBoundingClientRect();
              const svgX =
                ((e.clientX - box.left) / box.width) * width - m.left;
              const idx = Math.round((svgX / plotW) * (frame.length - 1));
              const clamped = Math.max(0, Math.min(frame.length - 1, idx));
              setActiveIdx(clamped);

              const p0 = reference.points[Math.min(clamped, reference.points.length - 1)];
              show({
                x: e.clientX - box.left,
                y: e.clientY - box.top,
                title: p0
                  ? new Date(p0.t * 1000).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "",
                rows: series
                  .filter((s) => !hidden.has(s.key))
                  .map((s, si) => {
                    const p = s.points[Math.min(clamped, s.points.length - 1)];
                    return {
                      label: s.label,
                      value: p ? valueFormat(p.v) : "Not set",
                      color:
                        SERIES_COLORS[
                          series.indexOf(s) % SERIES_COLORS.length
                        ],
                    };
                  }),
              });
            }}
          />
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
