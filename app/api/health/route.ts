import { NextResponse } from "next/server";
import { cacheStats } from "@/lib/core/cache";
import { providerStatus } from "@/lib/llm/provider";
import { AGENTS } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

/** Operational readout. Carries no market or financial data. */
export async function GET() {
  const llm = providerStatus();
  return NextResponse.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      cache: cacheStats(),
      agents: AGENTS.length,
      answerMode: llm.mode,
      answerProvider: llm.label,
      model: llm.model,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
