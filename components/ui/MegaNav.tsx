"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Destination {
  index: string;
  href: string;
  title: string;
  summary: string;
  detail: string;
}

const DESTINATIONS: Destination[] = [
  {
    index: "01",
    href: "/",
    title: "Sector signal",
    summary: "Technology, media and telecom",
    detail:
      "Live coverage across fifty six names. Transaction activity, deal flow, hiring, and the AI build cycle, against prices for every constituent and five reference indices.",
  },
  {
    index: "02",
    href: "/dashboard/financials",
    title: "Quarterly P&L",
    summary: "Reported results",
    detail:
      "Consolidated income statement quarter by quarter, an income statement bridge, expense by nature, and the cash flow summary. Rupees or dollars.",
  },
  {
    index: "03",
    href: "/dashboard/kpi",
    title: "KPI detail",
    summary: "What sits under the headline",
    detail:
      "Revenue distribution by market and domain on four growth bases, client concentration, headcount, attrition, and derived unit economics.",
  },
];

const TOOLS: Destination[] = [
  {
    index: "04",
    href: "/research",
    title: "Company research",
    summary: "Any company, on demand",
    detail:
      "Name a company. The agent pulls its filing history, reported financials, market position and verified coverage, and accepts private documents alongside.",
  },
  {
    index: "05",
    href: "/agents",
    title: "Diligence OS",
    summary: "Forty seven seats, ten workstreams",
    detail:
      "Screening through to committee paper, plus portfolio monitoring. Each seat holds a role, declares its evidence, and hands to the next. Gaps become the document request list.",
  },
];

export function MegaNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Route change closes the panel.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onPointer = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        close();
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  const go = (href: string) => {
    close();
    router.push(href);
  };

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="burger"
        aria-expanded={open}
        aria-controls="mega-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        data-open={open}
      >
        <span className="burger-label">{open ? "Close" : "Menu"}</span>
        <span className="burger-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div className="mega-scrim" data-open={open} aria-hidden="true" />

      <div
        id="mega-panel"
        ref={panelRef}
        className="mega"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Dashboards"
        inert={!open ? true : undefined}
      >
        <div className="mega-inner">
          <div className="mega-head">
            <span className="t-label">Dashboards</span>
            <span className="t-label" style={{ color: "var(--text-muted)" }}>
              Technology, media and telecom
            </span>
          </div>

          <div className="mega-grid">
            {DESTINATIONS.map((d, i) => (
              <Link
                key={d.href}
                href={d.href}
                className="mega-item"
                data-active={active(d.href)}
                style={{ transitionDelay: open ? `${80 + i * 55}ms` : "0ms" }}
                onClick={(e) => {
                  e.preventDefault();
                  go(d.href);
                }}
              >
                <span className="mega-index">{d.index}</span>
                <span className="mega-title">{d.title}</span>
                <span className="mega-summary">{d.summary}</span>
                <span className="mega-detail">{d.detail}</span>
              </Link>
            ))}
          </div>

          <div className="mega-head" style={{ marginTop: 40 }}>
            <span className="t-label">Analysis tools</span>
          </div>

          <div className="mega-grid mega-grid-two">
            {TOOLS.map((d, i) => (
              <Link
                key={d.href}
                href={d.href}
                className="mega-item"
                data-active={active(d.href)}
                style={{ transitionDelay: open ? `${245 + i * 55}ms` : "0ms" }}
                onClick={(e) => {
                  e.preventDefault();
                  go(d.href);
                }}
              >
                <span className="mega-index">{d.index}</span>
                <span className="mega-title">{d.title}</span>
                <span className="mega-summary">{d.summary}</span>
                <span className="mega-detail">{d.detail}</span>
              </Link>
            ))}
          </div>
          <div className="mega-foot">
            <Link href="/terms" className="foot-link" onClick={() => go("/terms")}>
              Terms and sources
            </Link>
            <a
              className="foot-link"
              href="https://jewellabs.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              Developed by Jewel Labs
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
