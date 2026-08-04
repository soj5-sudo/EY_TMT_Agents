"use client";

import { useState } from "react";
import {
  ChartFrame,
  fmtSigned,
  linearScale,
  niceTicks,
  padDomain,
  useTooltip,
} from "./kit";

/**
 * Share against growth, drawn as a quadrant.
 *
 * The single most useful view of a segment portfolio: a large segment growing
 * slowly is a different problem from a small one shrinking fast, and a table
 * sorted by either column hides the pairing. Quadrant boundaries are the
 * portfolio's own weighted average growth and the mean segment share, so the
 * split reflects this business rather than an arbitrary threshold.
 */

export interface ScatterPoint {
  label: string;
  share: number;
  growth: number;
}

export function ScatterQuadrant({
  points,
  height = 360,
  caption,
  xLabel = "Share of revenue, percent",
  yLabel = "Growth, percent",
}: {
  points: ScatterPoint[];
  height?: number;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<string | null>(null);

  const width = 760;
  const m = { top: 20, right: 24, bottom: 46, left: 56 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  if (points.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No segments to plot</p>
        <p className="empty-body">Segment data has not loaded.</p>
      </div>
    );
  }

  const xDomain = padDomain(
    Math.min(...points.map((p) => p.share)),
    Math.max(...points.map((p) => p.share)),
    0.14,
    true,
  );
  const yDomain = padDomain(
    Math.min(...points.map((p) => p.growth)),
    Math.max(...points.map((p) => p.growth)),
    0.2,
  );

  const x = linearScale(xDomain, [m.left, m.left + plotW]);
  const y = linearScale(yDomain, [m.top + plotH, m.top]);

  // Weighted average growth: the portfolio's own centre of gravity.
  const totalShare = points.reduce((s, p) => s + p.share, 0);
  const weightedGrowth =
    points.reduce((s, p) => s + p.growth * p.share, 0) / (totalShare || 1);
  const meanShare = totalShare / points.length;

  const xTicks = niceTicks(xDomain[0], xDomain[1], 5);
  const yTicks = niceTicks(yDomain[0], yDomain[1], 5);

  return (
    <ChartFrame height={height} tooltip={node} hostRef={hostRef} caption={caption}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Segment share against growth for ${points.length} segments.`}
        style={{ height }}
        onMouseLeave={() => {
          hide();
          setActive(null);
        }}
      >
        <g className="chart-grid" aria-hidden="true">
          {yTicks.map((t) => (
            <line key={`h${t}`} x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} />
          ))}
          {xTicks.map((t) => (
            <line key={`v${t}`} y1={m.top} y2={m.top + plotH} x1={x(t)} x2={x(t)} />
          ))}
        </g>

        {/* Quadrant dividers. */}
        <line
          x1={m.left}
          x2={m.left + plotW}
          y1={y(weightedGrowth)}
          y2={y(weightedGrowth)}
          stroke="var(--ey-yellow-deep)"
          strokeWidth={1.5}
          shapeRendering="crispEdges"
        />
        <line
          y1={m.top}
          y2={m.top + plotH}
          x1={x(meanShare)}
          x2={x(meanShare)}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
          shapeRendering="crispEdges"
        />

        <text
          className="chart-tick"
          x={m.left + plotW - 4}
          y={y(weightedGrowth) - 6}
          textAnchor="end"
          aria-hidden="true"
        >
          portfolio growth {weightedGrowth.toFixed(1)}%
        </text>

        <g aria-hidden="true">
          {yTicks.map((t) => (
            <text
              key={t}
              className="chart-tick"
              x={m.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmtSigned(t, 0)}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={t} className="chart-tick" x={x(t)} y={m.top + plotH + 18} textAnchor="middle">
              {t.toFixed(0)}
            </text>
          ))}
        </g>

        {points.map((p) => {
          const isActive = active === p.label;
          // Radius encodes share so the eye is drawn to what matters most.
          const r = 5 + Math.sqrt(p.share) * 1.9;
          return (
            <g key={p.label}>
              <circle
                cx={x(p.share)}
                cy={y(p.growth)}
                r={r}
                fill={
                  p.growth >= weightedGrowth
                    ? "var(--data-positive)"
                    : "var(--data-negative)"
                }
                fillOpacity={isActive ? 0.42 : 0.2}
                stroke={
                  p.growth >= weightedGrowth
                    ? "var(--data-positive)"
                    : "var(--data-negative)"
                }
                strokeWidth={isActive ? 2 : 1.4}
                style={{ transition: "fill-opacity 150ms cubic-bezier(0,0,0.2,1)" }}
              />
              <text
                className="chart-tick"
                x={x(p.share)}
                y={y(p.growth) - r - 6}
                textAnchor="middle"
                style={{
                  fill: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isActive ? 600 : 400,
                }}
                aria-hidden="true"
              >
                {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
              </text>
              <circle
                cx={x(p.share)}
                cy={y(p.growth)}
                r={Math.max(r, 14)}
                className="chart-hit"
                onMouseMove={(e) => {
                  const host = hostRef.current;
                  if (!host) return;
                  const box = host.getBoundingClientRect();
                  setActive(p.label);
                  show({
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                    title: p.label,
                    rows: [
                      { label: "Share", value: `${p.share.toFixed(1)}%` },
                      { label: "Growth", value: `${fmtSigned(p.growth)}%` },
                      {
                        label: "Vs portfolio",
                        value: `${fmtSigned(p.growth - weightedGrowth)} pts`,
                      },
                    ],
                  });
                }}
              />
            </g>
          );
        })}

        <g className="chart-axis" aria-hidden="true">
          <line x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />
        </g>

        <text
          className="chart-tick"
          x={m.left + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          aria-hidden="true"
        >
          {xLabel}
        </text>
        <text
          className="chart-tick"
          transform={`translate(14, ${m.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          aria-hidden="true"
        >
          {yLabel}
        </text>
      </svg>
    </ChartFrame>
  );
}
