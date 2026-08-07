import type { Provenance } from "@/lib/core/types";

export function PageHeader({
  index,
  title,
  lede,
  meta,
}: {
  index: string;
  title: string;
  lede: string;
  meta?: React.ReactNode;
}) {
  return (
    <header style={{ paddingTop: 48, paddingBottom: 32 }}>
      <p className="t-label">Dashboard {index}</p>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
          marginTop: 14,
        }}
      >
        <h1 className="t-h2" style={{ maxWidth: "18ch" }}>
          {title}
        </h1>
        {meta}
      </div>
      <p className="t-body" style={{ marginTop: 16, maxWidth: "72ch" }}>
        {lede}
      </p>
      <hr className="rule-strong" style={{ marginTop: 28 }} />
    </header>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
  flush = false,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="t-label-dark">{title}</h2>
          {hint && (
            <p className="t-small" style={{ marginTop: 6, fontSize: 12, maxWidth: "70ch" }}>
              {hint}
            </p>
          )}
        </div>
        {actions}
      </div>
      <div className={flush ? "panel-body-flush" : "panel-body"}>{children}</div>
    </section>
  );
}

export function Prov({ p }: { p: Provenance }) {
  const label: Record<Provenance["kind"], string> = {
    live: "Live",
    cached: "Cached",
    filing: "From filing",
    baseline: "Baseline",
    unavailable: "Unavailable",
  };

  const when = (() => {
    const d = new Date(p.retrievedAt);
    if (Number.isNaN(d.getTime())) return p.retrievedAt;
    return d.toLocaleString("en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  })();

  return (
    <span
      className="prov"
      data-kind={p.kind}
      title={`${p.source}${p.note ? `. ${p.note}` : ""}`}
    >
      {label[p.kind]} · {when}
    </span>
  );
}

export function NotSet() {
  return <span style={{ color: "var(--text-muted)" }}>Not reported</span>;
}

export function Delta({
  value,
  digits = 1,
  suffix = "%",
}: {
  value: number | null;
  digits?: number;
  suffix?: string;
}) {
  if (value === null || !Number.isFinite(value)) return <NotSet />;
  const cls = value > 0 ? "delta-up" : value < 0 ? "delta-down" : "delta-flat";
  return (
    <span className={cls}>
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}

export function StatBlock({
  label,
  value,
  sub,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="stat" data-emphasis={emphasis}>
      <p className="t-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: 1,
        background: "var(--border-hairline)",
        border: "1px solid var(--border-hairline)",
      }}
    >
      {children}
    </div>
  );
}

export function Stack({
  gap = 24,
  children,
}: {
  gap?: number;
  children: React.ReactNode;
}) {
  return <div style={{ display: "grid", gap }}>{children}</div>;
}
