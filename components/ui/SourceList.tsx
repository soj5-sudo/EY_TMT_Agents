"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api";
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

const SECTORS = ["Technology", "Media", "Telecom", "Cross-sector"] as const;

export function SourceList({
  items,
  limit = 40,
}: {
  items: NewsItem[];
  limit?: number;
}) {
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0);
  const [sector, setSector] = useState<string>("All");
  const [category, setCategory] = useState<string>("All");
  const [company, setCompany] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const [live, setLive] = useState<NewsItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setLive([]);
      setSearchNote(null);
      return;
    }
    setSearching(true);
    try {
      const json = await apiFetch<{ items: NewsItem[]; provenance?: { note?: string } }>(
        `/api/feeds/search?q=${encodeURIComponent(term.trim())}`,
        { timeoutMs: 60_000 },
      );
      setLive(json.items ?? []);
      setSearchNote(json.provenance?.note ?? null);
    } catch {
      setLive([]);
      setSearchNote("The open search could not be reached. Showing the loaded feed only.");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query), 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, runSearch]);

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const i of [...live, ...items]) {
      const k = i.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(i);
    }
    return out;
  }, [live, items]);

  const ordered = useMemo(
    () =>
      [...merged].sort((a, b) => {
        const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return bt - at;
      }),
    [merged],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (i: NewsItem, skip?: "sector" | "category" | "company" | "tier") =>
      (skip === "sector" || sector === "All" || i.sector === sector) &&
      (skip === "category" || category === "All" || i.category === category) &&
      (skip === "company" || company === "All" || i.companies.includes(company)) &&
      (skip === "tier" || tierFilter === 0 || i.publisherTier <= tierFilter) &&
      (q.length === 0 ||
        i.title.toLowerCase().includes(q) ||
        i.publisher.toLowerCase().includes(q) ||
        i.companies.some((c) => c.toLowerCase().includes(q)));
  }, [query, sector, category, company, tierFilter]);

  const filtered = useMemo(() => ordered.filter((i) => matches(i)), [ordered, matches]);

  const countBy = useMemo(() => {
    const sectors = new Map<string, number>();
    const categories = new Map<string, number>();
    const companies = new Map<string, number>();
    const tiers = { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>;

    for (const i of ordered) {
      if (matches(i, "sector")) sectors.set(i.sector, (sectors.get(i.sector) ?? 0) + 1);
      if (matches(i, "category")) categories.set(i.category, (categories.get(i.category) ?? 0) + 1);
      if (matches(i, "company")) for (const c of i.companies) companies.set(c, (companies.get(c) ?? 0) + 1);
      if (matches(i, "tier")) tiers[i.publisherTier]++;
    }
    return { sectors, categories, companies, tiers };
  }, [ordered, matches]);

  const companyChips = useMemo(
    () =>
      [...countBy.companies.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 14),
    [countBy.companies],
  );

  const active =
    sector !== "All" || category !== "All" || company !== "All" || tierFilter !== 0 || query.trim().length > 0;

  const shown = expanded ? filtered : filtered.slice(0, limit);

  const clear = () => {
    setSector("All");
    setCategory("All");
    setCompany("All");
    setTierFilter(0);
    setQuery("");
  };

  return (
    <div>
      <div className="filter-bar">
        <div className="filter-search">
          <input
            className="input"
            type="search"
            value={query}
            maxLength={80}
            placeholder="Search headlines, publishers and companies"
            aria-label="Search coverage"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="filter-count t-small">
            {searching ? "Searching" : `${filtered.length} of ${merged.length}`}
          </span>
          {active && (
            <button type="button" className="btn btn-ghost filter-clear" onClick={clear}>
              Clear
            </button>
          )}
        </div>

        <FilterRow label="Sector">
          <Chip on={sector === "All"} onClick={() => setSector("All")}>All</Chip>
          {SECTORS.filter((s) => (countBy.sectors.get(s) ?? 0) > 0 || sector === s).map((s) => (
            <Chip key={s} on={sector === s} onClick={() => setSector(sector === s ? "All" : s)}>
              {s} ({countBy.sectors.get(s) ?? 0})
            </Chip>
          ))}
        </FilterRow>

        {companyChips.length > 0 && (
          <FilterRow label="Company">
            <Chip on={company === "All"} onClick={() => setCompany("All")}>All</Chip>
            {companyChips.map(([c, n]) => (
              <Chip key={c} on={company === c} onClick={() => setCompany(company === c ? "All" : c)}>
                {c} ({n})
              </Chip>
            ))}
          </FilterRow>
        )}

        <FilterRow label="Topic">
          <Chip on={category === "All"} onClick={() => setCategory("All")}>All</Chip>
          {[...countBy.categories.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <Chip key={c} on={category === c} onClick={() => setCategory(category === c ? "All" : c)}>
                {CATEGORY_LABEL[c] ?? c} ({n})
              </Chip>
            ))}
        </FilterRow>

        <FilterRow label="Sources">
          <Chip on={tierFilter === 0} onClick={() => setTierFilter(0)}>All</Chip>
          {([1, 2, 3] as const).map((t) =>
            countBy.tiers[t] > 0 || tierFilter === t ? (
              <Chip
                key={t}
                on={tierFilter === t}
                onClick={() => setTierFilter(tierFilter === t ? 0 : t)}
                title={`Tier ${t} and above`}
              >
                {TIER_LABEL[t]} ({countBy.tiers[t]})
              </Chip>
            ) : null,
          )}
        </FilterRow>
      </div>

      {searchNote && query.trim().length >= 2 && (
        <p className="t-small" style={{ padding: "10px 24px 0", margin: 0, fontSize: 12 }}>
          {searchNote}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing matches those filters</p>
          <p className="empty-body">
            {searching
              ? "Searching published coverage for this term."
              : "Clear one of them, or widen the search term."}
          </p>
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
                  <button
                    key={c}
                    type="button"
                    className="chip chip-static source-tag"
                    onClick={() => setCompany(company === c ? "All" : c)}
                    title={`Filter to ${c}`}
                  >
                    {c}
                  </button>
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
                <span className="source-tier-note">
                  {item.verified === false ? "Outside the reviewed list" : TIER_LABEL[item.publisherTier]}
                </span>
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

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-row">
      <span className="t-label filter-row-label">{label}</span>
      <div className="filter-row-chips">{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="chip"
      data-active={on}
      aria-pressed={on}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
