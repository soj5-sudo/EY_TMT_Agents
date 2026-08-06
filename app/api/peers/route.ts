import { NextResponse } from "next/server";
import { annualRatios, getStatements } from "@/lib/financials/model";
import { resolveCik } from "@/lib/feeds/sec";
import { UNIVERSE, findCompany } from "@/lib/data/universe";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

const SPACING_MS = 140;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = sanitizeUserInput(url.searchParams.get("company") ?? "", 120, "Company");
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const subject = findCompany(input.value);
  if (!subject) {
    return NextResponse.json(
      { error: `${input.value} is not in the coverage universe.` },
      { status: 404 },
    );
  }

  const cohort = UNIVERSE.filter(
    (c) => c.subsector === subject.subsector && c.secFiler,
  ).slice(0, 8);

  const rows = [];
  for (const company of cohort) {
    try {
      const sec = await resolveCik(company.symbol);
      if (!sec) continue;
      const statements = await getStatements(sec.cik);
      const { period, ratios } = annualRatios(statements.data);
      rows.push({
        symbol: company.symbol,
        short: company.short,
        name: statements.data.entityName,
        period,
        isSubject: company.symbol === subject.symbol,
        revenue: statements.data.lines.revenue?.annual.at(-1)?.value ?? null,
        ratios: Object.fromEntries(ratios.map((r) => [r.label, r.value])),
      });
    } catch {
      rows.push({
        symbol: company.symbol,
        short: company.short,
        name: company.name,
        period: null,
        isSubject: company.symbol === subject.symbol,
        revenue: null,
        ratios: {},
        unavailable: true,
      });
    }
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  return NextResponse.json(
    {
      subject: { symbol: subject.symbol, short: subject.short, subsector: subject.subsector },
      cohort: rows,
      provenance: {
        kind: "filing",
        source: "SEC EDGAR XBRL company facts",
        url: "https://www.sec.gov/edgar",
        retrievedAt: new Date().toISOString(),
        note: `${rows.filter((r) => !("unavailable" in r)).length} of ${cohort.length} peers resolved.`,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
