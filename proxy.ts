import { NextResponse, type NextRequest } from "next/server";
import {
  assessClient,
  clientId,
  rateLimit,
  rateLimitHeaders,
  sameOrigin,
  type LimitKind,
} from "@/lib/security/guard";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

function limitKindFor(pathname: string): LimitKind {
  if (pathname.startsWith("/api/chat")) return "chat";
  if (pathname.startsWith("/api/research/documents")) return "upload";
  if (pathname.startsWith("/api/research")) return "research";
  if (pathname.startsWith("/api/agents")) return "agent";
  if (pathname.startsWith("/api/")) return "api";
  return "page";
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const id = clientId(request.headers);
  const kind = limitKindFor(pathname);

  const assessment = assessClient(request.headers);

  if (assessment.automated) {
    return new NextResponse(
      "Automated access is not permitted.\n" +
        "This console serves interactive users only.\n" +
        (assessment.reason ? `Reason: ${assessment.reason}\n` : ""),
      {
        status: 403,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  }

  if (pathname.startsWith("/api/") && !sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not accepted by this endpoint." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limit = rateLimit(id, kind);
  if (!limit.allowed) {
    return new NextResponse(
      `Rate limit reached. Try again in ${limit.resetInSeconds} seconds.`,
      {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(limit.resetInSeconds),
          "Cache-Control": "no-store",
          ...rateLimitHeaders(limit),
        },
      },
    );
  }

  const response = NextResponse.next();
  for (const [k, v] of Object.entries(rateLimitHeaders(limit))) {
    response.headers.set(k, v);
  }
  if (pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store, private");
  }
  return response;
}
