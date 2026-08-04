"use client";

import { useState } from "react";
import { fmtSigned, useTooltip } from "./kit";

/**
 * Horizontal share bar with a paired growth column.
 *
 * Built for revenue distribution, where the reader needs two things at once:
 * how big a segment is, and which direction it moved. A share bar alone hides
 * the second, and a growth chart alone hides the first, so both sit on one row
 * with the growth rendered as a signed bar off a centre line.
 */

export interface DistributionRow {
  label: string;
  share: number;
  growth: number;
  group?: string;
}

export function DistributionChart({
  rows,
  shareLabel = "Share of revenue",
  growthLabel = "Growth",
  caption,
}: {
  rows: DistributionRow[];
  shareLabel?: string;
  growthLabel?: string;
  caption?: string;
}) {
  const { show, hide, node, hostRef } = useTooltip();
  const [active, setActive] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No distribution to show</p>
        <p className="empty-body">Segment data has not loaded.</p>
      </div>
    );
  }

  const maxShare = Math.max(...rows.map((r) => r.share));
  const maxGrowth = Math.max(...rows.map((r) => Math.abs(r.growth)), 1);

  return (
    <figure style={{ margin: 0, position: "relative" }} ref={hostRef}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1.4fr) minmax(90px, 2.2fr) 56px minmax(80px, 1.4fr) 60px",
          gap: "0 12px",
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <span className="t-label" style={{ fontSize: 10 }}>
          Segment
        </span>
        <span className="t-label" style={{ fontSize: 10 }}>
          {shareLabel}
        </span>
        <span className="t-label" style={{ fontSize: 10, textAlign: "right" }}>
          %
        </span>
        <span className="t-label" style={{ fontSize: 10 }}>
          {growthLabel}
        </span>
        <span className="t-label" style={{ fontSize: 10, textAlign: "right" }}>
          %
        </span>

        <div style={{ gridColumn: "1 / -1", height: 1, background: "var(--border-strong)", margin: "6px 0 10px" }} />

        {rows.map((row) => {
          const isActive = active === row.label;
          const up = row.growth >= 0;
          return (
            <Row
              key={row.label}
              row={row}
              isActive={isActive}
              maxShare={maxShare}
              maxGrowth={maxGrowth}
              up={up}
              onEnter={(e) => {
                const host = hostRef.current;
                if (!host) return;
                const box = host.getBoundingClientRect();
                setActive(row.label);
                show({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  title: row.label,
                  rows: [
                    { label: shareLabel, value: `${row.share.toFixed(1)}%` },
                    { label: growthLabel, value: `${fmtSigned(row.growth)}%` },
                    ...(row.group ? [{ label: "Region", value: row.group }] : []),
                  ],
                });
              }}
              onLeave={() => {
                setActive(null);
                hide();
              }}
            />
          );
        })}
      </div>

      {node}

      {caption && (
        <figcaption className="t-small" style={{ fontSize: 11, marginTop: 14 }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function Row({
  row,
  isActive,
  maxShare,
  maxGrowth,
  up,
  onEnter,
  onLeave,
}: {
  row: DistributionRow;
  isActive: boolean;
  maxShare: number;
  maxGrowth: number;
  up: boolean;
  onEnter: (e: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const cell: React.CSSProperties = {
    paddingTop: 7,
    paddingBottom: 7,
    borderBottom: "1px solid var(--border-hairline)",
  };

  return (
    <>
      <span
        style={{ ...cell, color: "var(--text-primary)" }}
        onMouseMove={onEnter}
        onMouseLeave={onLeave}
      >
        {row.label}
      </span>

      <span style={cell} onMouseMove={onEnter} onMouseLeave={onLeave}>
        <span
          style={{
            display: "block",
            height: 10,
            width: `${(row.share / maxShare) * 100}%`,
            background: isActive ? "var(--ey-charcoal)" : "var(--seq-4)",
            transition: "background 150ms cubic-bezier(0,0,0.2,1)",
          }}
        />
      </span>

      <span
        className="tnum"
        style={{ ...cell, textAlign: "right", color: "var(--text-primary)" }}
        onMouseMove={onEnter}
        onMouseLeave={onLeave}
      >
        {row.share.toFixed(1)}
      </span>

      {/* Signed growth off a centre line. */}
      <span style={cell} onMouseMove={onEnter} onMouseLeave={onLeave}>
        <span style={{ display: "block", position: "relative", height: 10 }}>
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: -2,
              bottom: -2,
              width: 1,
              background: "var(--border-strong)",
            }}
            aria-hidden="true"
          />
          <span
            style={{
              position: "absolute",
              top: 0,
              height: 10,
              left: up ? "50%" : undefined,
              right: up ? undefined : "50%",
              width: `${(Math.abs(row.growth) / maxGrowth) * 48}%`,
              background: up ? "var(--data-positive)" : "var(--data-negative)",
              opacity: isActive ? 1 : 0.78,
              transition: "opacity 150ms cubic-bezier(0,0,0.2,1)",
            }}
          />
        </span>
      </span>

      <span
        className="tnum"
        style={{
          ...cell,
          textAlign: "right",
          color: up ? "var(--data-positive)" : "var(--data-negative)",
        }}
        onMouseMove={onEnter}
        onMouseLeave={onLeave}
      >
        {fmtSigned(row.growth)}
      </span>
    </>
  );
}
