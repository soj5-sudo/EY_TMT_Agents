import { NextResponse } from "next/server";
import { getNews, TOPICS } from "@/lib/feeds/news";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("topics");

  const topicIds = requested
    ? requested
        .split(",")
        .map((t) => t.trim())
        .filter((t) => TOPICS.some((topic) => topic.id === t))
    : undefined;

  const topicList = TOPICS.map(({ id, label, sector }) => ({ id, label, sector }));

  try {
    const result = await getNews(topicIds);
    return NextResponse.json(
      {
        items: result.data.items,
        stats: result.data.stats,
        topics: topicList,
        provenance: result.provenance,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        items: [],
        stats: { seen: 0, rejected: 0, kept: 0, failedTopics: TOPICS.length },
        topics: topicList,
        provenance: {
          kind: "unavailable",
          source: "Verified publisher set",
          retrievedAt: new Date().toISOString(),
          note: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
