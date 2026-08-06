"use client";

import { useState } from "react";
import { SERIES_COLORS, useTooltip } from "./kit";

export interface Slice {
  label: string;
  value: number;
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function Donut({
  slices,
  total,
  totalLabel,
  format,
  caption,
  height = 300,
}: {
  slices: Slice[];
  total?: number;
  totalLabel?: string;
  format: (v: number) => string;
  caption?: string;
  height?: number;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<string | null>(null);

  const positive = slices.filter((s) => s.value > 0);
  const sum = positive.reduce((a, b) => a + b.value, 0);

  if (positive.length === 0 || sum <= 0) {
    return (
      <div className="empty">
        <p className="empty-title">Nothing to split</p>
        <p className="empty-body">No positive values are reported for this breakdown.</p>
      </div>
    );
  }

  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const major = sorted.filter((s) => s.value / sum >= 0.02);
  const minor = sorted.filter((s) => s.value / sum < 0.02);
  const data =
    minor.length > 1
      ? [...major, { label: `${minor.length} smaller`, value: minor.reduce((a, b) => a + b.value, 0) }]
      : sorted;

  const size = height;
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 12;
  const stroke = 34;
  const radius = outer - stroke / 2;

  let angle = -Math.PI / 2;
  const segments = data.map((s, i) => {
    const sweep = (s.value / sum) * Math.PI * 2;
    const seg = {
      ...s,
      from: angle,
      to: angle + sweep,
      pct: (s.value / sum) * 100,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
    };
    angle += sweep;
    return seg;
  });

  return (
    <figure style={{ margin: 0, position: "relative" }} ref={hostRef}>
      <div className="donut-wrap">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={`Composition across ${data.length} groups.`}
          onMouseLeave={() => {
            hide();
            setActive(null);
          }}
          style={{ flex: "none" }}
        >
          {segments.map((s) => (
            <path
              key={s.label}
              d={arc(cx, cy, radius, s.from, s.to)}
              stroke={s.color}
              strokeWidth={active === s.label ? stroke + 6 : stroke}
              fill="none"
              opacity={active === null || active === s.label ? 1 : 0.4}
              style={{ transition: "stroke-width 150ms cubic-bezier(0,0,0.2,1), opacity 150ms" }}
              onMouseMove={(e) => {
                const host = hostRef.current;
                if (!host) return;
                const box = host.getBoundingClientRect();
                setActive(s.label);
                show({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  title: s.label,
                  rows: [
                    { label: "Value", value: format(s.value), color: s.color },
                    { label: "Share", value: `${s.pct.toFixed(1)}%` },
                  ],
                });
              }}
            />
          ))}

          {total !== undefined && (
            <>
              <text
                x={cx}
                y={cy - 4}
                textAnchor="middle"
                style={{ fontSize: 22, fill: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
              >
                {format(total)}
              </text>
              <text
                x={cx}
                y={cy + 16}
                textAnchor="middle"
                style={{ fontSize: 10, fill: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}
              >
                {totalLabel ?? "Total"}
              </text>
            </>
          )}
        </svg>

        <div className="donut-legend">
          {segments.map((s) => (
            <button
              key={s.label}
              type="button"
              className="donut-legend-row"
              data-active={active === s.label}
              onMouseEnter={() => setActive(s.label)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(s.label)}
              onBlur={() => setActive(null)}
            >
              <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="donut-legend-label">{s.label}</span>
              <span className="donut-legend-value tnum">{format(s.value)}</span>
              <span className="donut-legend-pct tnum">{s.pct.toFixed(1)}%</span>
            </button>
          ))}
        </div>
      </div>

      {node}
      {caption && (
        <figcaption className="t-small" style={{ fontSize: 11, marginTop: 12 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
