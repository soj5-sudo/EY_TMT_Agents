"use client";

import { useState } from "react";
import {
  ChartFrame,
  fmtCompact,
  linearScale,
  niceTicks,
  useTooltip,
} from "./kit";

export interface WaterfallStep {
  label: string;
  value: number;
  kind: "total" | "deduction" | "addition";
}

export function Waterfall({
  steps,
  height = 340,
  format = fmtCompact,
  unit,
  caption,
}: {
  steps: WaterfallStep[];
  height?: number;
  format?: (v: number) => string;
  unit: string;
  caption?: string;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<number | null>(null);

  const width = 760;
  const m = { top: 18, right: 16, bottom: 62, left: 58 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  if (steps.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No bridge to draw</p>
        <p className="empty-body">The income statement has not loaded.</p>
      </div>
    );
  }

  const bars: Array<{ step: WaterfallStep; from: number; to: number }> = [];
  let running = 0;
  for (const step of steps) {
    if (step.kind === "total") {
      bars.push({ step, from: 0, to: step.value });
      running = step.value;
    } else if (step.kind === "deduction") {
      bars.push({ step, from: running - step.value, to: running });
      running -= step.value;
    } else {
      bars.push({ step, from: running, to: running + step.value });
      running += step.value;
    }
  }

  const maxV = Math.max(...bars.map((b) => Math.max(b.from, b.to)));
  const y = linearScale([0, maxV * 1.08], [m.top + plotH, m.top]);
  const ticks = niceTicks(0, maxV * 1.08, 5);

  const band = plotW / bars.length;
  const barW = Math.min(52, band * 0.62);
  const cx = (i: number) => m.left + band * i + band / 2;

  const colorOf = (kind: WaterfallStep["kind"]) =>
    kind === "total"
      ? "var(--ey-charcoal)"
      : kind === "deduction"
        ? "var(--seq-4)"
        : "var(--data-positive)";

  return (
    <ChartFrame height={height} tooltip={node} hostRef={hostRef} caption={caption}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Income statement bridge from ${steps[0]?.label} to ${steps[steps.length - 1]?.label}, in ${unit}.`}
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
              {format(t)}
            </text>
          ))}
        </g>

        { }
        {bars.slice(0, -1).map((b, i) => {
          const next = bars[i + 1];
          const level = next.step.kind === "total" ? next.to : b.to;
          const yy = y(Math.min(b.to, level) === b.to ? b.to : b.to);
          return (
            <line
              key={`c-${b.step.label}`}
              x1={cx(i) + barW / 2}
              x2={cx(i + 1) - barW / 2}
              y1={yy}
              y2={yy}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="2 2"
              shapeRendering="crispEdges"
            />
          );
        })}

        {bars.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          const bottom = y(Math.min(b.from, b.to));
          return (
            <rect
              key={b.step.label}
              x={cx(i) - barW / 2}
              y={top}
              width={barW}
              height={Math.max(1, bottom - top)}
              fill={colorOf(b.step.kind)}
              opacity={active === null || active === i ? 1 : 0.45}
              style={{ transition: "opacity 150ms cubic-bezier(0,0,0.2,1)" }}
            />
          );
        })}

        <g className="chart-axis" aria-hidden="true">
          <line x1={m.left} x2={m.left + plotW} y1={m.top + plotH} y2={m.top + plotH} />
        </g>

        { }
        {bars.map((b, i) => (
          <text
            key={`l-${b.step.label}`}
            className="chart-tick"
            transform={`translate(${cx(i)}, ${m.top + plotH + 12}) rotate(-38)`}
            textAnchor="end"
            aria-hidden="true"
          >
            {b.step.label.length > 22
              ? `${b.step.label.slice(0, 21)}…`
              : b.step.label}
          </text>
        ))}

        {bars.map((b, i) => (
          <rect
            key={`hit-${b.step.label}`}
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
                title: b.step.label,
                rows: [
                  { label: unit, value: format(b.step.value) },
                  {
                    label: "Running total",
                    value: format(b.step.kind === "total" ? b.to : Math.min(b.from, b.to)),
                  },
                ],
              });
            }}
          />
        ))}
      </svg>
    </ChartFrame>
  );
}
