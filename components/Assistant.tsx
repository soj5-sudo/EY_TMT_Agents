"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Citation } from "@/lib/rag/answer";
import { apiFetch } from "@/lib/client/api";

/**
 * Analyst assistant.
 *
 * Answers from the console's own corpus only: the three dashboards, the parsed
 * filings, the live feeds and the product documentation. Citations are rendered
 * under every answer, and any passage that came from a third party is flagged
 * so the reader knows the difference between a filed figure and a headline.
 */

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  mode?: "extractive" | "generative";
  confidence?: "high" | "moderate" | "low";
  usedUntrusted?: boolean;
  notice?: string | null;
  failed?: boolean;
}

const SUGGESTIONS = [
  "Why did the operating margin fall?",
  "How much of the growth is currency?",
  "What is happening to attrition?",
  "Which vertical is shrinking?",
];

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      setError(null);
      setValue("");
      const userTurn: Turn = {
        id: `u${Date.now()}`,
        role: "user",
        text: trimmed,
      };
      setTurns((prev) => [...prev, userTurn]);
      setBusy(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });

        const json = await res.json();

        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            {
              id: `a${Date.now()}`,
              role: "assistant",
              text:
                json.error ??
                `The assistant returned ${res.status}. Try again in a moment.`,
              failed: true,
            },
          ]);
          return;
        }

        setTurns((prev) => [
          ...prev,
          {
            id: `a${Date.now()}`,
            role: "assistant",
            text: json.text,
            citations: json.citations ?? [],
            mode: json.mode,
            confidence: json.confidence,
            usedUntrusted: json.usedUntrusted,
            notice: json.injectionNotice ?? null,
          },
        ]);
      } catch (err) {
        setTurns((prev) => [
          ...prev,
          {
            id: `a${Date.now()}`,
            role: "assistant",
            text:
              err instanceof Error
                ? `Could not reach the assistant: ${err.message}`
                : "Could not reach the assistant.",
            failed: true,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-primary no-print"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 70,
          minWidth: 168,
        }}
      >
        {open ? "Close assistant" : "Ask the data"}
      </button>

      {open && (
        <div
          id="assistant-panel"
          ref={panelRef}
          role="dialog"
          aria-label="Analyst assistant"
          className="no-print"
          style={{
            position: "fixed",
            right: 24,
            bottom: 76,
            zIndex: 69,
            width: "min(440px, calc(100vw - 48px))",
            maxHeight: "min(640px, calc(100vh - 140px))",
            background: "var(--surface)",
            border: "1px solid var(--border-emphasis)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--border-hairline)",
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span className="t-label-dark">Analyst assistant</span>
            <span className="t-small" style={{ fontSize: 11 }}>
              Answers from console data only
            </span>
          </div>

          <div
            ref={logRef}
            style={{ overflowY: "auto", padding: 16, display: "grid", gap: 18, flex: 1 }}
          >
            {turns.length === 0 && (
              <div>
                <p className="t-small">
                  Ask about the filings, the dashboards, the live feeds, or how a
                  metric should be read. Answers cite the passage they came from.
                </p>
                <div className="legend" style={{ marginTop: 14, gap: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chip"
                      onClick={() => ask(s)}
                      style={{ height: "auto", padding: "6px 10px", textTransform: "none", letterSpacing: 0 }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id}>
                  <p className="t-label" style={{ marginBottom: 6 }}>You</p>
                  <p style={{ fontSize: 14, lineHeight: 1.55 }}>{turn.text}</p>
                </div>
              ) : (
                <div key={turn.id}>
                  <p className="t-label" style={{ marginBottom: 6 }}>
                    Assistant
                    {turn.confidence ? ` · ${turn.confidence} match` : ""}
                  </p>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: turn.failed ? "var(--danger)" : "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {turn.text}
                  </div>

                  {turn.notice && (
                    <p className="t-small" style={{ marginTop: 10, fontSize: 12 }}>
                      {turn.notice}
                    </p>
                  )}

                  {turn.citations && turn.citations.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
                      <p className="t-label" style={{ marginBottom: 8, fontSize: 10 }}>
                        Sources
                      </p>
                      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                        {turn.citations.map((c) => (
                          <li key={c.n} className="t-small" style={{ fontSize: 12 }}>
                            {c.url ? (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                style={{ textDecoration: "underline", textUnderlineOffset: 3 }}
                              >
                                {c.title}
                              </a>
                            ) : (
                              c.title
                            )}
                            {" · "}
                            {c.source}
                            {c.untrusted && (
                              <span style={{ color: "var(--warning)" }}>
                                {" "}
                                (third-party text, reproduced not verified)
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              ),
            )}

            {busy && (
              <div>
                <p className="t-label" style={{ marginBottom: 6 }}>Assistant</p>
                <div className="skel" style={{ height: 12, width: "80%" }} />
                <div className="skel" style={{ height: 12, width: "62%", marginTop: 8 }} />
                <div className="skel" style={{ height: 12, width: "71%", marginTop: 8 }} />
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(value);
            }}
            style={{ borderTop: "1px solid var(--border-hairline)", padding: 12 }}
          >
            {error && (
              <p className="t-small" style={{ color: "var(--danger)", marginBottom: 8 }}>
                {error}
              </p>
            )}
            <textarea
              ref={inputRef}
              className="textarea"
              rows={2}
              value={value}
              maxLength={600}
              placeholder="Why did the operating margin fall?"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(value);
                }
              }}
              style={{ resize: "none", fontSize: 14 }}
              aria-label="Your question"
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
                gap: 12,
              }}
            >
              <span className="t-small" style={{ fontSize: 11 }}>
                {value.length}/600
              </span>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || value.trim().length === 0}
                data-loading={busy}
                style={{ minHeight: 34, padding: "8px 18px" }}
              >
                {busy ? "Working" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
