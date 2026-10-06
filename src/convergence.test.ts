import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNoVerdictWords,
  buildClusters,
  computeConvergence,
  draftQuestion,
  findConvergence,
  syncObservations,
} from "./convergence.js";
import type { MemoryHit, MemoryService, StoredMemory } from "./mem0.js";
import type { Observation } from "./types.js";

const seeds: Observation[] = [
  { id: "obs_1", familyId: "fam_a", text: "buttons are getting harder for her lately", createdAt: "2026-08-11T00:00:00Z" },
  { id: "obs_2", familyId: "fam_b", text: "she stopped doing her embroidery", createdAt: "2026-08-29T00:00:00Z" },
  { id: "obs_3", familyId: "fam_c", text: "can't open the juice cap anymore", createdAt: "2026-09-18T00:00:00Z" },
  { id: "obs_4", familyId: "fam_b", text: "Up three times last night, wide awake by 4am.", createdAt: "2026-08-04T00:00:00Z" },
  { id: "obs_5", familyId: "fam_a", text: "Falling asleep at the dinner table, awake till midnight.", createdAt: "2026-09-10T00:00:00Z" },
];
const lookup = (id: string) => seeds.find((o) => o.id === id);
const hit = (observationId: string, score: number, categories: string[]): MemoryHit => {
  const o = lookup(observationId)!;
  return { text: `enriched: ${o.text}`, score, familyId: o.familyId, categories, observationId };
};
const FM = ["fine_motor"];
const ALL_HITS = [
  hit("obs_1", 0.7, FM),
  hit("obs_2", 0.62, FM),
  hit("obs_3", 0.58, FM),
  hit("obs_4", 0.45, ["sleep"]),
  hit("obs_5", 0.41, ["sleep"]),
];

// A fake Mem0 that returns canned hits and a canned enriched memory for the poster.
function fakeMem(own: StoredMemory | null, hits: MemoryHit[]): MemoryService & { searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    add: async () => {},
    awaitMemory: async () => own,
    search: async (q) => (searches.push(q), hits),
    syncedObservationIds: async () => new Set(),
    categoriesByObservation: async () => new Map(),
  };
}

test("zippers posted by fam_a converges with embroidery + juice cap; own family and sleep hits ignored", async () => {
  const mem = fakeMem({ text: "User has trouble with zippers, fine motor / hand dexterity difficulty.", categories: FM }, ALL_HITS);
  const poster: Observation = { id: "obs_11", familyId: "fam_a", text: "trouble with zippers this week", createdAt: "x" };
  const c = await findConvergence(mem, poster, ["fam_a", "fam_b", "fam_c"], lookup);
  assert.equal(c.count, 2);
  assert.deepEqual(c.matches.map((m) => m.text), ["she stopped doing her embroidery", "can't open the juice cap anymore"]);
  assert.match(mem.searches[0]!, /fine motor/); // searched with the enriched text, not the raw post
});

test("a sleep post does not converge (not a watched theme) and skips the search", async () => {
  const mem = fakeMem({ text: "sleep disturbance", categories: ["sleep"] }, ALL_HITS);
  const poster: Observation = { id: "obs_12", familyId: "fam_c", text: "up all night again", createdAt: "x" };
  const c = await findConvergence(mem, poster, ["fam_a", "fam_b", "fam_c"], lookup);
  assert.deepEqual(c, { available: true, count: 0, matches: [] });
  assert.equal(mem.searches.length, 0);
});

test("if Mem0 hasn't categorized the post in time, falls back to the raw text and watched categories", async () => {
  const mem = fakeMem(null, ALL_HITS);
  const poster: Observation = { id: "obs_13", familyId: "fam_a", text: "trouble with zippers this week", createdAt: "x" };
  const c = await findConvergence(mem, poster, ["fam_a", "fam_b", "fam_c"], lookup, 1);
  assert.equal(c.count, 2);
  assert.equal(mem.searches[0], "trouble with zippers this week");
});

test("a memory that exists but has no categories yet falls back to watched categories and still uses the enriched text", async () => {
  const mem = fakeMem({ text: "enriched fine motor text", categories: [] }, ALL_HITS);
  const poster: Observation = { id: "obs_14", familyId: "fam_a", text: "trouble with zippers this week", createdAt: "x" };
  const c = await findConvergence(mem, poster, ["fam_a", "fam_b", "fam_c"], lookup);
  assert.equal(c.count, 2);
  assert.equal(mem.searches[0], "enriched fine motor text");
});

test("count is DISTINCT families: two strong hits from one family count once, best score kept", () => {
  const extra: Observation = { id: "obs_9", familyId: "fam_b", text: "drops her needle", createdAt: "x" };
  const lk = (id: string) => (id === "obs_9" ? extra : lookup(id));
  const hits = [hit("obs_2", 0.6, FM), { text: "x", score: 0.7, familyId: "fam_b", categories: FM, observationId: "obs_9" }];
  const c = computeConvergence(hits, lk, { excludeFamilyId: "fam_a", categoryIds: FM, threshold: 0.4 });
  assert.equal(c.count, 1);
  assert.equal(c.matches[0]!.score, 0.7);
});

test("hits below the score floor do not converge", () => {
  const hits = [hit("obs_2", 0.3, FM), hit("obs_3", 0.39, FM)];
  assert.equal(computeConvergence(hits, lookup, { excludeFamilyId: "fam_a", categoryIds: FM, threshold: 0.4 }).count, 0);
});

test("hits for observations not in the current store (orphans from earlier runs) are ignored", () => {
  const hits = [hit("obs_2", 0.5, FM), { text: "stale", score: 0.9, familyId: "fam_c", categories: FM, observationId: "obs_gone" }];
  const c = computeConvergence(hits, lookup, { excludeFamilyId: "fam_a", categoryIds: FM, threshold: 0.25 });
  assert.deepEqual(c.matches.map((m) => m.familyId), ["fam_b"]);
});

test("falls back to Mem0's own family/text when the observation id is unknown", () => {
  const hits: MemoryHit[] = [{ text: "stored text", score: 0.9, familyId: "fam_z", categories: FM }];
  const c = computeConvergence(hits, lookup, { excludeFamilyId: "fam_a", categoryIds: FM, threshold: 0.4 });
  assert.deepEqual(c.matches, [{ familyId: "fam_z", text: "stored text", score: 0.9 }]);
});

test("clusters need 2+ distinct families and carry verbatim quotes and the drafted question", async () => {
  const clusters = await buildClusters(fakeMem(null, ALL_HITS), ["fam_a", "fam_b", "fam_c"], lookup);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.familyCount, 3);
  assert.equal(
    clusters[0]!.question,
    "3 independent reports of difficulty with fine-motor tasks — candidate item for the next community questionnaire.",
  );
  assert.ok(clusters[0]!.quotes.some((q) => q.text === "she stopped doing her embroidery"));

  const single = await buildClusters(fakeMem(null, [hit("obs_1", 0.9, FM)]), ["fam_a"], lookup);
  assert.equal(single.length, 0);
});

test("verdict words are rejected in generated text", () => {
  for (const bad of ["confirmed pattern", "this is proven", "a diagnosis", "Diagnostic", "confirms it"]) {
    assert.throws(() => assertNoVerdictWords(bad), /banned verdict word/);
  }
  assert.doesNotThrow(() => draftQuestion(2, "difficulty with fine-motor tasks"));
  assert.throws(() => draftQuestion(2, "a confirmed condition"));
});

test("sync is idempotent: second run adds nothing", async () => {
  const store = new Map<string, Set<string>>();
  const adds: string[] = [];
  const mem: Pick<MemoryService, "add" | "syncedObservationIds"> = {
    add: async (o) => {
      adds.push(o.id);
      (store.get(o.familyId) ?? store.set(o.familyId, new Set()).get(o.familyId)!).add(o.id);
    },
    syncedObservationIds: async (f) => new Set(store.get(f) ?? []),
  };
  assert.deepEqual(await syncObservations(mem, seeds), { added: 5, skipped: 0 });
  assert.deepEqual(await syncObservations(mem, seeds), { added: 0, skipped: 5 });
  assert.equal(adds.length, 5);
});
