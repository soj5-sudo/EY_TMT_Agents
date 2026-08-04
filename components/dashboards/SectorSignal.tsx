"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
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
import { SECTORS, THEME_LABELS, type Theme } from "@/lib/data/universe";
import type { NewsItem, Provenance, Quote } from "@/lib/core/types";

interface QuoteRow {
  symbol: string;
  short: string;
  name: string;
  sector: string;
  subsector: string | null;
  region: string;
  themes: Theme[];
  quote: Quote | null;
  error: string | null;
}

interface MarketsPayload {
  quotes: QuoteRow[];
  series?: Array<{
    symbol: string;
    label: string;
    points: Array<{ t: number; v: number }>;
    error: string | null;
  }>;
  provenance: Provenance;
}

interface NewsPayload {
  items: NewsItem[];
  stats: { seen: number; rejected: number; kept: number; failedTopics: number };
  topics: Array<{ id: string; label: string; sector: string }>;
  provenance: Provenance;
}

export function SectorSignal() {
  const [markets, setMarkets] = useState<MarketsPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string>("All");
  const [openTheme, setOpenTheme] = useState<Theme | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setMarketsError(null);
    setNewsError(null);

    const [m, n] = await Promise.allSettled([
      fetch("/api/feeds/markets?series=1&range=1y").then((r) => r.json()),
      fetch("/api/feeds/news").then((r) => r.json()),
    ]);

    if (m.status === "fulfilled" && m.value?.quotes) setMarkets(m.value);
    else
      setMarketsError(
        m.status === "rejected"
          ? String(m.reason)
          : (m.value?.provenance?.note ?? "Market feed did not respond."),
      );

    if (n.status === "fulfilled" && Array.isArray(n.value?.items)) {
      setNews(n.value);
      if (n.value.items.length === 0) {
        setNewsError(n.value?.provenance?.note ?? "No verified coverage returned.");
      }
    } else {
      setNewsError(
        n.status === "rejected"
          ? String(n.reason)
          : (n.value?.provenance?.note ?? "Coverage feed did not respond."),
      );
    }

    setRefreshedAt(new Date().toISOString());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const quotes = markets?.quotes ?? [];
  const indices = quotes.filter((q) => q.sector === "Index");
  const companies = quotes.filter((q) => q.sector !== "Index");

  const filteredCompanies = useMemo(
    () =>
      sectorFilter === "All"
        ? companies
        : companies.filter((c) => c.sector === sectorFilter),
    [companies, sectorFilter],
  );

  const itIndex = indices.find((i) => i.symbol === "^CNXIT")?.quote ?? null;
  const ndx = indices.find((i) => i.symbol === "^NDX")?.quote ?? null;
  const sox = indices.find((i) => i.symbol === "^SOX")?.quote ?? null;

  const series = useMemo(
    () =>
      (markets?.series ?? [])
        .filter((s) => s.points.length > 0)
        .map((s) => ({ key: s.symbol, label: s.label, points: s.points })),
    [markets],
  );

  // Average day move across the names carrying each theme.
  const themeMoves = useMemo(() => {
    const acc = new Map<Theme, { sum: number; n: number }>();
    for (const c of companies) {
      const change = c.quote?.changePct;
      if (change === null || change === undefined) continue;
      for (const t of c.themes) {
        const held = acc.get(t) ?? { sum: 0, n: 0 };
        held.sum += change;
        held.n++;
        acc.set(t, held);
      }
    }
    return [...acc.entries()]
      .map(([theme, v]) => ({ theme, avg: v.sum / v.n, n: v.n }))
      .sort((a, b) => b.avg - a.avg);
  }, [companies]);

  const resolved = companies.filter((c) => c.quote).length;

  const THEME_TOPIC: Partial<Record<Theme, string>> = {
    "ai-compute": "ai-infra",
    "ai-agents": "ai-agents",
    "physical-ai": "physical-ai",
    "ai-software": "ai-agents",
    cloud: "ai-infra",
    "digital-transformation": "services",
    connectivity: "telecom",
    streaming: "media",
  };

  return (
    <div className="shell">
      <PageHeader
        index="01"
        title="Sector signal"
        lede="Technology, media and telecom. Coverage runs across the listed universe and nine standing queries, filtered to a verified publisher set. Category labels are keyword assigned and marked as such."
        meta={
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {refreshedAt && (
              <span className="prov" data-kind={refreshing ? "cached" : "live"}>
                {refreshing ? "Refreshing" : "Refreshed"}{" "}
                {new Date(refreshedAt).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={load}
              disabled={refreshing}
              data-loading={refreshing}
              style={{ minHeight: 34, padding: "8px 16px" }}
            >
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        }
      />

      <Stack gap={32}>
        <StatRow>
          <StatBlock
            label="Nasdaq 100"
            value={ndx ? ndx.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : <NotSet />}
            sub={ndx ? <><Delta value={ndx.changePct} /> on the day</> : "Feed unavailable"}
            emphasis
          />
          <StatBlock
            label="PHLX Semiconductor"
            value={sox ? sox.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : <NotSet />}
            sub={sox ? <><Delta value={sox.changePct} /> on the day</> : "Feed unavailable"}
          />
          <StatBlock
            label="Nifty IT"
            value={itIndex ? itIndex.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : <NotSet />}
            sub={itIndex ? <><Delta value={itIndex.changePct} /> on the day</> : "Feed unavailable"}
          />
          <StatBlock
            label="Names resolved"
            value={markets ? `${resolved}/${companies.length}` : <NotSet />}
            sub="Live quotes this refresh"
          />
          <StatBlock
            label="Verified coverage"
            value={news ? String(news.items.length) : <NotSet />}
            sub={news ? `${news.stats.rejected} unlisted publishers discarded` : "Last ten days"}
          />
        </StatRow>

        {marketsError && (
          <div className="notice" data-kind="error">Market feed: {marketsError}</div>
        )}

        <Panel
          title="Relative performance, rebased to 100"
          hint="Each series starts at 100 so names priced in different currencies share one axis. Toggle a name in the legend to remove it and rescale."
          actions={markets && <Prov p={markets.provenance} />}
        >
          {series.length > 0 ? (
            <LineChart
              series={series}
              baselineAt={100}
              valueFormat={(v) => v.toFixed(0)}
              caption="Weekly closes over one year, adjusted for splits and dividends."
            />
          ) : refreshing ? (
            <div className="skel" style={{ height: 280 }} />
          ) : (
            <div className="empty">
              <p className="empty-title">Price history did not load</p>
              <p className="empty-body">
                The series endpoint returned no usable closes. Use refresh to retry.
              </p>
            </div>
          )}
        </Panel>

        {themeMoves.length > 0 && (
          <Panel
            title="Theme exposure, today"
            hint="Average day move across the names carrying each theme. Select a theme to see its constituents and the current coverage on it. A read on which part of the cycle is being paid for, not a portfolio return."
            actions={markets && <Prov p={markets.provenance} />}
          >
            <div className="theme-grid">
              {themeMoves.map((t) => {
                const open = openTheme === t.theme;
                const members = companies
                  .filter((c) => c.themes.includes(t.theme) && c.quote)
                  .sort((a, b) => (b.quote!.changePct ?? 0) - (a.quote!.changePct ?? 0));
                const topicId = THEME_TOPIC[t.theme];
                const related = topicId
                  ? (news?.items ?? []).filter((n) => n.topic === topicId).slice(0, 3)
                  : [];
                return (
                  <div key={t.theme}>
                    <button
                      type="button"
                      className="theme-row theme-row-btn"
                      aria-expanded={open}
                      onClick={() => setOpenTheme(open ? null : t.theme)}
                    >
                      <span className="theme-name">{THEME_LABELS[t.theme]}</span>
                      <span className="theme-count">{t.n} names</span>
                      <span className="theme-bar" aria-hidden="true">
                        <span
                          className="theme-fill"
                          data-up={t.avg >= 0}
                          style={{ width: `${Math.min(50, Math.abs(t.avg) * 14)}%` }}
                        />
                      </span>
                      <span className="theme-val tnum">
                        <Delta value={t.avg} digits={2} />
                      </span>
                    </button>
                    {open && (
                      <div className="theme-expand">
                        <div className="theme-members">
                          {members.map((c) => (
                            <span key={c.symbol} className="theme-member">
                              <span>{c.short}</span>
                              <Delta value={c.quote!.changePct} digits={2} />
                            </span>
                          ))}
                        </div>
                        {related.length > 0 && (
                          <div className="theme-news">
                            <span className="t-label" style={{ fontSize: 10 }}>
                              Coverage on this theme
                            </span>
                            {related.map((n) => (
                              <a
                                key={n.id}
                                href={n.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="theme-news-item"
                              >
                                {n.title}
                                <span className="t-small" style={{ fontSize: 11 }}>
                                  {" "}· {n.publisher}
                                  {n.publishedAt
                                    ? `, ${new Date(n.publishedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}`
                                    : ""}
                                </span>
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
        )}

        <Panel
          title="Coverage universe"
          hint="Every listed name tracked, with its position in the annual range."
          actions={
            <div style={{ display: "flex", gap: 6 }}>
              {["All", ...SECTORS].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  data-active={sectorFilter === s}
                  onClick={() => setSectorFilter(s)}
                  aria-pressed={sectorFilter === s}
                >
                  {s}
                </button>
              ))}
            </div>
          }
          flush
        >
          {refreshing && !markets ? (
            <div style={{ padding: 24, display: "grid", gap: 8 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skel" style={{ height: 30 }} />
              ))}
            </div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Segment</th>
                    <th scope="col" className="num">Last</th>
                    <th scope="col" className="num">Day</th>
                    <th scope="col" className="num">52w position</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.map((row) => {
                    const q = row.quote;
                    const pos =
                      q && q.fiftyTwoWeekHigh !== null && q.fiftyTwoWeekLow !== null
                        ? ((q.price - q.fiftyTwoWeekLow) /
                            (q.fiftyTwoWeekHigh - q.fiftyTwoWeekLow || 1)) * 100
                        : null;
                    return (
                      <tr key={row.symbol}>
                        <th scope="row" className="tbl-rowhead">
                          {row.short}
                          <span className="t-small" style={{ fontSize: 11 }}>
                            {" "}
                            · {row.symbol}
                          </span>
                        </th>
                        <td>
                          <span className="t-small" style={{ fontSize: 12 }}>
                            {row.subsector ?? row.sector}
                          </span>
                        </td>
                        <td className="num">
                          {q ? q.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : <NotSet />}
                        </td>
                        <td className="num">
                          {q ? <Delta value={q.changePct} digits={2} /> : <NotSet />}
                        </td>
                        <td className="num">
                          {pos === null ? (
                            <NotSet />
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span className="range-track" aria-hidden="true">
                                <span
                                  className="range-mark"
                                  style={{ left: `${Math.max(0, Math.min(100, pos))}%` }}
                                />
                              </span>
                              {pos.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Sector coverage"
          hint="Headlines are third-party reporting, reproduced and not verified. Only outlets on the publisher allowlist are ingested."
          actions={news && <Prov p={news.provenance} />}
          flush
        >
          {newsError && (
            <div style={{ padding: 24 }}>
              <div className="notice" data-kind="error">{newsError}</div>
            </div>
          )}
          {!news && !newsError && (
            <div style={{ padding: 24, display: "grid", gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skel" style={{ height: 46 }} />
              ))}
            </div>
          )}
          {news && news.items.length > 0 && <SourceList items={news.items} />}
        </Panel>
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
