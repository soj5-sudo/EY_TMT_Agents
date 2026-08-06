import { NextResponse } from "next/server";
import { answerQuestion, buildIndex } from "@/lib/rag/answer";
import { sanitizeUserInput } from "@/lib/security/sanitize";
import { getNews } from "@/lib/feeds/news";
import { getQuotes } from "@/lib/feeds/markets";
import { DEFAULT_WATCH } from "@/lib/data/universe";
import type { NewsItem, Quote } from "@/lib/core/types";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const input = sanitizeUserInput((body as { question?: unknown })?.question);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const [newsResult, quoteResult] = await Promise.allSettled([
    getNews(),
    getQuotes([...DEFAULT_WATCH]),
  ]);

  const news: NewsItem[] =
    newsResult.status === "fulfilled" ? newsResult.value.data.items : [];

  const quotes: Quote[] =
    quoteResult.status === "fulfilled"
      ? quoteResult.value.results
          .map((r) => r.quote)
          .filter((q): q is Quote => q !== null)
      : [];

  const index = buildIndex({ news, quotes });

  try {
    const answer = await answerQuestion(index, input.value);
    return NextResponse.json(
      {
        ...answer,
        indexSize: index.size,
        liveContext: {
          news: news.length,
          quotes: quotes.length,
          newsAvailable: newsResult.status === "fulfilled",
          marketsAvailable: quoteResult.status === "fulfilled",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "The assistant could not complete that request.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
