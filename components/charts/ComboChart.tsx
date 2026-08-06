"use client";

import { useState } from "react";
import {
  ChartFrame,
  GridLines,
  Scale,
  XLabels,
  YAxis,
  fmtCompact,
  linearScale,
  niceTicks,
  padDomain,
  useTooltip,
} from "./kit";

export interface ComboPoint {
  label: string;
  bar: number;
  line: number;
}

export function ComboChart({
  data,
  height = 300,
  barLabel,
  lineLabel,
  barFormat = fmtCompact,
  lineFormat = (v: number) => `${v.toFixed(1)}%`,
  caption,
}: {
  data: ComboPoint[];
  height?: number;
  barLabel: string;
  lineLabel: string;
  barFormat?: (v: number) => string;
  lineFormat?: (v: number) => string;
  caption?: string;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<number | null>(null);

  const width = 760;
  const m = { top: 18, right: 54, bottom: 34, left: 56 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  if (data.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No series to plot</p>
        <p className="empty-body">This chart renders once the quarterly series loads.</p>
      </div>
    );
  }

  const barMax = Math.max(...data.map((d) => d.bar));
  const barDomain = padDomain(0, barMax, 0.12, true);
  const barScale: Scale = linearScale(barDomain, [m.top + plotH, m.top]);

  const lineVals = data.map((d) => d.line);
  const lineDomain = padDomain(Math.min(...lineVals), Math.max(...lineVals), 0.45);
  const lineScale: Scale = linearScale(lineDomain, [m.top + plotH, m.top]);

  const band = plotW / data.length;
  const barW = Math.min(58, band * 0.46);
  const cx = (i: number) => m.left + band * i + band / 2;

  const yTicks = niceTicks(barDomain[0], barDomain[1], 5);
  const lineTicks = niceTicks(lineDomain[0], lineDomain[1], 4);

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${cx(i)} ${lineScale(d.line)}`)
    .join(" ");

  return (
    <ChartFrame height={height} tooltip={node} hostRef={hostRef} caption={caption}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${barLabel} as columns with ${lineLabel} overlaid as a line, across ${data.length} periods.`}
        style={{ height }}
        onMouseLeave={() => {
          hide();
          setActive(null);
        }}
      >
        <GridLines ticks={yTicks} scale={barScale} x0={m.left} x1={m.left + plotW} />
        <YAxis ticks={yTicks} scale={barScale} x={m.left} format={barFormat} />

        { }
        <g aria-hidden="true">
          {lineTicks.map((t) => (
            <text
              key={t}
              className="chart-tick"
              x={m.left + plotW + 8}
              y={lineScale(t)}
              textAnchor="start"
              dominantBaseline="middle"
            >
              {lineFormat(t)}
            </text>
          ))}
        </g>

        <g className="chart-axis" aria-hidden="true">
          <line
            x1={m.left}
            x2={m.left + plotW}
            y1={m.top + plotH}
            y2={m.top + plotH}
          />
        </g>

        {data.map((d, i) => (
          <rect
            key={`bar-${d.label}`}
            x={cx(i) - barW / 2}
            y={barScale(d.bar)}
            width={barW}
            height={Math.max(0, m.top + plotH - barScale(d.bar))}
            fill={active === i ? "var(--ey-charcoal)" : "var(--seq-4)"}
            style={{ transition: "fill 150ms cubic-bezier(0,0,0.2,1)" }}
          />
        ))}

        <path
          d={linePath}
          fill="none"
          stroke="var(--ey-yellow-deep)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((d, i) => (
          <circle
            key={`dot-${d.label}`}
            cx={cx(i)}
            cy={lineScale(d.line)}
            r={active === i ? 5 : 3.5}
            fill="var(--surface)"
            stroke="var(--ey-yellow-deep)"
            strokeWidth={2}
            style={{ transition: "r 150ms cubic-bezier(0,0,0.2,1)" }}
          />
        ))}

        <XLabels
          labels={data.map((d) => d.label)}
          positions={data.map((_, i) => cx(i))}
          y={m.top + plotH + 20}
        />

        { }
        {data.map((d, i) => (
          <rect
            key={`hit-${d.label}`}
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
                title: d.label,
                rows: [
                  { label: barLabel, value: barFormat(d.bar), color: "var(--seq-4)" },
                  {
                    label: lineLabel,
                    value: lineFormat(d.line),
                    color: "var(--ey-yellow-deep)",
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
