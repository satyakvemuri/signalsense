import { MemoryClient } from "mem0ai";
import { CATEGORIES, ENRICH_INSTRUCTIONS } from "./themes.js";
import type { Observation } from "./types.js";

// One memory returned by a Mem0 search, reduced to the fields signalsense uses.
export interface MemoryHit {
  text: string; // Mem0's enriched sentence (NOT the verbatim quote — quotes come from our own store)
  score: number;
  familyId: string;
  categories: string[];
  observationId?: string; // links the memory back to our own store for verbatim quotes
}

// The enriched memory Mem0 produced for one observation, once its async processing finished.
export interface StoredMemory {
  text: string;
  categories: string[];
}

// The slice of Mem0 signalsense depends on; tests swap in a fake that implements this.
export interface MemoryService {
  add(observation: Observation): Promise<void>;
  awaitMemory(observation: Observation, timeoutMs: number): Promise<StoredMemory | null>;
  search(query: string, familyIds: string[]): Promise<MemoryHit[]>;
  syncedObservationIds(familyId: string): Promise<Set<string>>;
}

const SEARCH_TOP_K = 20;
const POLL_INTERVAL_MS = 700;
const CATEGORY_GRACE_MS = 4000; // how long to wait for categories once the memory exists
const CUSTOM_CATEGORIES = CATEGORIES.map((c) => ({ [c.id]: c.description }));

// Reads the observation id we stored in a memory's metadata (tolerating key-case conversion).
function readObservationId(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const m = metadata as Record<string, unknown>;
  const v = m.observation ?? m.observation_id ?? m.observationId;
  return typeof v === "string" ? v : undefined;
}

// Normalises Mem0's categories field (array, null or missing) to a string array.
function readCategories(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Pauses for the given number of milliseconds.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps the hosted Mem0 platform client in the small MemoryService interface.
export function createMem0Service(apiKey: string): MemoryService {
  const client = new MemoryClient({ apiKey });

  return {
    // Queues one observation in Mem0 under its family; Mem0 enriches + categorizes it asynchronously (~4s).
    async add(o) {
      await client.add([{ role: "user", content: o.text }], {
        userId: o.familyId,
        metadata: { observation: o.id },
        customCategories: CUSTOM_CATEGORIES,
        customInstructions: ENRICH_INSTRUCTIONS,
      });
    },

    // Polls until Mem0 has processed this observation AND attached categories (they land ~0.6s after the memory itself); null on timeout.
    async awaitMemory(o, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let firstSeen: number | null = null;
      let latest: StoredMemory | null = null;
      while (Date.now() < deadline) {
        const res = await client.getAll({
          filters: { AND: [{ user_id: o.familyId }, { metadata: { observation: o.id } }] },
          pageSize: 10,
        });
        const m = (res.results ?? [])[0];
        if (m) {
          firstSeen ??= Date.now();
          latest = { text: m.memory ?? m.data?.memory ?? o.text, categories: readCategories(m.categories) };
          if (latest.categories.length > 0 || Date.now() - firstSeen > CATEGORY_GRACE_MS) return latest;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      return latest;
    },

    // Semantic search across all given families at once (v3 search needs filters, not top-level user_id).
    async search(query, familyIds) {
      const { results } = await client.search(query, {
        filters: { OR: familyIds.map((id) => ({ user_id: id })) },
        topK: SEARCH_TOP_K,
      });
      return (results ?? []).map((r) => ({
        text: r.memory ?? r.data?.memory ?? "",
        score: r.score ?? 0,
        familyId: r.userId ?? (r as { user_id?: string }).user_id ?? "",
        categories: readCategories(r.categories),
        observationId: readObservationId(r.metadata),
      }));
    },

    // Lists the observation ids already stored in Mem0 for one family (used to skip re-syncing).
    async syncedObservationIds(familyId) {
      const ids = new Set<string>();
      for (let page = 1; ; page++) {
        const res = await client.getAll({ filters: { user_id: familyId }, page, pageSize: 100 });
        for (const r of res.results ?? []) {
          const id = readObservationId(r.metadata);
          if (id) ids.add(id);
        }
        if (!res.next) break;
      }
      return ids;
    },
  };
}

// Builds the real Mem0 service if MEM0_API_KEY is set, otherwise returns null (features degrade gracefully).
export function createMem0ServiceFromEnv(): MemoryService | null {
  const apiKey = process.env.MEM0_API_KEY;
  return apiKey ? createMem0Service(apiKey) : null;
}
