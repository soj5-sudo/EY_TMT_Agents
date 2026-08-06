"use client";

import { useEffect, useMemo, useState } from "react";
import { Donut } from "@/components/charts/Donut";
import { QuarterBars } from "@/components/charts/QuarterBars";
import { Scatter } from "@/components/charts/Scatter";
import { PageHeader, Panel, Prov, Stack, StatBlock, StatRow } from "@/components/ui/Bits";
import type { Provenance } from "@/lib/core/types";
import { apiFetch } from "@/lib/client/api";

/**
 * Quarterly IT services tracker.
 *
 * Every other dashboard in the console computes its figures from a filing on
 * each request. This one does not, and the difference is the point. It is a
 * dated reading of a curated quarterly record, and the material that justifies
 * the page is the commentary rather than the numbers: a revenue line for TCS
 * can be had anywhere, but the reason management gave for the way it moved is
 * published in no machine readable form. So the reason is carried verbatim,
 * keeps its own source line, and gets the widest column here.
 */

interface Measure {
  prior: number | null;
  latest: number | null;
  deltaPct: number | null;
  deltaBps: number | null;
  status: string;
  reason: string;
  source: string;
  unit: string;
}

interface Company {
  name: string;
  tier: string;
  measures: Record<string, Measure | undefined>;
}

interface Cohort {
  tier: string;
  count: number;
  measures: Record<
    string,
    { prior: number | null; latest: number | null; reporting: number } | undefined
  >;
}

interface PeerRow {
  name: string;
  vertical: string;
  headquarters: string;
  service: string;
  marketCapUsdM: number | null;
  lastReported: string;
  gaap: string;
  revenueUsdM: number | null;
  ebitdaUsdM: number | null;
  ebitdaPct: number | null;
  keyInvestors: string;
  lastTransactionYear: string;
  lastTransaction: string;
}

interface Payload {
  periods: { prior: string; latest: string };
  takenAt: string;
  companies: Company[];
  cohorts: Cohort[];
  peers: {
    total: number;
    shown: number;
    byVertical: Array<{ vertical: string; count: number; revenueUsdM: number }>;
    byRegion: Array<{ region: string; count: number; revenueUsdM: number }>;
    rows: PeerRow[];
  };
  provenance: Provenance;
}

interface MeasureSpec {
  key: string;
  label: string;
  unit: string;
  /** How the stored number reads: a money amount, a share of one, or a count. */
  scale: "amount" | "share" | "count";
  /**
   * Which direction is the better one, where there is one. Attrition rising is
   * not an improvement, and headcount moving either way is a strategy rather
   * than a result, so neither may be coloured as if it were good news.
   */
  betterHigh: boolean | null;
}

const MEASURES: MeasureSpec[] = [
  { key: "revenueUsdM", label: "Revenue", unit: "USD m", scale: "amount", betterHigh: true },
  { key: "ebitMarginPct", label: "EBIT margin", unit: "percent", scale: "share", betterHigh: true },
  { key: "headcountK", label: "Headcount", unit: "thousands", scale: "count", betterHigh: null },
  { key: "attritionPct", label: "Attrition", unit: "percent", scale: "share", betterHigh: false },
  { key: "utilisationPct", label: "Utilisation", unit: "percent", scale: "share", betterHigh: true },
];

const TIERS = ["All", "Indian tier-1", "Indian mid-tier"] as const;

const PEER_LIMIT = 24;

function money(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function formatValue(v: number, scale: MeasureSpec["scale"]): string {
  if (scale === "share") return `${(v * 100).toFixed(1)}%`;
  if (scale === "count") return `${v.toFixed(1)}k`;
  return money(v);
}

function readDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The workbook writes an absent text field as "na" or leaves it empty. Both
 * mean the same thing and neither should reach the page as a literal.
 */
function stated(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (t.length === 0) return null;
  return t.toLowerCase() === "na" ? null : t;
}

/** Absent figure. Never a blank cell, never a zero standing in for a gap. */
function NotReported() {
  return <span className="t-small">Not reported</span>;
}

function ChangeCell({
  value,
  kind,
  betterHigh,
}: {
  value: number | null;
  kind: "pct" | "bps";
  betterHigh: boolean | null;
}) {
  if (value === null || !Number.isFinite(value)) return <NotReported />;
  const sign = value > 0 ? "+" : "";
  const text = kind === "bps" ? `${sign}${Math.round(value)} bps` : `${sign}${value.toFixed(1)}%`;
  const cls =
    betterHigh === null || value === 0
      ? "delta-flat"
      : value > 0 === betterHigh
        ? "delta-up"
        : "delta-down";
  return <span className={cls}>{text}</span>;
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="chip" data-active={on} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
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

export function SectorTracker({
  trackerTakenAt,
  peerTakenAt,
}: {
  trackerTakenAt: string;
  peerTakenAt: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tier, setTier] = useState<(typeof TIERS)[number]>("All");
  const [measureKey, setMeasureKey] = useState(MEASURES[0].key);
  const [selected, setSelected] = useState<string | null>(null);

  const [vertical, setVertical] = useState("All");
  const [region, setRegion] = useState("All");
  const [peerView, setPeerView] = useState<Payload["peers"] | null>(null);
  const [peersBusy, setPeersBusy] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [peersExpanded, setPeersExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const json = await apiFetch<Payload>("/api/tracker", { timeoutMs: 30_000 });
        if (live) setData(json);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const spec = MEASURES.find((m) => m.key === measureKey) ?? MEASURES[0];
  const periods = data?.periods ?? { prior: "prior quarter", latest: "latest quarter" };
  const format = (v: number) => formatValue(v, spec.scale);

  const companies = useMemo(
    () => (data?.companies ?? []).filter((c) => tier === "All" || c.tier === tier),
    [data, tier],
  );

  const tierCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.companies ?? []) counts.set(c.tier, (counts.get(c.tier) ?? 0) + 1);
    return counts;
  }, [data]);

  /**
   * Every company in the tier goes to the chart, including the ones with no
   * figure for this measure. The chart says so in words on that row, which is
   * the information a reader needs; dropping the name would read as coverage
   * the tracker does not claim to have.
   */
  const bars = useMemo(
    () =>
      companies.map((c) => {
        const m = c.measures[spec.key];
        return {
          label: c.name,
          prior: m?.prior ?? null,
          latest: m?.latest ?? null,
          highlight: selected === c.name,
        };
      }),
    [companies, spec.key, selected],
  );

  // Two axes, so a name needs both figures to be placed at all. The measure is
  // fixed here rather than following the chip above, because scale against
  // profitability is the one pairing the reader is looking for.
  const positioning = useMemo(
    () =>
      companies.flatMap((c) => {
        const revenue = c.measures.revenueUsdM?.latest;
        const margin = c.measures.ebitMarginPct?.latest;
        if (typeof revenue !== "number" || typeof margin !== "number") return [];
        return [
          {
            label: c.name,
            x: revenue,
            y: margin * 100,
            highlight: selected === c.name,
            group: c.tier,
          },
        ];
      }),
    [companies, selected],
  );

  const cohorts = useMemo(
    () => (data?.cohorts ?? []).filter((c) => tier === "All" || c.tier === tier),
    [data, tier],
  );

  /**
   * The peer filters are applied by the route rather than here. It owns the
   * definition of a region, including the correction for the workbook writing
   * the same country two ways, and a second copy of that rule on the client
   * would be one refresh away from disagreeing with the counts it publishes.
   */
  useEffect(() => {
    setPeersExpanded(false);
    if (vertical === "All" && region === "All") {
      setPeerView(null);
      setPeerError(null);
      setPeersBusy(false);
      return;
    }
    let live = true;
    setPeersBusy(true);
    (async () => {
      try {
        const query = new URLSearchParams({
          vertical: vertical === "All" ? "all" : vertical,
          region: region === "All" ? "all" : region,
        });
        const json = await apiFetch<Payload>(`/api/tracker?${query}`, { timeoutMs: 30_000 });
        if (live) {
          setPeerView(json.peers);
          setPeerError(null);
        }
      } catch (err) {
        if (live) setPeerError(err instanceof Error ? err.message : String(err));
      } finally {
        if (live) setPeersBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [vertical, region]);

  const peers = peerView ?? data?.peers ?? null;

  const peersOrdered = useMemo(
    () => [...(peers?.rows ?? [])].sort((a, b) => (b.revenueUsdM ?? -1) - (a.revenueUsdM ?? -1)),
    [peers],
  );

  const peerSlices = (peers?.byVertical ?? [])
    .filter((g) => g.revenueUsdM > 0)
    .map((g) => ({ label: g.vertical, value: g.revenueUsdM }));

  const peerRevenue = peerSlices.reduce((a, b) => a + b.value, 0);
  const peersShown = peersExpanded ? peersOrdered : peersOrdered.slice(0, PEER_LIMIT);

  const pick = (name: string) => setSelected((s) => (s === name ? null : name));

  return (
    <div className="shell trk-shell">
      <PageHeader
        index="06"
        title="IT services tracker"
        lede="The quarterly sector record for the listed Indian IT services names: what each company reported for the quarter, what management gave as the reason it moved, and which document that reason came from. The figures are a reading taken on a stated date rather than a live computation, and every line keeps the source it was read from."
        meta={data && <Prov p={data.provenance} />}
      />

      <Stack gap={32}>
        {error && (
          <div className="notice" data-kind="error">
            {error}
          </div>
        )}

        {busy && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skel" style={{ height: 96 }} />
            <div className="skel" style={{ height: 280 }} />
          </div>
        )}

        {data && !busy && (
          <>
            <StatRow>
              <StatBlock
                label="Companies tracked"
                value={data.companies.length}
                sub={[...tierCounts.entries()].map(([t, n]) => `${n} ${t}`).join(" · ")}
                emphasis
              />
              <StatBlock
                label="Quarter compared"
                value={periods.latest}
                sub={`Against ${periods.prior}`}
              />
              <StatBlock
                label="Peer universe"
                value={data.peers.total}
                sub={`${data.peers.byVertical.length} verticals · ${data.peers.byRegion.length} regions`}
              />
              <StatBlock
                label="Date read"
                value={readDate(data.takenAt || trackerTakenAt)}
                sub="Curated record, not a live feed"
              />
            </StatRow>

            <div className="panel">
              <div className="filter-bar trk-filters">
                <FilterRow label="Tier">
                  {TIERS.map((t) => (
                    <Chip key={t} on={tier === t} onClick={() => setTier(t)}>
                      {t}
                      {t !== "All" && <span className="chip-count">{tierCounts.get(t) ?? 0}</span>}
                    </Chip>
                  ))}
                </FilterRow>
                <FilterRow label="Measure">
                  {MEASURES.map((m) => (
                    <Chip key={m.key} on={measureKey === m.key} onClick={() => setMeasureKey(m.key)}>
                      {m.label}
                    </Chip>
                  ))}
                </FilterRow>
              </div>
            </div>

            <Panel
              title="Quarter on quarter"
              hint={`${spec.label} for every tracked company, ${periods.prior} against ${periods.latest}. Selecting a company holds it across the charts below.`}
              actions={<Prov p={data.provenance} />}
            >
              {cohorts.length > 0 && (
                <div className="trk-cohorts">
                  {cohorts.map((c) => {
                    const cm = c.measures[spec.key];
                    return (
                      <div key={c.tier} className="trk-cohort">
                        <p className="t-label">{c.tier}</p>
                        <p className="trk-cohort-value">
                          {cm && cm.prior !== null && cm.latest !== null ? (
                            <>
                              {formatValue(cm.prior, spec.scale)} to {formatValue(cm.latest, spec.scale)}
                            </>
                          ) : (
                            <NotReported />
                          )}
                        </p>
                        <p className="t-small trk-cohort-sub">
                          {cm ? `${cm.reporting} of ${c.count} reporting` : `0 of ${c.count} reporting`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {bars.length > 0 ? (
                <QuarterBars
                  rows={bars}
                  unit={spec.unit}
                  priorLabel={periods.prior}
                  latestLabel={periods.latest}
                  format={format}
                />
              ) : (
                <div className="empty">
                  <p className="empty-title">No companies in this tier</p>
                  <p className="empty-body">Widen the tier filter above.</p>
                </div>
              )}

              <div className="tbl-scroll" style={{ marginTop: 24 }}>
                <table className="tbl">
                  <caption
                    className="t-small"
                    style={{ captionSide: "bottom", padding: "16px 0 0", textAlign: "left" }}
                  >
                    {spec.label} in {spec.unit}. Select a row to hold that company across the charts.
                    Change is stated in {spec.scale === "share" ? "basis points" : "percent"}, on the
                    tracker&apos;s own arithmetic.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Tier</th>
                      <th scope="col" className="num">{periods.prior}</th>
                      <th scope="col" className="num">{periods.latest}</th>
                      <th scope="col" className="num">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => {
                      const m = c.measures[spec.key];
                      return (
                        <tr key={c.name} data-selected={selected === c.name}>
                          <th scope="row" className="tbl-rowhead">
                            <button type="button" className="trk-pick" onClick={() => pick(c.name)}>
                              {c.name}
                            </button>
                          </th>
                          <td>
                            <span className="t-small">{c.tier}</span>
                          </td>
                          <td className="num">
                            {m && m.prior !== null ? formatValue(m.prior, spec.scale) : <NotReported />}
                          </td>
                          <td className="num">
                            {m && m.latest !== null ? formatValue(m.latest, spec.scale) : <NotReported />}
                          </td>
                          <td className="num">
                            <ChangeCell
                              value={spec.scale === "share" ? (m?.deltaBps ?? null) : (m?.deltaPct ?? null)}
                              kind={spec.scale === "share" ? "bps" : "pct"}
                              betterHigh={spec.betterHigh}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Positioning"
              hint={`Revenue against EBIT margin for ${periods.latest}. A name is absent only where it reported neither figure for the quarter.`}
              actions={<Prov p={data.provenance} />}
            >
              {positioning.length > 1 ? (
                <Scatter
                  points={positioning}
                  xLabel="Revenue, USD m"
                  yLabel="EBIT margin, percent"
                  formatX={(v: number) => money(v)}
                  formatY={(v: number) => `${v.toFixed(1)}%`}
                />
              ) : (
                <div className="empty">
                  <p className="empty-title">Too few names to position</p>
                  <p className="empty-body">
                    Fewer than two companies in this tier report both revenue and EBIT margin for
                    the quarter.
                  </p>
                </div>
              )}
            </Panel>

            <Panel
              title="What management said"
              hint={`The stated reason for the ${spec.label.toLowerCase()} movement, company by company, as the tracker recorded it. This is the part of a quarter that no filing publishes in a readable form, so it is quoted rather than summarised.`}
              actions={<Prov p={data.provenance} />}
              flush
            >
              {companies.length === 0 ? (
                <div className="empty">
                  <p className="empty-title">No companies in this tier</p>
                  <p className="empty-body">Widen the tier filter above.</p>
                </div>
              ) : (
                <ul className="trk-said">
                  {companies.map((c) => {
                    const m = c.measures[spec.key];
                    const reason = stated(m?.reason);
                    const source = stated(m?.source)?.replace(/^[•\s]+/, "");
                    const movement = stated(m?.status);
                    return (
                      <li key={c.name} className="trk-said-item" data-selected={selected === c.name}>
                        <div className="trk-said-head">
                          <button type="button" className="trk-pick trk-said-name" onClick={() => pick(c.name)}>
                            {c.name}
                          </button>
                          <span className="t-label trk-said-tier">{c.tier}</span>
                          <span className="trk-said-spacer" />
                          <span className="trk-said-move tnum">
                            {movement ?? <NotReported />}
                          </span>
                        </div>

                        <p className="trk-reason">
                          {reason ?? (
                            <span className="t-small">
                              No reason is recorded against this measure for the quarter.
                            </span>
                          )}
                        </p>

                        <p className="t-small trk-said-src">
                          {source ? `Source: ${source}` : "Source not stated"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="Peer universe"
              hint="The wider technology services comparison set, ordered by reported revenue. Each row carries the period its figures are taken from, because those periods differ by company and are mostly two years behind the quarter above."
              flush
            >
              <div className="filter-bar">
                <div className="filter-search">
                  <span className="filter-count t-small">
                    {peers ? `${peers.shown} of ${data.peers.total}` : `${data.peers.total} companies`}
                  </span>
                  {(vertical !== "All" || region !== "All") && (
                    <button
                      type="button"
                      className="btn btn-ghost filter-clear"
                      onClick={() => {
                        setVertical("All");
                        setRegion("All");
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <FilterRow label="Vertical">
                  <Chip on={vertical === "All"} onClick={() => setVertical("All")}>All</Chip>
                  {data.peers.byVertical.map((g) => (
                    <Chip
                      key={g.vertical}
                      on={vertical === g.vertical}
                      onClick={() => setVertical(vertical === g.vertical ? "All" : g.vertical)}
                    >
                      {g.vertical}
                      <span className="chip-count">{g.count}</span>
                    </Chip>
                  ))}
                </FilterRow>

                <FilterRow label="Region">
                  <Chip on={region === "All"} onClick={() => setRegion("All")}>All</Chip>
                  {data.peers.byRegion.map((g) => (
                    <Chip
                      key={g.region}
                      on={region === g.region}
                      onClick={() => setRegion(region === g.region ? "All" : g.region)}
                    >
                      {g.region}
                      <span className="chip-count">{g.count}</span>
                    </Chip>
                  ))}
                </FilterRow>
              </div>

              {peerError && (
                <div style={{ padding: "16px 24px" }}>
                  <div className="notice" data-kind="error">
                    {peerError}
                  </div>
                </div>
              )}

              {peersBusy ? (
                <div style={{ padding: 24, display: "grid", gap: 8 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skel" style={{ height: 30 }} />
                  ))}
                </div>
              ) : peersOrdered.length === 0 ? (
                <div className="empty">
                  <p className="empty-title">Nothing matches those filters</p>
                  <p className="empty-body">Clear one of them. The universe itself is unchanged.</p>
                </div>
              ) : (
                <>
                  <div className="panel-body">
                    <Donut
                      slices={peerSlices}
                      total={peerRevenue}
                      totalLabel="USD m"
                      format={(v) => money(v)}
                      caption="Revenue by vertical across the filtered set, summed from each company's own last reported period. Those periods differ by company, so this is the shape of the comparison set rather than a market total for any one year."
                    />
                  </div>

                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th scope="col">Company</th>
                          <th scope="col">Vertical</th>
                          <th scope="col">Headquarters</th>
                          <th scope="col" className="num">Revenue, USD m</th>
                          <th scope="col" className="num">EBITDA %</th>
                          <th scope="col">Period</th>
                          <th scope="col">Key investors</th>
                          <th scope="col">Last transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peersShown.map((p, i) => (
                          <tr key={`${p.name}-${i}`}>
                            <th scope="row" className="tbl-rowhead trk-name">{p.name}</th>
                            <td>{p.vertical}</td>
                            <td>{p.headquarters}</td>
                            <td className="num">
                              {p.revenueUsdM === null ? <NotReported /> : money(p.revenueUsdM)}
                            </td>
                            <td className="num">
                              {p.ebitdaPct === null ? <NotReported /> : `${p.ebitdaPct.toFixed(1)}%`}
                            </td>
                            <td>
                              <span className="trk-period">
                                {stated(p.lastReported) ?? <NotReported />}
                              </span>
                            </td>
                            <td className="trk-wrap">{stated(p.keyInvestors) ?? <NotReported />}</td>
                            <td className="trk-wrap">
                              {stated(p.lastTransaction) ?? <NotReported />}
                              {stated(p.lastTransactionYear) &&
                                stated(p.lastTransactionYear) !== stated(p.lastTransaction) && (
                                  <span className="t-small"> · {stated(p.lastTransactionYear)}</span>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {!peersBusy && peersOrdered.length > PEER_LIMIT && (
                <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-hairline)" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setPeersExpanded((v) => !v)}
                  >
                    {peersExpanded ? "Show fewer" : `Show all ${peersOrdered.length}`}
                  </button>
                </div>
              )}

              <p className="t-small trk-foot">
                Figures on every row are as of the period that row names, which differs by company
                and is mostly two years behind the quarter above. Peer universe read{" "}
                {readDate(peerTakenAt)}; tracker read {readDate(data.takenAt || trackerTakenAt)}.
                Neither refreshes on load.
              </p>
            </Panel>
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
