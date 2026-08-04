/**
 * Shared contracts.
 *
 * The central idea in this app is that no number reaches a screen without a
 * Provenance attached to it. Charts, tables and the chatbot all read the same
 * envelope, so "where did this come from" is answerable from any surface.
 */

export type ProvenanceKind =
  /** Fetched from the upstream source within this request's TTL window. */
  | "live"
  /** Served from the local cache; upstream was not re-contacted. */
  | "cached"
  /** Parsed from a company filing document. */
  | "filing"
  /** Upstream failed and the checked-in baseline was substituted. */
  | "baseline"
  /** Upstream failed and there is no fallback. Render "Not set". */
  | "unavailable";

export interface Provenance {
  kind: ProvenanceKind;
  /** Human-readable origin, shown in the UI. */
  source: string;
  /** Canonical URL of the origin document or endpoint, when there is one. */
  url?: string;
  /** ISO timestamp of when the underlying data was retrieved. */
  retrievedAt: string;
  /** ISO timestamp the source itself declares, when it publishes one. */
  sourceDatedAt?: string;
  /** Present when kind is "baseline" or "unavailable". */
  note?: string;
}

export interface Envelope<T> {
  data: T;
  provenance: Provenance;
}

export function envelope<T>(data: T, provenance: Provenance): Envelope<T> {
  return { data, provenance };
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------- *
 * Market data
 * ---------------------------------------------------------------- */

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  previousClose: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketState: string | null;
  exchange: string | null;
  /** Epoch seconds of the last regular-market print. */
  asOf: number | null;
}

export interface SeriesPoint {
  t: number;
  close: number;
}

export interface FxRates {
  base: string;
  date: string;
  rates: Record<string, number>;
}

/* ---------------------------------------------------------------- *
 * News
 * ---------------------------------------------------------------- */

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  /** Registrable domain of the publisher, used for the source drawer. */
  publisherDomain: string;
  /** 1 primary and wire, 2 financial press, 3 trade press. */
  publisherTier: 1 | 2 | 3;
  publishedAt: string | null;
  /** Which watchlist query surfaced this item. */
  topic: string;
  /** Classifier output. Heuristic, and labelled as such in the UI. */
  category: NewsCategory;
  /** Entities matched against the coverage universe. */
  companies: string[];
  /** Sector the surfacing query belongs to. */
  sector: "Technology" | "Media" | "Telecom" | "Cross-sector";
}

export type NewsCategory =
  | "earnings"
  | "deal"
  | "m&a"
  | "leadership"
  | "workforce"
  | "guidance"
  | "capex"
  | "regulation"
  | "product"
  | "general";

/* ---------------------------------------------------------------- *
 * Agents
 * ---------------------------------------------------------------- */

export type AgentStatus = "idle" | "running" | "ok" | "partial" | "failed";

export interface AgentSkill {
  id: string;
  name: string;
  /** What the skill does, in one line, shown in the agent console. */
  summary: string;
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  /** Longer description shown on the agent card. */
  brief: string;
  skills: AgentSkill[];
}

export interface AgentStep {
  at: string;
  skillId: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** Milliseconds the step took. */
  ms: number;
}

export interface AgentFinding {
  id: string;
  severity: "info" | "attention" | "risk";
  headline: string;
  detail: string;
  /** Where the finding's evidence came from. */
  evidence: Provenance[];
  /** Numeric backing, when the finding is quantitative. */
  metric?: { label: string; value: string };
}

export interface AgentRun {
  runId: string;
  agentId: string;
  agentName: string;
  status: AgentStatus;
  startedAt: string;
  finishedAt: string | null;
  ms: number;
  steps: AgentStep[];
  findings: AgentFinding[];
  /** Free-text summary composed from the findings. Never model-invented. */
  summary: string;
  /** Documents or datasets the run produced, offered as downloads. */
  artifacts: AgentArtifact[];
}

export interface AgentArtifact {
  id: string;
  name: string;
  kind: "csv" | "json" | "pdf-link";
  /** Route that serves the artifact, or an upstream URL for pdf-link. */
  href: string;
  bytes: number | null;
  description: string;
}
