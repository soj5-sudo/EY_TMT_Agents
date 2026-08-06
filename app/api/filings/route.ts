import { NextResponse } from "next/server";
import { candidateFilings, getLatestFactSheet, parseConfidence } from "@/lib/feeds/filings";
import { BASELINE_SOURCE } from "@/lib/data/tcs-baseline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await getLatestFactSheet();
    const confidence = parseConfidence(result.data);

    return NextResponse.json(
      {
        ref: result.data.ref,
        headline: result.data.headline,
        geography: result.data.geography,
        verticals: result.data.verticals,
        meta: result.data.meta,
        confidence,
        lines: result.data.lines.filter(
          (l) => l.trim().length > 30 && /\d/.test(l),
        ).slice(0, 160),
        provenance: result.provenance,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ref: null,
        provenance: {
          kind: "unavailable",
          source: "Tata Consultancy Services investor relations",
          retrievedAt: new Date().toISOString(),
          note: err instanceof Error ? err.message : String(err),
        },
        candidatesTried: candidateFilings().map((c) => c.label),
        baseline: {
          document: BASELINE_SOURCE.document,
          publishedOn: BASELINE_SOURCE.publishedOn,
          url: BASELINE_SOURCE.url,
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
