"use client";

import { useMemo, useState } from "react";
import { UNIVERSE, SECTORS, type Company } from "@/lib/data/universe";

export function CompanyPicker({
  value,
  onChange,
  label = "Company",
}: {
  value: string;
  onChange: (symbol: string) => void;
  label?: string;
}) {
  const [sector, setSector] = useState<string>("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UNIVERSE.filter((c) => {
      if (sector !== "All" && c.sector !== sector) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.short.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
      );
    });
  }, [sector, query]);

  const filers = filtered.filter((c) => c.secFiler);
  const others = filtered.filter((c) => !c.secFiler);

  return (
    <div className="picker">
      <div className="picker-controls">
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label className="t-label" htmlFor="picker-search">{label}</label>
          <input
            id="picker-search"
            className="input"
            value={query}
            placeholder="Search the universe"
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 2 }}>
          {["All", ...SECTORS].map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              data-active={sector === s}
              onClick={() => setSector(s)}
              aria-pressed={sector === s}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="picker-list" role="listbox" aria-label="Companies">
        {filers.map((c) => (
          <Option key={c.symbol} company={c} active={value === c.symbol} onChange={onChange} />
        ))}
        {others.length > 0 && (
          <>
            <div className="picker-divider">
              Listed outside the US. No SEC statements available.
            </div>
            {others.map((c) => (
              <Option key={c.symbol} company={c} active={value === c.symbol} onChange={onChange} disabled />
            ))}
          </>
        )}
        {filtered.length === 0 && (
          <p className="t-small" style={{ padding: 14 }}>
            Nothing matches that search.
          </p>
        )}
      </div>
    </div>
  );
}

function Option({
  company,
  active,
  onChange,
  disabled = false,
}: {
  company: Company;
  active: boolean;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="picker-item"
      data-active={active}
      disabled={disabled}
      onClick={() => onChange(company.symbol)}
      role="option"
      aria-selected={active}
      title={disabled ? "Not an SEC registrant" : company.name}
    >
      <span className="picker-name">{company.short}</span>
      <span className="picker-meta">{company.subsector}</span>
    </button>
  );
}
