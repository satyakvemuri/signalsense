// A single free-text observation a family member logged about their loved one.
export interface Observation {
  id: string;
  familyId: string; // anonymous family ID, e.g. "fam_a"
  text: string;
  createdAt: string; // ISO 8601 timestamp
}

// Body accepted by POST /api/observations (server assigns id + createdAt).
export type NewObservation = Pick<Observation, "familyId" | "text">;
