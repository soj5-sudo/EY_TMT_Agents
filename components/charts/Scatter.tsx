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

/**
 * Positioning plot.
 *
 * Scale against profitability, the pairing a peer set exists to show: the same
 * margin means something different at two hundred million of revenue than at
 * eight billion, and two sorted columns never make that visible. No quadrant
 * lines here, because a peer universe drawn from mixed reporting periods has no
 * average worth ruling a line through.
 */

export interface PositionPoint {
  label: string;
  x: number;
  y: number;
  highlight?: boolean;
  group?: string;
}

const LABEL_LIMIT = 12;

/**
 * padDomain widens a domain of one value, which is what a single point or a
 * column of identical figures produces, so the scale span is never zero. The
 * clamp keeps the padding from carrying an axis below zero when nothing
 * reported is negative: a revenue axis starting under zero invents peers.
 */
function axisDomain(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const [padLo, padHi] = padDomain(lo, hi, 0.1);
  return [lo >= 0 ? Math.max(0, padLo) : padLo, padHi];
}

export function Scatter({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
}: {
  points: PositionPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
}) {
  const plotted = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );

  if (plotted.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Nothing to position</p>
        <p className="empty-body">
          {points.length === 0
            ? "No companies were passed for this view."
            : "None of the companies passed carry a figure on both axes."}
        </p>
      </div>
    );
  }

  const width = 760;
  const height = 420;
  const m = { top: 18, right: 30, bottom: 48, left: 68 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const xDomain = axisDomain(plotted.map((p) => p.x));
  const yDomain = axisDomain(plotted.map((p) => p.y));

  const x = linearScale(xDomain, [m.left, m.left + plotW]);
  const y = linearScale(yDomain, [m.top + plotH, m.top]);

  const xTicks = [xDomain[0], (xDomain[0] + xDomain[1]) / 2, xDomain[1]];
  const yTicks = [yDomain[0], (yDomain[0] + yDomain[1]) / 2, yDomain[1]];

  // Past a dozen points the labels overlap into noise, so only the selection
  // keeps its name and the rest are read by hovering.
  const named = plotted.length < LABEL_LIMIT;

  // Selected dots are drawn last so nothing is painted over them.
  const ordered = [...plotted].sort(
    (a, b) => Number(a.highlight ?? false) - Number(b.highlight ?? false),
  );

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${xLabel} against ${yLabel} for ${plotted.length} companies.`}
      >
        <g aria-hidden="true">
          {yTicks.map((t) => (
            <line
              key={`h${t}`}
              x1={m.left}
              x2={m.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--ey-grey-pale)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}
          {xTicks.map((t) => (
            <line
              key={`v${t}`}
              y1={m.top}
              y2={m.top + plotH}
              x1={x(t)}
              x2={x(t)}
              stroke="var(--ey-grey-pale)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}
        </g>

        <g aria-hidden="true">
          {yTicks.map((t) => (
            <text
              key={`y${t}`}
              className="chart-tick"
              x={m.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatY(t)}
            </text>
          ))}
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              className="chart-tick"
              x={x(t)}
              y={m.top + plotH + 18}
              textAnchor="middle"
            >
              {formatX(t)}
            </text>
          ))}
        </g>

        {ordered.map((p, i) => {
          const on = p.highlight === true;
          const r = on ? 11 : 6;
          return (
            <g key={`${p.label}-${i}`}>
              <circle
                cx={x(p.x)}
                cy={y(p.y)}
                r={r}
                fill={on ? "var(--accent)" : "var(--ey-charcoal)"}
                fillOpacity={on ? 1 : 0.55}
                stroke={on ? "var(--ey-charcoal)" : undefined}
                strokeWidth={on ? 1 : undefined}
              >
                <title>
                  {`${p.label}${p.group ? `, ${p.group}` : ""}. ${xLabel}: ${formatX(p.x)}. ${yLabel}: ${formatY(p.y)}.`}
                </title>
              </circle>
              {(on || named) && (
                <text
                  className="chart-tick"
                  x={x(p.x)}
                  y={y(p.y) - r - 6}
                  textAnchor="middle"
                  style={{
                    fill: on ? "var(--text-primary)" : "var(--text-muted)",
                    fontWeight: on ? 600 : 400,
                  }}
                  aria-hidden="true"
                >
                  {p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label}
                </text>
              )}
            </g>
          );
        })}

        <g className="chart-axis" aria-hidden="true">
          <line x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />
          <line x1={m.left} x2={m.left} y1={m.top} y2={m.top + plotH} />
        </g>

        <text
          className="chart-tick"
          x={m.left + plotW / 2}
          y={height - 10}
          textAnchor="middle"
          aria-hidden="true"
        >
          {xLabel}
        </text>
        <text
          className="chart-tick"
          transform={`translate(16, ${m.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          aria-hidden="true"
        >
          {yLabel}
        </text>
      </svg>
    </figure>
  );
}
