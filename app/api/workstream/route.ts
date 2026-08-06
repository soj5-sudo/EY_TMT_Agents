import { NextResponse } from "next/server";
import { runFullReview, runWorkstream } from "@/lib/agents/os";
import { WORKSTREAMS, AGENTS } from "@/lib/agents/registry";
import { acceptDocuments } from "@/lib/research/documents";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

const VALID = new Set(WORKSTREAMS.map((w) => w.id));

export async function GET() {
  return NextResponse.json(
    {
      workstreams: WORKSTREAMS.map((w) => ({
        ...w,
        seats: AGENTS.filter((a) => a.workstream === w.id).map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          why: a.why,
          skills: a.skills,
          needs: a.needs,
          handsTo: a.handsTo,
          humanGate: a.humanGate,
        })),
      })),
      agentCount: AGENTS.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const payload = body as { workstream?: unknown; company?: unknown; documents?: unknown };

  const full = payload.workstream === "full";

  if (!full && (typeof payload.workstream !== "string" || !VALID.has(payload.workstream as never))) {
    return NextResponse.json(
      { error: "Unknown workstream.", valid: [...VALID] },
      { status: 400 },
    );
  }

  const input = sanitizeUserInput(payload.company, 120, "Company name");
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }
  if (!/^[\p{L}\p{N}\s.,&'()\-]+$/u.test(input.value)) {
    return NextResponse.json(
      { error: "Enter a company name using letters, numbers and basic punctuation." },
      { status: 400 },
    );
  }

  const documents = acceptDocuments(payload.documents);

  try {
    if (full) {
      const review = await runFullReview(input.value, documents);
      return NextResponse.json(
        { mode: "full", ...review },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const run = await runWorkstream(
      payload.workstream as never,
      input.value,
      documents,
    );

    const { dossier, ...rest } = run;
    return NextResponse.json(
      {
        ...rest,
        subjectDetail: {
          name: dossier.resolved.name,
          cik: dossier.resolved.cik,
          exchanges: dossier.resolved.exchanges,
          sicDescription: dossier.resolved.sicDescription,
          filings: dossier.filings.length,
          news: dossier.news.length,
          documents: dossier.documents.length,
          financials: dossier.financials.map((f) => f.metric),
        },
        warnings: dossier.warnings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Workstream run failed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
