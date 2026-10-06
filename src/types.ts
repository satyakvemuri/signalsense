// A single free-text observation a family member logged about their loved one.
export interface Observation {
  id: string;
  familyId: string; // anonymous family ID, e.g. "fam_a"
  text: string;
  createdAt: string; // ISO 8601 timestamp
}

// Body accepted by POST /api/observations (server assigns id + createdAt).
export type NewObservation = Pick<Observation, "familyId" | "text">;

// One other-family observation that semantically resembles the text a family just posted.
export interface ConvergenceMatch {
  familyId: string;
  text: string; // verbatim quote from the other family's observation
  score: number; // Mem0 similarity score (higher = closer)
}

// How many DISTINCT other families described something similar, with their quotes.
export interface Convergence {
  available: boolean; // false when Mem0 is not configured or the lookup failed
  count: number;
  matches: ConvergenceMatch[];
}

// Body returned by POST /api/observations.
export interface CreateObservationResponse {
  observation: Observation;
  convergence: Convergence;
}

// A theme that appears in 2+ distinct families, with verbatim quotes and a drafted question.
export interface Cluster {
  theme: string;
  familyCount: number;
  quotes: ConvergenceMatch[];
  question: string;
}

// Body returned by GET /api/clusters.
export interface ClustersResponse {
  clusters: Cluster[];
}

// One verbatim observation shown under a signal, newest first.
export interface SignalQuote {
  observationId: string;
  familyId: string;
  text: string;
  createdAt: string;
}

// How far a signal has travelled: one family, two independent families, or three or more.
export type SignalStage = "single" | "echo" | "converging";

// A functional domain (Mem0 category) with every family that reported it.
export interface Signal {
  category: string;
  label: string;
  area: string;
  watched: boolean;
  stage: SignalStage;
  familyCount: number;
  reportCount: number;
  firstAt: string;
  lastAt: string;
  families: { familyId: string; firstAt: string }[]; // each family once, with when it first reported
  quotes: SignalQuote[]; // verbatim, newest first
  draft: { item: string; question: string } | null; // only for watched signals with 2+ families
}

// Body returned by GET /api/signals.
export interface SignalsResponse {
  generatedAt: string;
  observationCount: number;
  familyCount: number;
  uncategorized: number; // observations Mem0 has not categorized yet
  signals: Signal[]; // most families first, then most recent
}
