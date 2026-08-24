import { NextResponse } from "next/server";
import { companyView } from "@/lib/brain/company-view";
import { findCompany, UNIVERSE } from "@/lib/data/universe";
import { cached } from "@/lib/core/cache";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("company") ?? "";

  const input = sanitizeUserInput(raw, 120, "Company");
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const company = findCompany(input.value);
  if (!company) {
    return NextResponse.json(
      {
        error: `${input.value} is not in the coverage universe.`,
        coverage: UNIVERSE.map((c) => ({ symbol: c.symbol, short: c.short, name: c.name })),
      },
      { status: 404 },
    );
  }

  try {
    const res = await cached(`company:view:${company.symbol}`, TTL_MS, () => companyView(company));
    return NextResponse.json(
      { ...res.value, readAt: new Date(res.storedAt).toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "The company record could not be assembled.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
