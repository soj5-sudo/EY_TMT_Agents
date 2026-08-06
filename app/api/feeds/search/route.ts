import { NextResponse } from "next/server";
import { searchNews } from "@/lib/feeds/news";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("q") ?? "";

  const input = sanitizeUserInput(raw);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const result = await searchNews(input.value, 60);
    return NextResponse.json(
      {
        query: input.value,
        items: result.data.items,
        stats: result.data.stats,
        provenance: result.provenance,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "The coverage search could not be completed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
