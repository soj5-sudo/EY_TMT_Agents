"use client";

/**
 * Client fetch wrapper.
 *
 * Bare fetch throws "Failed to fetch" for every network-layer problem: server
 * down, connection dropped, request aborted. That string tells a user nothing
 * and sends them looking for a bug in the wrong place. This distinguishes the
 * cases and says what to do about each.
 */

export class ApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `The request took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. ` +
          `A full review across every workstream is the slowest call here; try a single workstream, or retry once the sources have warmed.`,
      );
    }
    throw new ApiError(
      "Could not reach the server. If you are running this locally, check that the dev server is still up on the port you have open.",
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON response, such as a plain-text refusal from the edge gate.
      if (!res.ok) throw new ApiError(text.slice(0, 300), res.status);
    }
  }

  if (!res.ok) {
    const payload = body as { error?: string; detail?: string; hint?: string } | null;
    const message =
      [payload?.error, payload?.detail, payload?.hint].filter(Boolean).join(" ") ||
      `The server returned ${res.status}.`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}
