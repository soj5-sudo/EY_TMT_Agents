import { NextResponse } from "next/server";
import {
  alignedQuarters,
  alignedYears,
  annualRatios,
  getStatements,
} from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { UNIVERSE, findCompany } from "@/lib/data/universe";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PNL_KEYS = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "rnd",
  "sga",
  "operatingIncome",
  "pretaxIncome",
  "tax",
  "netIncome",
];

const KPI_KEYS = [
  "revenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "rnd",
  "operatingCashFlow",
  "capex",
  "shareBasedComp",
  "assets",
  "equity",
  "cash",
  "receivables",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("company") ?? "";

  const input = sanitizeUserInput(raw, 120, "Company");
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }
  if (!/^[\p{L}\p{N}\s.,&'()\-^]+$/u.test(input.value)) {
    return NextResponse.json(
      { error: "Enter a company name or ticker using letters, numbers and basic punctuation." },
      { status: 400 },
    );
  }

  const known = findCompany(input.value);
  const symbol = known?.symbol ?? input.value;

  try {
    const sec = await resolveCik(symbol);
    if (!sec) {
      return NextResponse.json(
        {
          error: `${input.value} is not in the SEC register.`,
          hint: "Reported statements are available for US registrants. Companies listed only outside the US do not file here.",
          coverage: UNIVERSE.filter((c) => c.secFiler).map((c) => ({
            symbol: c.symbol,
            name: c.name,
            sector: c.sector,
          })),
        },
        { status: 404 },
      );
    }

    const statements = await getStatements(sec.cik);
    const ratios = annualRatios(statements.data);

    return NextResponse.json(
      {
        company: {
          name: statements.data.entityName,
          cik: statements.data.cik,
          ticker: sec.ticker,
          sector: known?.sector ?? null,
          subsector: known?.subsector ?? null,
        },
        latestFy: statements.data.latestFy,
        quarters: alignedQuarters(statements.data, PNL_KEYS, 8),
        years: alignedYears(statements.data, KPI_KEYS, 8),
        ratios,
        lines: Object.fromEntries(
          Object.entries(statements.data.lines).map(([k, v]) => [
            k,
            { label: v.label, tags: v.tags },
          ]),
        ),
        provenance: statements.provenance,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Statements could not be assembled.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
