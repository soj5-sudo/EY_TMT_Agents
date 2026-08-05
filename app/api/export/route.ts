import { NextResponse } from "next/server";
import { buildWorkbook, type Sheet } from "@/lib/export/workbook";
import { toCsv } from "@/lib/security/sanitize";
import { alignedQuarters, alignedYears, annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { UNIVERSE, findCompany } from "@/lib/data/universe";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Data export.
 *
 * Everything on screen is public record, so it downloads. XLSX arrives with
 * numbers typed as numbers, ready to chart; CSV is offered for anything that
 * will be piped into another tool.
 */

const PNL = [
  ["revenue", "Revenue"],
  ["costOfRevenue", "Cost of revenue"],
  ["grossProfit", "Gross profit"],
  ["rnd", "Research and development"],
  ["sga", "Selling, general and administrative"],
  ["operatingIncome", "Operating income"],
  ["pretaxIncome", "Income before tax"],
  ["tax", "Income tax expense"],
  ["netIncome", "Net income"],
] as const;

const KPI = [
  ["revenue", "Revenue"],
  ["grossProfit", "Gross profit"],
  ["operatingIncome", "Operating income"],
  ["netIncome", "Net income"],
  ["rnd", "Research and development"],
  ["operatingCashFlow", "Cash from operations"],
  ["capex", "Capital expenditure"],
  ["assets", "Total assets"],
  ["equity", "Shareholders equity"],
] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const input = sanitizeUserInput(url.searchParams.get("company") ?? "", 120, "Company");
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!/^[\p{L}\p{N}\s.,&'()\-^]+$/u.test(input.value)) {
    return NextResponse.json({ error: "Enter a company name or ticker." }, { status: 400 });
  }

  const known = findCompany(input.value);
  const sec = await resolveCik(known?.symbol ?? input.value).catch(() => null);
  if (!sec) {
    return NextResponse.json(
      { error: `${input.value} is not in the SEC register, so there is no filed statement to export.` },
      { status: 404 },
    );
  }

  const st = await getStatements(sec.cik);
  const quarters = alignedQuarters(st.data, PNL.map(([k]) => k) as unknown as string[], 12);
  const years = alignedYears(st.data, KPI.map(([k]) => k) as unknown as string[], 10);
  const { period, ratios } = annualRatios(st.data);

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = st.data.entityName.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

  // Quarterly income statement, periods across the top.
  const qSheet: Sheet = {
    name: "Quarterly P&L",
    rows: [
      ["Line", ...quarters.map((q) => q.label + (q.derived ? " (derived)" : ""))],
      ...PNL.map(([key, label]) => [
        label,
        ...quarters.map((q) => q.values[key] ?? null),
      ]),
      [],
      ["Operating margin %", ...quarters.map((q) =>
        q.values.operatingIncome !== null && q.values.revenue
          ? Number(((q.values.operatingIncome / q.values.revenue) * 100).toFixed(2))
          : null,
      )],
      ["Net margin %", ...quarters.map((q) =>
        q.values.netIncome !== null && q.values.revenue
          ? Number(((q.values.netIncome / q.values.revenue) * 100).toFixed(2))
          : null,
      )],
    ],
  };

  const ySheet: Sheet = {
    name: "Annual",
    rows: [
      ["Line", ...years.map((y) => y.label)],
      ...KPI.map(([key, label]) => [label, ...years.map((y) => y.values[key] ?? null)]),
    ],
  };

  const rSheet: Sheet = {
    name: "Quality measures",
    rows: [
      ["Measure", "Value", "Unit", "Reading"],
      ...ratios.map((r) => [
        r.label,
        r.value === null ? null : Number(r.value.toFixed(2)),
        r.unit,
        r.reading,
      ]),
    ],
  };

  const meta: Sheet = {
    name: "Source",
    rows: [
      ["Field", "Value"],
      ["Company", st.data.entityName],
      ["Ticker", sec.ticker],
      ["SEC CIK", st.data.cik],
      ["Latest fiscal year", st.data.latestFy ?? ""],
      ["Ratio period", period ?? ""],
      ["Exported", stamp],
      ["Source", "SEC EDGAR XBRL company facts"],
      ["Source URL", `https://data.sec.gov/api/xbrl/companyfacts/CIK${st.data.cik}.json`],
      [],
      ["Note", "Figures are as tagged by the company. Where a period was restated the most recently filed value is used."],
      ["Note", "Quarters marked derived are full year less the three reported quarters."],
      ["Note", "Not investment advice."],
      [],
      ["Concept tags used", ""],
      ...Object.entries(st.data.lines).map(([, v]) => [v.label, v.tags.join(", ")]),
    ],
  };

  if (format === "csv") {
    const rows = quarters.map((q) => {
      const row: Record<string, unknown> = { period: q.label, derived: q.derived ? "yes" : "no" };
      for (const [key, label] of PNL) row[label] = q.values[key] ?? "";
      return row;
    });
    const csv = toCsv(rows, ["period", "derived", ...PNL.map(([, l]) => l)]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}-quarterly-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const book = buildWorkbook([qSheet, ySheet, rSheet, meta]);
  return new NextResponse(new Uint8Array(book), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}-financials-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
