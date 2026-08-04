"use client";

import { useMemo, useState } from "react";
import type { NewsItem } from "@/lib/core/types";
import { TIER_LABEL } from "@/lib/sources/registry";

const CATEGORY_LABEL: Record<string, string> = {
  "m&a": "M and A",
  earnings: "Earnings",
  guidance: "Guidance",
  deal: "Deal",
  capex: "Capex",
  regulation: "Regulation",
  workforce: "Workforce",
  leadership: "Leadership",
  product: "Product",
  general: "General",
};

/**
 * Coverage list.
 *
 * The publisher tier is the quiet part: it sits in the row as a small mark and
 * only becomes a filter when the reader asks for it. Analysts want to know a
 * claim came from a wire rather than a trade blog without the page shouting
 * about provenance on every line.
 */
export function SourceList({
  items,
  limit = 40,
}: {
  items: NewsItem[];
  limit?: number;
}) {
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0);
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const c = { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>;
    for (const i of items) c[i.publisherTier]++;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (tierFilter === 0 ? items : items.filter((i) => i.publisherTier <= tierFilter)),
    [items, tierFilter],
  );

  const shown = expanded ? filtered : filtered.slice(0, limit);

  return (
    <div>
      <div className="source-bar">
        <span className="t-label" style={{ fontSize: 10 }}>Sources</span>
        <button
          type="button"
          className="chip"
          data-active={tierFilter === 0}
          onClick={() => setTierFilter(0)}
          aria-pressed={tierFilter === 0}
        >
          All ({items.length})
        </button>
        {([1, 2, 3] as const).map((t) =>
          counts[t] > 0 ? (
            <button
              key={t}
              type="button"
              className="chip"
              data-active={tierFilter === t}
              onClick={() => setTierFilter(t)}
              aria-pressed={tierFilter === t}
              title={`Tier ${t} and above`}
            >
              {TIER_LABEL[t]} ({counts[t]})
            </button>
          ) : null,
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing at this tier</p>
          <p className="empty-body">Widen the source filter to see the full set.</p>
        </div>
      ) : (
        <ul className="source-list">
          {shown.map((item) => (
            <li key={item.id}>
              <div className="source-meta">
                <span className="t-label" style={{ fontSize: 10 }}>
                  {CATEGORY_LABEL[item.category] ?? item.category}
                </span>
                {item.companies.map((c) => (
                  <span key={c} className="chip chip-static source-tag">{c}</span>
                ))}
                <span className="source-spacer" />
                <span className="t-small source-date">
                  {item.publishedAt
                    ? new Date(item.publishedAt).toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "short",
                      })
                    : "Date not set"}
                </span>
              </div>

              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="source-title"
              >
                {item.title}
              </a>

              <div className="source-attr">
                <span className="tier-dot" data-tier={item.publisherTier} aria-hidden="true" />
                <span>{item.publisher}</span>
                <span className="source-tier-note">{TIER_LABEL[item.publisherTier]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > limit && (
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-hairline)" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${filtered.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
