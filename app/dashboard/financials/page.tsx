"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComboChart } from "@/components/charts/ComboChart";
import { Waterfall } from "@/components/charts/Waterfall";
import { CompanyPicker } from "@/components/ui/CompanyPicker";
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
import type { Provenance } from "@/lib/core/types";
import { apiFetch } from "@/lib/client/api";

interface QuarterRow {
  label: string;
  end: string;
  derived: boolean;
  values: Record<string, number | null>;
}

interface Payload {
  company: { name: string; cik: string; ticker: string; sector: string | null; subsector: string | null };
  latestFy: string | null;
  latestFiled: string | null;
  quarters: QuarterRow[];
  years: Array<{ label: string; end: string; values: Record<string, number | null> }>;
  ratios: { period: string | null; ratios: Array<{ label: string; value: number | null; unit: string; reading: string }> };
  lines: Record<string, { label: string; tags: string[] }>;
  provenance: Provenance;
  error?: string;
  detail?: string;
  hint?: string;
}

const PNL_ROWS: Array<{ key: string; label: string; subtotal?: boolean; indent?: boolean }> = [
  { key: "revenue", label: "Revenue", subtotal: true },
  { key: "costOfRevenue", label: "Cost of revenue", indent: true },
  { key: "grossProfit", label: "Gross profit", subtotal: true },
  { key: "rnd", label: "Research and development", indent: true },
  { key: "sga", label: "Selling, general and administrative", indent: true },
  { key: "operatingIncome", label: "Operating income", subtotal: true },
  { key: "pretaxIncome", label: "Income before tax", subtotal: true },
  { key: "tax", label: "Income tax expense", indent: true },
  { key: "netIncome", label: "Net income", subtotal: true },
];

function bn(v: number | null): string {
  if (v === null) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}m`;
  return v.toLocaleString("en-US");
}

export default function FinancialsPage() {
  const [symbol, setSymbol] = useState("ACN");
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sym: string) => {
    setBusy(true);
    setError(null);
    try {
      const json = await apiFetch<Payload>(
        `/api/financials?company=${encodeURIComponent(sym)}`,
        { timeoutMs: 90_000 },
      );
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

  const quarterly = (data?.quarters?.length ?? 0) > 0;
  const quarters: QuarterRow[] = quarterly
    ? data!.quarters
    : (data?.years ?? []).map((y) => ({
        label: y.label,
        end: y.end,
        derived: false,
        values: y.values,
      }));
  const latest = quarters.at(-1);
  const yearAgo = quarterly
    ? quarters.length >= 5
      ? quarters.at(-5)
      : undefined
    : quarters.length >= 2
      ? quarters.at(-2)
      : undefined;
  const periodWord = quarterly ? "quarter" : "year";

  const revenueChart = useMemo(
    () =>
      quarters
        .filter((q) => q.values.revenue !== null && q.values.revenue !== 0)
        .map((q) => {
          const rev = q.values.revenue!;
          const marginSource =
            q.values.operatingIncome ?? q.values.netIncome ?? null;
          return marginSource === null
            ? null
            : {
                label: q.label.replace(" FY", " "),
                bar: rev / 1e9,
                line: (marginSource / rev) * 100,
              };
        })
        .filter((d): d is { label: string; bar: number; line: number } => d !== null),
    [quarters],
  );
  const marginLineLabel = quarters.some((q) => q.values.operatingIncome !== null)
    ? "Operating margin"
    : "Net margin";

  const bridge = useMemo(() => {
    if (!latest) return [];
    const v = latest.values;
    const steps: Array<{ label: string; value: number; kind: "total" | "deduction" | "addition" }> = [];
    if (v.revenue === null) return [];
    steps.push({ label: "Revenue", value: v.revenue / 1e9, kind: "total" });
    if (v.costOfRevenue !== null) {
      steps.push({ label: "Cost of revenue", value: v.costOfRevenue / 1e9, kind: "deduction" });
      steps.push({
        label: "Gross profit",
        value: (v.grossProfit ?? v.revenue - v.costOfRevenue) / 1e9,
        kind: "total",
      });
    }
    if (v.rnd !== null) steps.push({ label: "R&D", value: v.rnd / 1e9, kind: "deduction" });
    if (v.sga !== null) steps.push({ label: "SG&A", value: v.sga / 1e9, kind: "deduction" });
    if (v.operatingIncome !== null)
      steps.push({ label: "Operating income", value: v.operatingIncome / 1e9, kind: "total" });
    if (v.tax !== null) steps.push({ label: "Tax", value: v.tax / 1e9, kind: "deduction" });
    if (v.netIncome !== null)
      steps.push({ label: "Net income", value: v.netIncome / 1e9, kind: "total" });
    return steps;
  }, [latest]);

  const growth = (key: string): number | null => {
    if (!latest || !yearAgo) return null;
    const a = latest.values[key];
    const b = yearAgo.values[key];
    return a !== null && b !== null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
  };

  const margin = (row: QuarterRow, key: string): number | null => {
    const v = row.values[key];
    const r = row.values.revenue;
    return v !== null && r !== null && r !== 0 ? (v / r) * 100 : null;
  };

  return (
    <div className="shell">
      <PageHeader
        index="02"
        title="Quarterly profit and loss"
        lede="The income statement as filed, quarter by quarter, for any company in the coverage universe. Figures come from the company's own XBRL tagging, with the most recently filed value used where a period has been restated."
        meta={data && <Prov p={data.provenance} />}
      />

      <Stack gap={32}>
        <Panel title="Subject" hint="Reported statements are drawn from SEC filings, so coverage follows US registration.">
          <CompanyPicker value={symbol} onChange={setSymbol} />
        </Panel>

        {error && <div className="notice" data-kind="error">{error}</div>}

        {busy && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skel" style={{ height: 96 }} />
            <div className="skel" style={{ height: 300 }} />
          </div>
        )}

        {data && !busy && (
          <>
            <StatRow>
              <StatBlock
                label={`Revenue, ${latest?.label ?? "latest"}`}
                value={latest ? bn(latest.values.revenue) : <NotSet />}
                sub={<>USD · <Delta value={growth("revenue")} /> {quarterly ? "year on year" : "on the prior year"}</>}
                emphasis
              />
              <StatBlock
                label="Operating margin"
                value={
                  latest && margin(latest, "operatingIncome") !== null
                    ? `${margin(latest, "operatingIncome")!.toFixed(1)}%`
                    : <NotSet />
                }
                sub={
                  yearAgo && margin(yearAgo, "operatingIncome") !== null && latest && margin(latest, "operatingIncome") !== null ? (
                    <>
                      <Delta
                        value={margin(latest, "operatingIncome")! - margin(yearAgo, "operatingIncome")!}
                        suffix=" pts"
                      />{" "}
                      year on year
                    </>
                  ) : (
                    "No comparable prior year"
                  )
                }
              />
              <StatBlock
                label="Net income"
                value={latest ? bn(latest.values.netIncome) : <NotSet />}
                sub={<>USD · <Delta value={growth("netIncome")} /> year on year</>}
              />
              <StatBlock
                label="Net margin"
                value={
                  latest && margin(latest, "netIncome") !== null
                    ? `${margin(latest, "netIncome")!.toFixed(1)}%`
                    : <NotSet />
                }
                sub={`Latest reported quarter`}
              />
              <StatBlock
                label="Fiscal year"
                value={data.latestFy ?? <NotSet />}
                sub={
                  data.latestFiled
                    ? `${data.company.ticker} · last filing ${data.latestFiled}`
                    : `${data.company.ticker} · CIK ${data.company.cik}`
                }
              />
            </StatRow>

            {!quarterly && (
              <div className="notice">
                {data.company.name} reports to the SEC on Form 20-F, which carries
                annual statements only. The figures below are the tagged annual
                record; quarterly detail for this company is published on its own
                investor relations site rather than in the register.
              </div>
            )}
            {quarters.some((q) => q.derived) && (
              <div className="notice">
                Quarters marked derived are computed as the full year less the three
                reported quarters. Most filers fold the fourth quarter into the annual
                report rather than filing it separately, so this is arithmetic on filed
                figures rather than a filed figure itself.
              </div>
            )}

            <Panel
              title="Revenue and operating margin"
              hint="Columns are quarterly revenue on the left axis, the line is operating margin on the right."
              actions={<Prov p={data.provenance} />}
            >
              {revenueChart.length > 1 ? (
                <ComboChart
                  data={revenueChart}
                  barLabel="Revenue, USD bn"
                  lineLabel={marginLineLabel}
                  barFormat={(v) => `${v.toFixed(0)}bn`}
                  caption={`Concept tags used: ${data.lines.revenue?.tags.join(", ") ?? "not set"}.${quarterly ? "" : " Annual periods: this filer reports to the SEC on Form 20-F and tags no quarterly statements."}`}
                />
              ) : (
                <div className="empty">
                  <p className="empty-title">No plottable series</p>
                  <p className="empty-body">
                    Fewer than two periods carry both revenue and an income line in
                    this filer&apos;s tagging.
                  </p>
                </div>
              )}
            </Panel>

            {bridge.length >= 3 && (
              <Panel
                title={`Income statement bridge, ${latest?.label}`}
                hint="Revenue down to net income. Grey bars are deductions, dark bars are subtotals."
                actions={<Prov p={data.provenance} />}
              >
                <Waterfall
                  steps={bridge}
                  unit="USD bn"
                  format={(v) => v.toFixed(1)}
                  caption="Only lines this filer tags are shown. A missing step means the concept was not reported, not that it is zero."
                />
              </Panel>
            )}

            <Panel
              title={quarterly ? "Quarterly income statement" : "Annual income statement"}
              hint="As filed. Blank cells mean the concept is not tagged by this filer for that period."
              actions={<Prov p={data.provenance} />}
              flush
            >
              <div className="tbl-scroll">
                <table className="tbl">
                  <caption className="t-small" style={{ captionSide: "bottom", padding: 16, textAlign: "left" }}>
                    Figures in US dollars, as reported, one column per {periodWord}. A
                    trailing d marks a value derived by arithmetic on filed figures.
                    {" "}{data.company.name}, CIK {data.company.cik}
                    {data.latestFiled ? `, last filing ${data.latestFiled}` : ""}.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      {quarters.map((q) => (
                        <th key={q.end} scope="col" className="num">
                          {q.label.replace(" FY", " ")}
                          {q.derived && <span style={{ color: "var(--text-muted)" }}> d</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PNL_ROWS.map((row) => {
                      const present = quarters.some(
                        (q) =>
                          q.values[row.key] !== null ||
                          (row.key === "grossProfit" &&
                            q.values.revenue !== null &&
                            q.values.costOfRevenue !== null),
                      );
                      if (!present) return null;
                      return (
                        <tr key={row.key} data-total={row.subtotal ? "true" : undefined}>
                          <th
                            scope="row"
                            className="tbl-rowhead"
                            style={{
                              fontWeight: row.subtotal ? 600 : 400,
                              paddingLeft: row.indent ? 32 : 16,
                            }}
                          >
                            {row.label}
                          </th>
                          {quarters.map((q) => {
                            let v = q.values[row.key];
                            let derivedCell = false;
                            if (
                              v === null &&
                              row.key === "grossProfit" &&
                              q.values.revenue !== null &&
                              q.values.costOfRevenue !== null
                            ) {
                              v = q.values.revenue - q.values.costOfRevenue;
                              derivedCell = true;
                            }
                            return (
                              <td key={q.end} className="num">
                                {v === null ? (
                                  <NotSet />
                                ) : (
                                  <>
                                    {bn(v)}
                                    {derivedCell && (
                                      <span style={{ color: "var(--text-muted)" }}> d</span>
                                    )}
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr>
                      <th scope="row" className="tbl-rowhead">Operating margin</th>
                      {quarters.map((q) => (
                        <td key={q.end} className="num">
                          {margin(q, "operatingIncome") === null ? (
                            <NotSet />
                          ) : (
                            `${margin(q, "operatingIncome")!.toFixed(1)}%`
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row" className="tbl-rowhead">Net margin</th>
                      {quarters.map((q) => (
                        <td key={q.end} className="num">
                          {margin(q, "netIncome") === null ? (
                            <NotSet />
                          ) : (
                            `${margin(q, "netIncome")!.toFixed(1)}%`
                          )}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
