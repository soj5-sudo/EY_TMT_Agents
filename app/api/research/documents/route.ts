import { NextResponse } from "next/server";
import { DocumentError, ingest } from "@/lib/research/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES_PER_REQUEST = 5;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Upload must be sent as multipart form data." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload could not be read." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Attach at least one file." }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Attach at most ${MAX_FILES_PER_REQUEST} files at a time.` },
      { status: 400 },
    );
  }

  const added = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const file of files) {
    try {
      added.push(await ingest(file));
    } catch (err) {
      failed.push({
        name: file.name,
        reason:
          err instanceof DocumentError ? err.message : "The file could not be processed.",
      });
    }
  }

  return NextResponse.json(
    { added, failed },
    {
      status: added.length === 0 ? 400 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
