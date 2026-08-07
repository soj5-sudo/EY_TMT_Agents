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
import { REGIONS, SECTORS, THEME_LABELS as THEME_LABEL } from "@/lib/data/universe";
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

interface PeerRow {
  name: string;
  segment: string;
  vertical: string;
  headquarters: string;
  revenue: number | null;
  period: string;
}

interface SectorPayload {
  rows: SectorRow[];
  peers: PeerRow[];
  peersTakenAt: string;
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

const LEGAL =
  /\s+(plc|inc|ltd|limited|holdings?|corporation|corp|company|co|sa|se|nv|ag|spa|group|technologies|technology|solutions|systems|international)\b\.?/gi;

function nameKey(name: string): string {
  return name.toLowerCase().replace(LEGAL, "").replace(/[^a-z0-9]/g, "");
}

/** A workbook row and a filed row are the same company when one name contains the other. */
function isHeld(held: Set<string>, key: string): boolean {
  if (key.length < 3) return false;
  if (held.has(key)) return true;
  for (const k of held) {
    if (k.length < 3) continue;
    if (k.startsWith(key) || key.startsWith(k)) return true;
  }
  return false;
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
  const [region, setRegion] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [segment, setSegment] = useState("IT services");
  const [withPeers, setWithPeers] = useState(true);

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

  const selected = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => sector === "All" || r.sector === sector)
        .filter((r) => region === "All" || r.region === region),
    [data, sector, region],
  );

  const rows = useMemo(
    () =>
      selected
        .filter((r) => r.revenue !== null)
        .sort((a, b) => (b[sortKey] ?? -1e18) - (a[sortKey] ?? -1e18)),
    [selected, sortKey],
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

  const themeCountSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of selected) {
      for (const t of r.themes) {
        const label = (THEME_LABEL as Record<string, string>)[t] ?? t;
        map.set(label, (map.get(label) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [selected]);

  const themePlacements = themeCountSlices.reduce((s, x) => s + x.value, 0);

  const subsectorCountSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of selected) map.set(r.subsector, (map.get(r.subsector) ?? 0) + 1);
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [selected]);

  const segments = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data?.rows ?? []) map.set(r.subsector, (map.get(r.subsector) ?? 0) + 1);
    if (withPeers) {
      for (const p of data?.peers ?? []) map.set(p.segment, (map.get(p.segment) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [data, withPeers]);

  const stakes = useMemo(() => {
    const filed = (data?.rows ?? [])
      .filter((r) => r.subsector === segment && r.revenue !== null)
      .map((r) => ({
        name: r.name,
        revenue: r.revenue as number,
        period: r.period ?? "Not stated",
        home: r.region,
        origin: r.source === "sec" ? "Filed with the SEC" : "Published by the company",
      }));

    const held = new Set(
      (data?.rows ?? [])
        .filter((r) => r.subsector === segment && r.revenue !== null)
        .flatMap((r) => [nameKey(r.name), nameKey(r.short)]),
    );
    const extra = !withPeers
      ? []
      : (data?.peers ?? [])
          .filter((p) => p.segment === segment && p.revenue !== null)
          .filter((p) => !isHeld(held, nameKey(p.name)))
          .map((p) => ({
            name: p.name,
            revenue: p.revenue as number,
            period: p.period,
            home: p.headquarters,
            origin: "Peer workbook",
          }));

    return [...filed, ...extra].sort((a, b) => b.revenue - a.revenue);
  }, [data, segment, withPeers]);

  const stakeTotal = stakes.reduce((s, x) => s + x.revenue, 0);

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

            <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
              <div className="filter-row">
                <span className="t-label filter-row-label">Sector</span>
                <div className="filter-row-chips">
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
                      {s !== "All" && (
                        <span className="chip-count">
                          {(data?.rows ?? []).filter((r) => r.sector === s && (region === "All" || r.region === region)).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-row">
                <span className="t-label filter-row-label">Region</span>
                <div className="filter-row-chips">
                  {["All", ...REGIONS].map((rg) => (
                    <button
                      key={rg}
                      type="button"
                      className="chip"
                      data-active={region === rg}
                      onClick={() => setRegion(rg)}
                      aria-pressed={region === rg}
                    >
                      {rg}
                      {rg !== "All" && (
                        <span className="chip-count">
                          {(data?.rows ?? []).filter((r) => r.region === rg && (sector === "All" || r.sector === sector)).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
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

            <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
              <Panel
                title="Companies by segment"
                hint="Every tracked name counted once, including those whose figures are not public."
                actions={<Prov p={data.provenance} />}
              >
                <Donut
                  slices={subsectorCountSlices}
                  total={selected.length}
                  totalLabel="Companies"
                  format={(v) => `${v}`}
                  caption="Counts the coverage universe rather than its revenue, so a small company weighs the same as a large one."
                />
              </Panel>

              <Panel
                title="Companies by theme"
                hint="A company carrying several themes is counted against each, so the total exceeds the number of names."
                actions={<Prov p={data.provenance} />}
              >
                <Donut
                  slices={themeCountSlices}
                  total={themePlacements}
                  totalLabel="Theme positions"
                  format={(v) => `${v}`}
                  caption={`${selected.length} companies across ${themeCountSlices.length} themes. Exposure is assigned from what each company sells, not from what it says about itself.`}
                />
              </Panel>
            </div>

            <Panel
              title="Share by company"
              hint="One segment at a time, every name in it, sized by revenue. Select a segment."
              actions={<Prov p={data.provenance} />}
            >
              <div style={{ display: "grid", gap: 18 }}>
                <div className="filter-bar" style={{ padding: 0, border: 0, gap: 8 }}>
                  <div className="filter-row">
                    <span className="t-label filter-row-label">Segment</span>
                    <div className="filter-row-chips">
                      {segments.map((s) => (
                        <button
                          key={s.name}
                          type="button"
                          className="chip"
                          data-active={segment === s.name}
                          aria-pressed={segment === s.name}
                          onClick={() => setSegment(s.name)}
                        >
                          {s.name}
                          <span className="chip-count">{s.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="filter-row">
                    <span className="t-label filter-row-label">Set</span>
                    <div className="filter-row-chips">
                      <button
                        type="button"
                        className="chip"
                        data-active={!withPeers}
                        aria-pressed={!withPeers}
                        onClick={() => setWithPeers(false)}
                      >
                        Filed record only
                      </button>
                      <button
                        type="button"
                        className="chip"
                        data-active={withPeers}
                        aria-pressed={withPeers}
                        onClick={() => setWithPeers(true)}
                      >
                        With the peer workbook
                        <span className="chip-count">{data.peers.length}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}
                >
                  <Donut
                    slices={stakes.map((s) => ({ label: s.name, value: s.revenue }))}
                    total={stakeTotal}
                    totalLabel={`${segment} revenue`}
                    format={(v) => bn(v)}
                    caption={`${stakes.length} companies in ${segment}. Each company is on its own last reported period, named in the table, so this is the shape of the segment rather than a market total for one year.`}
                  />

                  <div className="table-scroll">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Company</th>
                          <th className="num">Revenue</th>
                          <th className="num">Share</th>
                          <th>Period</th>
                          <th>Read from</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stakes.map((s, i) => (
                          <tr key={`${s.name}-${i}`}>
                            <td className="tnum">{i + 1}</td>
                            <td>
                              {s.name}
                              <span className="cmp-period"> {s.home}</span>
                            </td>
                            <td className="num tnum">{bn(s.revenue)}</td>
                            <td className="num tnum">
                              {stakeTotal > 0 ? `${((s.revenue / stakeTotal) * 100).toFixed(1)}%` : <NotSet />}
                            </td>
                            <td className="t-small">{s.period}</td>
                            <td className="t-small">{s.origin}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <p className="t-small" style={{ margin: 0, fontSize: 12 }}>
                  Companies in the coverage universe carry figures computed on this request from what they
                  filed or published. The rest come from the peer workbook taken{" "}
                  {data.peersTakenAt.slice(0, 10)}, on the period each row names. A company appearing in both
                  is counted once, on its filed figure.
                </p>
              </div>
            </Panel>

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
                        <td className="num">{r.grossMargin !== null ? `${r.grossMargin.toFixed(1)}%` : <NotSet />}</td>
                        <td className="num">{r.operatingMargin !== null ? `${r.operatingMargin.toFixed(1)}%` : <NotSet />}</td>
                        <td className="num">{r.netMargin !== null ? `${r.netMargin.toFixed(1)}%` : <NotSet />}</td>
                        <td className="num">{r.rndIntensity !== null ? `${r.rndIntensity.toFixed(1)}%` : <NotSet />}</td>
                        <td className="num">
                          <span className="t-small" style={{ fontSize: 11 }}>{r.period ?? "Not stated"}</span>
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
