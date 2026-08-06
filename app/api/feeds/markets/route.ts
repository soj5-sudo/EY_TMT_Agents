import { NextResponse } from "next/server";
import { getQuotes, getSeries, rebase, throttledMap } from "@/lib/feeds/markets";
import { DEFAULT_WATCH, INDICES, UNIVERSE } from "@/lib/data/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "watch";
  const withSeries = url.searchParams.get("series") === "1";
  const range = url.searchParams.get("range") === "6mo" ? "6mo" : "1y";

  const symbols =
    scope === "all"
      ? [...UNIVERSE.map((c) => c.symbol), ...INDICES.map((i) => i.symbol)]
      : DEFAULT_WATCH;

  const sweep = await getQuotes(symbols);

  const quotes = sweep.results.map((r) => {
    const company = UNIVERSE.find((c) => c.symbol === r.symbol);
    const index = INDICES.find((i) => i.symbol === r.symbol);
    return {
      symbol: r.symbol,
      short: company?.short ?? index?.name ?? r.symbol,
      name: company?.name ?? index?.name ?? r.symbol,
      sector: company?.sector ?? "Index",
      subsector: company?.subsector ?? index?.scope ?? null,
      region: company?.region ?? "Global",
      themes: company?.themes ?? [],
      quote: r.quote,
      error: r.error,
    };
  });

  if (!withSeries) {
    return NextResponse.json(
      { quotes, provenance: sweep.provenance },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const charted = ["ACN", "TCS.NS", "NVDA", "MSFT", "^NDX", "^CNXIT"];
  const settled = await throttledMap(charted, (s) => getSeries(s, range, "1wk"));

  const series = settled.map((outcome, i) => {
    const symbol = charted[i];
    const label =
      UNIVERSE.find((c) => c.symbol === symbol)?.short ??
      INDICES.find((x) => x.symbol === symbol)?.name ??
      symbol;

    if (outcome.status !== "fulfilled") {
      return {
        symbol,
        label,
        points: [],
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      };
    }
    return { symbol, label, points: rebase(outcome.value.data), error: null };
  });

  return NextResponse.json(
    { quotes, series, range, provenance: sweep.provenance },
    { headers: { "Cache-Control": "no-store" } },
  );
}
