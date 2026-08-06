import { NextResponse } from "next/server";
import { getFxRates } from "@/lib/feeds/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getFxRates();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        provenance: {
          kind: "unavailable",
          source: "Frankfurter and open.er-api",
          retrievedAt: new Date().toISOString(),
          note: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
