"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Donut } from "@/components/charts/Donut";
import { SourceList } from "@/components/ui/SourceList";
import {
  Delta,
  NotSet,
  PageHeader,
  Panel,
  Prov,
  Stack,
  StatBlock,
  StatRow,
} from "@/components/ui/Bits";
import { SECTORS } from "@/lib/data/universe";
import { apiFetch } from "@/lib/client/api";
import type { NewsItem, Provenance } from "@/lib/core/types";

interface SectorRow {
  symbol: string;
  short: string;
  name: string;
  sector: string;
  subsector: string;
  region: string;
  themes: string[];
  period: string | null;
  revenue: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  rndIntensity: number | null;
  cashConversion: number | null;
  revenueGrowthPct: number | null;
  lastFiled: string | null;
  source: "sec" | "ir" | null;
}

interface ThemeAgg {
  theme: string;
  label: string;
  count: number;
  revenue: number;
  medianGrowth: number | null;
  medianOperatingMargin: number | null;
  members: Array<{ short: string; growth: number | null; margin: number | null }>;
}

interface SectorPayload {
  rows: SectorRow[];
  subsectors: Array<{
    name: string;
    count: number;
    revenue: number;
    medianOperatingMargin: number | null;
    medianGrowth: number | null;
  }>;
  themes: ThemeAgg[];
  coverage: { total: number; withData: number };
  provenance: Provenance;
  lastFiled: string | null;
}

interface NewsPayload {
  items: NewsItem[];
  stats: { seen: number; rejected: number; kept: number; failedTopics: number };
  provenance: Provenance;
}

function bn(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}tn`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}m`;
  return v.toLocaleString("en-US");
}

type SortKey = "revenue" | "revenueGrowthPct" | "operatingMargin" | "rndIntensity";

export function SectorSignal() {
  const [data, setData] = useState<SectorPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [sector, setSector] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [openTheme, setOpenTheme] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNewsError(null);

    const [s, n] = await Promise.allSettled([
      apiFetch<SectorPayload>("/api/sector", { timeoutMs: 280_000 }),
      apiFetch<NewsPayload>("/api/feeds/news", { timeoutMs: 90_000 }),
    ]);

    if (s.status === "fulfilled") setData(s.value);
    else setError(s.reason instanceof Error ? s.reason.message : String(s.reason));

    if (n.status === "fulfilled" && Array.isArray(n.value.items)) setNews(n.value);
    else setNewsError(n.status === "rejected" ? String(n.reason) : "Coverage feed did not respond.");

    setBusy(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => sector === "All" || r.sector === sector)
        .filter((r) => r.revenue !== null)
        .sort((a, b) => (b[sortKey] ?? -1e18) - (a[sortKey] ?? -1e18)),
    [data, sector, sortKey],
  );

  const totalRevenue = rows.reduce((s, r) => s + (r.revenue ?? 0), 0);

  const subsectorSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.subsector, (map.get(r.subsector) ?? 0) + (r.revenue ?? 0));
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }, [rows]);

  const regionSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.region, (map.get(r.region) ?? 0) + (r.revenue ?? 0));
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }, [rows]);

  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const medMargin = median(rows.map((r) => r.operatingMargin).filter((v): v is number => v !== null));
  const medGrowth = median(rows.map((r) => r.revenueGrowthPct).filter((v): v is number => v !== null));

  return (
    <div className="shell">
      <PageHeader
        index="01"
        title="Sector signal"
        lede="Technology, media and telecom, measured on what the companies filed rather than what their shares did today. Revenue, margin, growth and research intensity across the coverage universe, from the regulator's own record and the companies' published documents."
        meta={
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {data && <Prov p={data.provenance} />}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={load}
              disabled={busy}
              data-loading={busy}
              style={{ minHeight: 34, padding: "8px 16px" }}
            >
              {busy ? "Refreshing" : "Refresh"}
            </button>
          </div>
        }
      />

      <Stack gap={32}>
        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && !data && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skel" style={{ height: 96 }} />
            <div className="skel" style={{ height: 300 }} />
          </div>
        )}

        {data && (
          <>
            <StatRow>
              <StatBlock
                label="Coverage revenue"
                value={bn(totalRevenue)}
                sub={`USD, ${rows.length} names with filed financials`}
                emphasis
              />
              <StatBlock
                label="Median operating margin"
                value={medMargin !== null ? `${medMargin.toFixed(1)}%` : <NotSet />}
                sub="Across the selection"
              />
              <StatBlock
                label="Median revenue growth"
                value={medGrowth !== null ? <Delta value={medGrowth} /> : <NotSet />}
                sub="Compound annual, from filings"
              />
              <StatBlock
                label="Names covered"
                value={`${data.coverage.withData}/${data.coverage.total}`}
                sub="Reported financials resolved"
              />
              <StatBlock
                label="Most recent filing"
                value={data.lastFiled ?? <NotSet />}
                sub="Newest document in the set"
              />
            </StatRow>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="t-label" style={{ fontSize: 10 }}>Sector</span>
              {["All", ...SECTORS].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  data-active={sector === s}
                  onClick={() => setSector(s)}
                  aria-pressed={sector === s}
                >
                  {s}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
              <Panel
                title="Revenue by segment"
                hint="Where the revenue in the selection actually sits."
                actions={<Prov p={data.provenance} />}
              >
                <Donut
                  slices={subsectorSlices}
                  total={totalRevenue}
                  totalLabel="Coverage revenue"
                  format={(v) => bn(v)}
                  caption="Latest reported full year for each company. Non-SEC filers are annualised from their published quarterly."
                />
              </Panel>

              <Panel
                title="Revenue by region of listing"
                hint="Where the companies are listed, not where the revenue is earned."
                actions={<Prov p={data.provenance} />}
              >
                <Donut
                  slices={regionSlices}
                  total={totalRevenue}
                  totalLabel="Coverage revenue"
                  format={(v) => bn(v)}
                  caption="Region reflects the listing venue. Geographic revenue split is on the KPI dashboard where a company discloses it."
                />
              </Panel>
            </div>

            <Panel
              title="Theme exposure, on fundamentals"
              hint="Median growth and margin across the companies carrying each theme. Select a theme for its constituents and current coverage."
              actions={<Prov p={data.provenance} />}
            >
              <div className="theme-grid">
                {data.themes.map((t) => {
                  const open = openTheme === t.theme;
                  const related = (news?.items ?? [])
                    .filter((n) =>
                      t.members.some((m) => n.companies.includes(m.short)),
                    )
                    .slice(0, 3);
                  return (
                    <div key={t.theme}>
                      <button
                        type="button"
                        className="theme-row theme-row-btn"
                        aria-expanded={open}
                        onClick={() => setOpenTheme(open ? null : t.theme)}
                      >
                        <span className="theme-name">{t.label}</span>
                        <span className="theme-count">{t.count} names · {bn(t.revenue)}</span>
                        <span className="theme-bar" aria-hidden="true">
                          <span
                            className="theme-fill"
                            data-up={(t.medianGrowth ?? 0) >= 0}
                            style={{ width: `${Math.min(50, Math.abs(t.medianGrowth ?? 0) * 1.4)}%` }}
                          />
                        </span>
                        <span className="theme-val tnum">
                          {t.medianGrowth !== null ? <Delta value={t.medianGrowth} /> : <NotSet />}
                        </span>
                      </button>
                      {open && (
                        <div className="theme-expand">
                          <div className="theme-members">
                            {t.members.map((m) => (
                              <span key={m.short} className="theme-member">
                                <span>{m.short}</span>
                                {m.growth !== null ? <Delta value={m.growth} digits={1} /> : <NotSet />}
                              </span>
                            ))}
                          </div>
                          <p className="t-small" style={{ fontSize: 12 }}>
                            Median operating margin{" "}
                            {t.medianOperatingMargin !== null
                              ? `${t.medianOperatingMargin.toFixed(1)} percent`
                              : "not reported"}
                            . Growth is the compound annual rate from each company&apos;s filed history.
                          </p>
                          {related.length > 0 && (
                            <div className="theme-news">
                              <span className="t-label" style={{ fontSize: 10 }}>Coverage</span>
                              {related.map((n) => (
                                <a
                                  key={n.id}
                                  href={n.url}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  className="theme-news-item"
                                >
                                  {n.title}
                                  <span className="t-small" style={{ fontSize: 11 }}> · {n.publisher}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="Coverage universe"
              hint="Every name with filed financials. Sort by any measure."
              actions={
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {([
                    ["revenue", "Revenue"],
                    ["revenueGrowthPct", "Growth"],
                    ["operatingMargin", "Margin"],
                    ["rndIntensity", "R&D"],
                  ] as Array<[SortKey, string]>).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className="chip"
                      data-active={sortKey === k}
                      onClick={() => setSortKey(k)}
                      aria-pressed={sortKey === k}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
              flush
            >
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Segment</th>
                      <th scope="col" className="num">Revenue</th>
                      <th scope="col" className="num">Growth</th>
                      <th scope="col" className="num">Gross</th>
                      <th scope="col" className="num">Operating</th>
                      <th scope="col" className="num">Net</th>
                      <th scope="col" className="num">R&D</th>
                      <th scope="col" className="num">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.symbol}>
                        <th scope="row" className="tbl-rowhead">
                          {r.short}
                          <span className="t-small" style={{ fontSize: 11 }}> · {r.symbol}</span>
                        </th>
                        <td>
                          <span className="t-small" style={{ fontSize: 12 }}>{r.subsector}</span>
                        </td>
                        <td className="num">{r.revenue !== null ? bn(r.revenue) : <NotSet />}</td>
                        <td className="num">
                          {r.revenueGrowthPct !== null ? <Delta value={r.revenueGrowthPct} /> : <NotSet />}
                        </td>
                        <td className="num">{r.grossMargin !== null ? `${r.grossMargin.toFixed(1)}%` : "n/a"}</td>
                        <td className="num">{r.operatingMargin !== null ? `${r.operatingMargin.toFixed(1)}%` : "n/a"}</td>
                        <td className="num">{r.netMargin !== null ? `${r.netMargin.toFixed(1)}%` : "n/a"}</td>
                        <td className="num">{r.rndIntensity !== null ? `${r.rndIntensity.toFixed(1)}%` : "n/a"}</td>
                        <td className="num">
                          <span className="t-small" style={{ fontSize: 11 }}>{r.period ?? "n/a"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Sector coverage"
              hint="Headlines are third-party reporting. Only outlets on the publisher allowlist are ingested."
              actions={news && <Prov p={news.provenance} />}
              flush
            >
              {newsError && (
                <div style={{ padding: 24 }}>
                  <div className="notice" data-kind="error">{newsError}</div>
                </div>
              )}
              {news && news.items.length > 0 && <SourceList items={news.items} />}
            </Panel>
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
