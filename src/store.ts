import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { NewObservation, Observation } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(here, "../seed/observations.json");

const observations: Observation[] = [];
let nextId = 1;

// Checks that an unknown parsed JSON value has string id/familyId/text/createdAt.
function isObservation(value: unknown): value is Observation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.familyId === "string" &&
    typeof v.text === "string" &&
    typeof v.createdAt === "string"
  );
}

// Reads seed/observations.json, validates every entry, fills the store, and returns how many were loaded.
export function loadSeeds(): number {
  const parsed: unknown = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Seed file ${SEED_PATH} must contain a JSON array`);
  }
  parsed.forEach((entry, i) => {
    if (!isObservation(entry)) {
      throw new Error(
        `Seed entry ${i} is invalid: id, familyId, text and createdAt must all be strings`,
      );
    }
  });

  observations.length = 0;
  observations.push(...(parsed as Observation[]));

  // Continue numbering after the highest obs_<n> seed id (or the seed count, whichever is larger).
  let maxN = observations.length;
  for (const o of observations) {
    const m = /^obs_(\d+)$/.exec(o.id);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  nextId = maxN + 1;

  return observations.length;
}

// Returns a copy of every observation currently in the store.
export function listObservations(): Observation[] {
  return [...observations];
}

// Creates a new observation with a fresh id and timestamp, stores it, and returns it.
export function addObservation(input: NewObservation): Observation {
  const observation: Observation = {
    id: `obs_${nextId++}`,
    familyId: input.familyId,
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  observations.push(observation);
  return observation;
}
