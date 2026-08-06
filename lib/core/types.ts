export type ProvenanceKind =
  | "live"
  | "cached"
  | "filing"
  | "baseline"
  | "unavailable";

export interface Provenance {
  kind: ProvenanceKind;
  source: string;
  url?: string;
  retrievedAt: string;
  sourceDatedAt?: string;
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

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publisherDomain: string;
  publisherTier: 1 | 2 | 3;
  verified?: boolean;
  publishedAt: string | null;
  topic: string;
  category: NewsCategory;
  companies: string[];
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

export type AgentStatus = "idle" | "running" | "ok" | "partial" | "failed";

export interface AgentSkill {
  id: string;
  name: string;
  summary: string;
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  brief: string;
  skills: AgentSkill[];
}

export interface AgentStep {
  at: string;
  skillId: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  ms: number;
}

export interface AgentFinding {
  id: string;
  severity: "info" | "attention" | "risk";
  headline: string;
  detail: string;
  evidence: Provenance[];
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
  summary: string;
  artifacts: AgentArtifact[];
}

export interface AgentArtifact {
  id: string;
  name: string;
  kind: "csv" | "json" | "pdf-link";
  href: string;
  bytes: number | null;
  description: string;
}
