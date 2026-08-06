"use client";

/**
 * Paired period bars.
 *
 * Two bars a row, one per period, because the question a quarterly tracker
 * answers is not how big a company is but which way it moved, and a single bar
 * cannot carry that. Rows are drawn in the order given: the useful sort differs
 * by measure, so the caller owns it.
 */

export interface QuarterRow {
  label: string;
  prior: number | null;
  latest: number | null;
  highlight?: boolean;
}

const VB_WIDTH = 760;
const LABEL_W = 168;
const RIGHT_PAD = 92;
const ROW_H = 44;
const BAR_H = 13;
const BAR_GAP = 4;

export function QuarterBars({
  rows,
  unit,
  priorLabel,
  latestLabel,
  format,
}: {
  rows: QuarterRow[];
  unit: string;
  priorLabel: string;
  latestLabel: string;
  format: (v: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Nothing to compare</p>
        <p className="empty-body">No companies were passed for this measure.</p>
      </div>
    );
  }

  const values = rows
    .flatMap((r) => [figure(r.prior), figure(r.latest)])
    .filter((v): v is number => v !== null);

  // Bars run from zero, so the domain always contains it. A span of nothing
  // would divide by zero and draw every bar the full width of the plot.
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;

  const plotW = VB_WIDTH - LABEL_W - RIGHT_PAD;
  const scale = (v: number) => LABEL_W + ((v - lo) / span) * plotW;
  const zeroX = scale(0);
  const height = rows.length * ROW_H;

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 12 }}>
        <Key swatch="var(--ey-grey-light)" label={priorLabel} />
        <Key swatch="var(--ey-charcoal)" label={latestLabel} />
        <span className="t-label" style={{ fontSize: 10, marginLeft: "auto" }}>
          {unit}
        </span>
      </div>

      <svg
        className="chart-svg"
        viewBox={`0 0 ${VB_WIDTH} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${unit} for ${rows.length} companies, ${priorLabel} against ${latestLabel}.`}
      >
        {rows.map((row, i) => {
          const top = i * ROW_H;
          const priorY = top + (ROW_H - (BAR_H * 2 + BAR_GAP)) / 2;
          const latestY = priorY + BAR_H + BAR_GAP;
          const prior = figure(row.prior);
          const latest = figure(row.latest);
          const reported = prior !== null || latest !== null;

          // The value text hangs off whichever bar the row actually has, so a
          // company that stopped disclosing still reads left to right.
          const anchor = latest ?? prior ?? 0;
          const anchorX = scale(anchor);
          const toRight = anchor >= 0;

          return (
            <g key={`${row.label}-${i}`}>
              {i > 0 && (
                <line
                  x1={0}
                  x2={VB_WIDTH}
                  y1={top}
                  y2={top}
                  stroke="var(--ey-grey-pale)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              )}

              <text
                className="chart-tick"
                x={LABEL_W - 12}
                y={top + ROW_H / 2}
                textAnchor="end"
                dominantBaseline="middle"
                style={{
                  fill: row.highlight ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: row.highlight ? 600 : 400,
                  fontSize: 11,
                }}
              >
                {row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label}
              </text>

              {reported ? (
                <>
                  {prior !== null && (
                    <Bar
                      value={prior}
                      y={priorY}
                      zeroX={zeroX}
                      scale={scale}
                      fill="var(--ey-grey-light)"
                      title={`${row.label}, ${priorLabel}: ${format(prior)}`}
                    />
                  )}
                  {latest !== null && (
                    <Bar
                      value={latest}
                      y={latestY}
                      zeroX={zeroX}
                      scale={scale}
                      fill={row.highlight ? "var(--accent)" : "var(--ey-charcoal)"}
                      stroke={row.highlight ? "var(--ey-charcoal)" : undefined}
                      title={`${row.label}, ${latestLabel}: ${format(latest)}`}
                    />
                  )}

                  <text
                    className="tnum"
                    x={toRight ? anchorX + 8 : anchorX - 8}
                    y={latestY + BAR_H / 2}
                    textAnchor={toRight ? "start" : "end"}
                    dominantBaseline="middle"
                    style={{
                      fontSize: 11,
                      fill: latest === null ? "var(--text-muted)" : "var(--text-primary)",
                    }}
                  >
                    {latest === null ? "Not reported" : format(latest)}
                  </text>
                </>
              ) : (
                // A zero-length bar and an absent figure look identical and mean
                // opposite things, so an unreported row gets words instead.
                <text
                  className="t-small"
                  x={LABEL_W}
                  y={top + ROW_H / 2}
                  dominantBaseline="middle"
                  fill="currentColor"
                >
                  Not reported
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/**
 * A figure that cannot be drawn is treated as one that was never reported,
 * rather than allowed through to produce a bar of no defined length.
 */
function figure(v: number | null): number | null {
  return v !== null && Number.isFinite(v) ? v : null;
}

function Key({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span
        style={{ width: 10, height: 10, background: swatch, flex: "none" }}
        aria-hidden="true"
      />
      <span className="t-label" style={{ fontSize: 10 }}>
        {label}
      </span>
    </span>
  );
}

function Bar({
  value,
  y,
  zeroX,
  scale,
  fill,
  stroke,
  title,
}: {
  value: number;
  y: number;
  zeroX: number;
  scale: (v: number) => number;
  fill: string;
  stroke?: string;
  title: string;
}) {
  const end = scale(value);
  // A reported zero stays a zero, but a figure too small to reach a pixel is
  // held at one so it is not mistaken for one.
  const width = value === 0 ? 0 : Math.max(Math.abs(end - zeroX), 1);

  return (
    <rect
      x={Math.min(zeroX, end)}
      y={y}
      width={width}
      height={BAR_H}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? 1 : undefined}
      shapeRendering="crispEdges"
    >
      <title>{title}</title>
    </rect>
  );
}
