"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComboChart } from "@/components/charts/ComboChart";
import { Waterfall } from "@/components/charts/Waterfall";
import { CompanyPicker } from "@/components/ui/CompanyPicker";
import { Delta, NotSet, PageHeader, Panel, Prov, Stack, StatBlock, StatRow } from "@/components/ui/Bits";
import { apiFetch } from "@/lib/client/api";
import type { NewsItem, Provenance } from "@/lib/core/types";

interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: "USD" | "percent" | "count" | "days" | "ratio";
  prior: number | null;
  priorLabel: string | null;
  basis: string;
  how: string;
}

interface Period {
  label: string;
  end: string;
  values: Record<string, number | undefined>;
}

interface CallQuote {
  speaker: string;
  role: string;
  text: string;
  topic: string;
}

interface View {
  company: {
    symbol: string;
    name: string;
    short: string;
    sector: string;
    subsector: string;
    region: string;
    currency: string;
    filesWithSec: boolean;
  };
  basis: "quarterly" | "annual";
  periodsPerYear: number;
  latest: Period | null;
  priorYear: Period | null;
  periods: Period[];
  annual: Period[];
  kpis: Kpi[];
  perEmployee: Kpi[];
  operating: Kpi[];
  call: {
    quarter: string;
    callDate: string;
    transcriptUrl: string;
    transcriptTitle: string;
    quotes: CallQuote[];
  } | null;
  sources: Array<{ title: string; url: string; kind: string }>;
  provenance: Provenance | null;
  unavailable: string | null;
  readAt?: string;
}

interface Feed {
  items: NewsItem[];
  provenance: Provenance;
}

const TABS = [
  { id: "kpis", label: "KPIs" },
  { id: "pnl", label: "Profit and loss" },
  { id: "people", label: "Per employee" },
  { id: "deals", label: "M&A" },
  { id: "news", label: "Developments" },
  { id: "call", label: "Call trends" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const PNL_ROWS: Array<{ key: string; label: string; subtotal?: boolean; indent?: boolean }> = [
  { key: "revenue", label: "Revenue", subtotal: true },
  { key: "costOfRevenue", label: "Cost of revenue", indent: true },
  { key: "grossProfit", label: "Gross profit", subtotal: true },
  { key: "rnd", label: "Research and development", indent: true },
  { key: "sga", label: "Selling, general and administrative", indent: true },
  { key: "operatingIncome", label: "Operating income", subtotal: true },
  { key: "pretaxIncome", label: "Income before tax", subtotal: true },
  { key: "taxExpense", label: "Income tax expense", indent: true },
  { key: "netIncome", label: "Net income", subtotal: true },
];

function money(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}m`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function show(k: Kpi): string {
  if (k.value === null || !Number.isFinite(k.value)) return "";
  if (k.unit === "USD") return money(k.value);
  if (k.unit === "percent") return `${k.value.toFixed(1)}%`;
  if (k.unit === "days") return `${k.value.toFixed(0)} days`;
  if (k.unit === "count") return Math.round(k.value).toLocaleString("en-US");
  return k.value.toFixed(2);
}

function moveOf(k: Kpi): number | null {
  if (k.value === null || k.prior === null || k.prior === 0) return null;
  if (k.unit === "percent") return k.value - k.prior;
  return ((k.value - k.prior) / Math.abs(k.prior)) * 100;
}

function KpiGrid({ items }: { items: Kpi[] }) {
  const shown = items.filter((k) => k.value !== null && Number.isFinite(k.value));
  const absent = items.filter((k) => k.value === null || !Number.isFinite(k.value));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="kpi-grid">
        {shown.map((k) => {
          const move = moveOf(k);
          return (
            <div key={k.key} className="kpi-card">
              <span className="t-label kpi-card-label">{k.label}</span>
              <span className="kpi-card-value tnum">{show(k)}</span>
              <span className="kpi-card-move">
                {move === null ? (
                  <span className="t-small">{k.basis || "No comparable period"}</span>
                ) : (
                  <>
                    <Delta value={move} suffix={k.unit === "percent" ? " pts" : "%"} />{" "}
                    <span className="t-small">on {k.priorLabel}</span>
                  </>
                )}
              </span>
              <span className="t-small kpi-card-how">{k.how}</span>
            </div>
          );
        })}
      </div>

      {absent.length > 0 && (
        <p className="t-small" style={{ margin: 0, fontSize: 11.5 }}>
          Not published for this company: {absent.map((k) => k.label.toLowerCase()).join(", ")}.
        </p>
      )}
    </div>
  );
}

export function CompanyDashboard() {
  const [symbol, setSymbol] = useState("TCS.NS");
  const [tab, setTab] = useState<TabId>("kpis");
  const [data, setData] = useState<View | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deals, setDeals] = useState<Feed | null>(null);
  const [news, setNews] = useState<Feed | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);

  const load = useCallback(async (sym: string) => {
    setBusy(true);
    setError(null);
    setDeals(null);
    setNews(null);
    try {
      const json = await apiFetch<View>(`/api/company?company=${encodeURIComponent(sym)}`, {
        timeoutMs: 175_000,
      });
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(symbol);
  }, [symbol, load]);

  const name = data?.company.name ?? "";

  const loadFeed = useCallback(
    async (kind: "deals" | "news") => {
      if (!name) return;
      setFeedBusy(true);
      const q = kind === "deals" ? `${name} acquisition OR merger OR stake` : name;
      try {
        const json = await apiFetch<Feed>(`/api/feeds/search?q=${encodeURIComponent(q)}`, {
          timeoutMs: 90_000,
        });
        if (kind === "deals") setDeals(json);
        else setNews(json);
      } catch {
      } finally {
        setFeedBusy(false);
      }
    },
    [name],
  );

  useEffect(() => {
    if (tab === "deals" && !deals && name) loadFeed("deals");
    if (tab === "news" && !news && name) loadFeed("news");
  }, [tab, deals, news, name, loadFeed]);

  const periods = data?.periods ?? [];

  const revenueChart = useMemo(
    () =>
      periods
        .filter((p) => p.values.revenue)
        .map((p) => {
          const rev = p.values.revenue as number;
          const op = p.values.operatingIncome ?? p.values.netIncome;
          return op === undefined
            ? null
            : { label: p.label.replace(" FY", " "), bar: rev / 1e9, line: (op / rev) * 100 };
        })
        .filter((d): d is { label: string; bar: number; line: number } => d !== null),
    [periods],
  );

  const bridge = useMemo(() => {
    const v = data?.latest?.values;
    if (!v || v.revenue === undefined) return [];
    const steps: Array<{ label: string; value: number; kind: "total" | "deduction" | "addition" }> = [
      { label: "Revenue", value: v.revenue / 1e9, kind: "total" },
    ];
    if (v.costOfRevenue !== undefined) {
      steps.push({ label: "Cost of revenue", value: v.costOfRevenue / 1e9, kind: "deduction" });
      steps.push({
        label: "Gross profit",
        value: (v.grossProfit ?? v.revenue - v.costOfRevenue) / 1e9,
        kind: "total",
      });
    }
    if (v.rnd !== undefined) steps.push({ label: "R&D", value: v.rnd / 1e9, kind: "deduction" });
    if (v.sga !== undefined) steps.push({ label: "SG&A", value: v.sga / 1e9, kind: "deduction" });
    if (v.operatingIncome !== undefined)
      steps.push({ label: "Operating income", value: v.operatingIncome / 1e9, kind: "total" });
    if (v.taxExpense !== undefined) steps.push({ label: "Tax", value: v.taxExpense / 1e9, kind: "deduction" });
    if (v.netIncome !== undefined) steps.push({ label: "Net income", value: v.netIncome / 1e9, kind: "total" });
    return steps;
  }, [data]);

  const headline = data?.kpis.find((k) => k.key === "revenue") ?? null;
  const growth = data?.kpis.find((k) => k.key === "revenueGrowth") ?? null;
  const opMargin = data?.kpis.find((k) => k.key === "operatingMargin") ?? null;
  const perHead = data?.perEmployee.find((k) => k.key === "revenuePerEmployee") ?? null;
  const heads = data?.perEmployee.find((k) => k.key === "headcount") ?? null;

  return (
    <div className="shell">
      <PageHeader
        index="02"
        title="Company dashboard"
        lede="One company at a time: what it earned, what it spent, what each employee produced, and what it has said since. US registrants are read from the register; Indian companies from their own exchange filings, fact sheets and quarterly presentations."
        meta={data?.provenance && <Prov p={data.provenance} />}
      />

      <Stack gap={28}>
        <Panel title="Company" hint="Every name in the coverage universe, whether or not it files in the US.">
          <CompanyPicker value={symbol} onChange={setSymbol} />
        </Panel>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skel" style={{ height: 96 }} />
            <div className="skel" style={{ height: 300 }} />
          </div>
        )}

        {data?.unavailable && !busy && (
          <div className="notice">{data.unavailable}</div>
        )}

        {data && !busy && data.latest && (
          <>
            <StatRow>
              <StatBlock
                label={`Revenue, ${data.latest.label}`}
                value={headline ? show(headline) : <NotSet />}
                sub={
                  growth?.value != null ? (
                    <>
                      <Delta value={growth.value} /> year on year
                    </>
                  ) : (
                    `${data.company.name}`
                  )
                }
                emphasis
              />
              <StatBlock
                label="Operating margin"
                value={opMargin?.value != null ? `${opMargin.value.toFixed(1)}%` : <NotSet />}
                sub={
                  opMargin?.prior != null && opMargin.value != null ? (
                    <>
                      <Delta value={opMargin.value - opMargin.prior} suffix=" pts" /> on {opMargin.priorLabel}
                    </>
                  ) : (
                    "No comparable prior period"
                  )
                }
              />
              <StatBlock
                label="Revenue per employee"
                value={perHead?.value != null ? money(perHead.value) : <NotSet />}
                sub={perHead?.basis || "Headcount not published"}
              />
              <StatBlock
                label="Headcount"
                value={heads?.value != null ? Math.round(heads.value).toLocaleString("en-US") : <NotSet />}
                sub={data.latest.label}
              />
              <StatBlock
                label="Basis"
                value={data.basis === "quarterly" ? "Quarterly" : "Annual"}
                sub={`${data.periods.length} periods to ${data.latest.label}`}
              />
            </StatRow>

            <div className="filter-bar" style={{ padding: 0, border: 0 }}>
              <div className="filter-row">
                <span className="t-label filter-row-label">View</span>
                <div className="filter-row-chips">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="chip"
                      data-active={tab === t.id}
                      aria-pressed={tab === t.id}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tab === "kpis" && (
              <>
                <Panel
                  title="Key measures"
                  hint="The value first, the movement second. Every measure states how it was computed."
                  actions={data.provenance && <Prov p={data.provenance} />}
                >
                  <KpiGrid items={data.kpis} />
                </Panel>

                <Panel
                  title="Operating measures"
                  hint="Utilisation, attrition and deal wins, as published. These are not filed concepts, so a company that does not disclose one carries nothing against it."
                >
                  <KpiGrid items={data.operating} />
                </Panel>

                {revenueChart.length > 1 && (
                  <Panel
                    title="Revenue and operating margin"
                    hint="Columns are revenue, the line is operating margin."
                  >
                    <ComboChart
                      data={revenueChart}
                      barLabel="Revenue, USD bn"
                      lineLabel="Operating margin"
                      barFormat={(v) => `${v.toFixed(1)}bn`}
                      caption={`${data.basis === "quarterly" ? "Quarterly" : "Annual"} periods as the company reported them.`}
                    />
                  </Panel>
                )}
              </>
            )}

            {tab === "people" && (
              <>
                <Panel
                  title="Per employee"
                  hint="Revenue and cost divided by the headcount the company published for the same period. Where a company publishes utilisation, revenue per billable employee is shown alongside."
                  actions={data.provenance && <Prov p={data.provenance} />}
                >
                  <KpiGrid items={data.perEmployee} />
                </Panel>

                <Panel title="How these are computed" hint="So a reader can object to the arithmetic rather than the figure.">
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Measure</th>
                          <th scope="col" className="num">Value</th>
                          <th scope="col">Computed as</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.perEmployee.map((k) => (
                          <tr key={k.key}>
                            <th scope="row" className="tbl-rowhead">{k.label}</th>
                            <td className="num tnum">{k.value === null ? <NotSet /> : show(k)}</td>
                            <td className="t-small">{k.how}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}

            {tab === "pnl" && (
              <>
                {bridge.length >= 3 && (
                  <Panel title={`Income statement bridge, ${data.latest.label}`} hint="Revenue down to net income.">
                    <Waterfall
                      steps={bridge}
                      unit="USD bn"
                      format={(v) => v.toFixed(2)}
                      caption="Only lines the company reports are shown. A missing step means the concept was not reported, not that it is zero."
                    />
                  </Panel>
                )}

                <Panel
                  title={data.basis === "quarterly" ? "Quarterly income statement" : "Annual income statement"}
                  hint="As reported, in US dollars."
                  actions={data.provenance && <Prov p={data.provenance} />}
                  flush
                >
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Line</th>
                          {periods.map((q) => (
                            <th key={q.end} scope="col" className="num">{q.label.replace(" FY", " ")}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PNL_ROWS.filter((row) => periods.some((q) => q.values[row.key] !== undefined)).map((row) => (
                          <tr key={row.key} data-total={row.subtotal ? "true" : undefined}>
                            <th
                              scope="row"
                              className="tbl-rowhead"
                              style={{ fontWeight: row.subtotal ? 600 : 400, paddingLeft: row.indent ? 32 : 16 }}
                            >
                              {row.label}
                            </th>
                            {periods.map((q) => (
                              <td key={q.end} className="num tnum">
                                {q.values[row.key] === undefined ? <NotSet /> : money(q.values[row.key] as number)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            )}

            {tab === "deals" && (
              <Panel
                title="Transactions and stakes"
                hint="Coverage naming this company alongside an acquisition, a merger or a stake, searched live."
                actions={deals && <Prov p={deals.provenance} />}
              >
                <FeedList items={deals?.items ?? []} busy={feedBusy && !deals} empty="No transaction coverage came back for this company." />
              </Panel>
            )}

            {tab === "news" && (
              <Panel
                title="Recent developments"
                hint="Everything published about this company, newest first, searched live."
                actions={news && <Prov p={news.provenance} />}
              >
                <FeedList items={news?.items ?? []} busy={feedBusy && !news} empty="No coverage came back for this company." />
              </Panel>
            )}

            {tab === "call" && (
              <Panel
                title="What management said"
                hint="From the latest earnings call the company published on its own investor site."
              >
                {data.call ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    {data.call.quotes.map((q, i) => (
                      <div key={i} className="trk-said">
                        <p className="trk-reason">{q.text}</p>
                        <p className="t-small trk-said-src">
                          {q.speaker}, {q.role} on {q.topic}
                        </p>
                      </div>
                    ))}
                    <p className="t-small" style={{ margin: 0 }}>
                      {data.call.quarter} earnings call.{" "}
                      <a href={data.call.transcriptUrl} target="_blank" rel="noreferrer noopener">
                        Read the transcript
                      </a>
                    </p>
                  </div>
                ) : (
                  <div className="empty">
                    <p className="empty-title">No transcript is wired for this company</p>
                    <p className="empty-body">
                      Its call is either not published as a transcript, or is set in a layout the reader
                      cannot take a quote from without garbling it.
                    </p>
                  </div>
                )}
              </Panel>
            )}

            {data.sources.length > 0 && (
              <Panel title="Read from" hint="Every document behind the figures above.">
                <ul className="src-list">
                  {data.sources.map((s, i) => (
                    <li key={i}>
                      <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>
                      <span className="t-small"> {s.kind}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}

function FeedList({ items, busy, empty }: { items: NewsItem[]; busy: boolean; empty: string }) {
  if (busy) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skel" style={{ height: 34 }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">Nothing found</p>
        <p className="empty-body">{empty}</p>
      </div>
    );
  }

  return (
    <ul className="src-list">
      {items.slice(0, 30).map((n, i) => (
        <li key={i}>
          <a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>
          <span className="t-small">
            {" "}
            {n.publisher}
            {n.publishedAt ? `, ${n.publishedAt.slice(0, 10)}` : ""}
            {n.verified === false ? ", publisher not on the reviewed list" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
