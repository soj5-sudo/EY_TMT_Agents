"use client";

import { useCallback, useRef, useState } from "react";

export interface Scale {
  (value: number): number;
  invert(pixel: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;

  const fn = ((value: number) =>
    r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const span = max - min;
  const rough = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;

  let step: number;
  if (normalised <= 1) step = 1;
  else if (normalised <= 2) step = 2;
  else if (normalised <= 2.5) step = 2.5;
  else if (normalised <= 5) step = 5;
  else step = 10;
  step *= magnitude;

  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

export function padDomain(
  min: number,
  max: number,
  factor = 0.08,
  zeroFloor = false,
): [number, number] {
  if (min === max) {
    const bump = Math.abs(min) * 0.1 || 1;
    return [min - bump, max + bump];
  }
  const pad = (max - min) * factor;
  const lo = zeroFloor && min >= 0 ? 0 : min - pad;
  return [lo, max + pad];
}

export function fmtNumber(v: number, digits = 0): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return fmtNumber(v, abs < 10 && abs % 1 !== 0 ? 1 : 0);
}

export function fmtSigned(v: number, digits = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export const SERIES_COLORS = [
  "var(--seq-1)",
  "var(--seq-3)",
  "var(--seq-4)",
  "var(--ey-yellow-deep)",
  "var(--seq-2)",
  "var(--seq-5)",
];

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}

export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const show = useCallback((state: TooltipState) => setTip(state), []);
  const hide = useCallback(() => setTip(null), []);

  const node = tip ? (
    <div
      className="tooltip"
      role="status"
      style={{
        left: tip.x,
        top: tip.y,
        transform:
          tip.x > (hostRef.current?.clientWidth ?? 0) * 0.62
            ? "translate(calc(-100% - 14px), -50%)"
            : "translate(14px, -50%)",
      }}
    >
      <div className="tooltip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {r.color && (
              <span
                className="legend-swatch"
                style={{ background: r.color, opacity: 0.9 }}
                aria-hidden="true"
              />
            )}
            {r.label}
          </span>
          <span style={{ fontWeight: 500 }}>{r.value}</span>
        </div>
      ))}
    </div>
  ) : null;

  return { tip, show, hide, node, hostRef };
}

export function ChartFrame({
  height,
  children,
  tooltip,
  hostRef,
  caption,
}: {
  height: number;
  children: React.ReactNode;
  tooltip?: React.ReactNode;
  hostRef?: React.RefObject<HTMLDivElement | null>;
  caption?: string;
}) {
  return (
    <figure style={{ margin: 0, position: "relative" }} ref={hostRef}>
      <div style={{ position: "relative", height }}>{children}</div>
      {tooltip}
      {caption && (
        <figcaption className="t-small" style={{ fontSize: 11, marginTop: 10 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function GridLines({
  ticks,
  scale,
  x0,
  x1,
}: {
  ticks: number[];
  scale: Scale;
  x0: number;
  x1: number;
}) {
  return (
    <g className="chart-grid" aria-hidden="true">
      {ticks.map((t) => (
        <line key={t} x1={x0} x2={x1} y1={scale(t)} y2={scale(t)} />
      ))}
    </g>
  );
}

export function YAxis({
  ticks,
  scale,
  x,
  format = fmtCompact,
}: {
  ticks: number[];
  scale: Scale;
  x: number;
  format?: (v: number) => string;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <text
          key={t}
          className="chart-tick"
          x={x - 8}
          y={scale(t)}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {format(t)}
        </text>
      ))}
    </g>
  );
}

export function XLabels({
  labels,
  positions,
  y,
}: {
  labels: string[];
  positions: number[];
  y: number;
}) {
  return (
    <g aria-hidden="true">
      {labels.map((label, i) => (
        <text
          key={`${label}-${i}`}
          className="chart-tick"
          x={positions[i]}
          y={y}
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </g>
  );
}

export function useSeriesToggle(keys: string[]) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else if (next.size < keys.length - 1) next.add(key);
        return next;
      });
    },
    [keys.length],
  );

  return { hidden, toggle, isHidden: (k: string) => hidden.has(k) };
}

export function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: Array<{ key: string; label: string; color: string }>;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="legend" style={{ marginTop: 14 }}>
      {items.map((item) => {
        const off = hidden.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            className="legend-item"
            data-off={off}
            onClick={() => onToggle(item.key)}
            aria-pressed={!off}
          >
            <span
              className="legend-swatch"
              style={{
                background: off ? "transparent" : item.color,
                border: `1px solid ${item.color}`,
              }}
              aria-hidden="true"
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
