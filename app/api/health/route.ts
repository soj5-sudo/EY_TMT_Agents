import { NextResponse } from "next/server";
import { cacheStats } from "@/lib/core/cache";
import { AGENTS } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      cache: cacheStats(),
      agents: AGENTS.length,
      answerEngine: "in-house",
      layers: ["parse", "compute", "retrieve", "compose"],
      externalModel: null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
