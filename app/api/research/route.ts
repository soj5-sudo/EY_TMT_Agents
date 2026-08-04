import { NextResponse } from "next/server";
import { research, resolveCompany } from "@/lib/research/company";
import { acceptDocuments } from "@/lib/research/documents";
import { sanitizeUserInput } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const input = sanitizeUserInput((body as { company?: unknown })?.company, 120, "Company name");
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  // Company names are letters, digits and a small punctuation set. Anything
  // else is a probe rather than a query.
  if (!/^[\p{L}\p{N}\s.,&'()\-]+$/u.test(input.value)) {
    return NextResponse.json(
      { error: "Enter a company name using letters, numbers and basic punctuation." },
      { status: 400 },
    );
  }

  const documents = acceptDocuments((body as { documents?: unknown }).documents);

  try {
    const dossier = await research(input.value, documents);
    return NextResponse.json(dossier, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Research run failed.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/** Type-ahead resolution for the company field. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const input = sanitizeUserInput(q, 80, "Company name");
  if (!input.ok) return NextResponse.json({ matches: [] });

  try {
    const resolved = await resolveCompany(input.value);
    return NextResponse.json(
      {
        best: resolved.name,
        cik: resolved.cik,
        symbol: resolved.symbol,
        matches: resolved.candidates,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ matches: [] });
  }
}
