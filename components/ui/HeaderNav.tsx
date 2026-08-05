"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Masthead navigation, to the measurements ey.com ships: one-rem bold links on
 * the charcoal bar with the yellow underline carrying the active state.
 */
const LINKS = [
  { href: "/", label: "Sector signal" },
  { href: "/dashboard/financials", label: "Quarterly P&L" },
  { href: "/dashboard/kpi", label: "KPI detail" },
  { href: "/research", label: "Research" },
  { href: "/agents", label: "Diligence OS" },
];

export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav className="masthead-nav" aria-label="Primary">
      {LINKS.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className="masthead-link"
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
