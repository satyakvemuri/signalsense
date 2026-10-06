import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignals, stageFor } from "./signals.js";
import type { Observation } from "./types.js";

const obs = (id: string, familyId: string, text: string, createdAt: string): Observation => ({ id, familyId, text, createdAt });
const data: Observation[] = [
  obs("o1", "fam_a", "buttons are getting harder for her lately", "2026-08-11T00:00:00Z"),
  obs("o2", "fam_b", "she stopped doing her embroidery", "2026-08-29T00:00:00Z"),
  obs("o3", "fam_c", "can't open the juice cap anymore", "2026-09-18T00:00:00Z"),
  obs("o4", "fam_a", "trouble with zippers this week", "2026-10-06T00:00:00Z"),
  obs("o5", "fam_b", "Up three times last night", "2026-08-04T00:00:00Z"),
  obs("o6", "fam_a", "awake till midnight", "2026-09-10T00:00:00Z"),
  obs("o7", "fam_c", "slurred words when tired", "2026-09-05T00:00:00Z"),
  obs("o8", "fam_b", "not categorized yet", "2026-10-01T00:00:00Z"),
];
const cats = new Map<string, string[]>([
  ["o1", ["fine_motor"]], ["o2", ["fine_motor"]], ["o3", ["fine_motor"]], ["o4", ["fine_motor"]],
  ["o5", ["sleep"]], ["o6", ["sleep"]], ["o7", ["speech"]],
]);

test("stages follow distinct-family counts", () => {
  assert.deepEqual([1, 2, 3, 5].map(stageFor), ["single", "echo", "converging", "converging"]);
});

test("fine motor groups 3 distinct families (a repeat from fam_a is a 2nd report, not a 2nd family)", () => {
  const r = buildSignals(data, cats, new Date("2026-10-06T00:01:00Z"));
  const fm = r.signals.find((s) => s.category === "fine_motor")!;
  assert.equal(fm.familyCount, 3);
  assert.equal(fm.reportCount, 4);
  assert.equal(fm.stage, "converging");
  assert.deepEqual(fm.families.map((f) => f.familyId), ["fam_a", "fam_b", "fam_c"]);
  assert.equal(fm.families[0]!.firstAt, "2026-08-11T00:00:00Z"); // fam_a's FIRST report, not its newest
  assert.equal(fm.firstAt, "2026-08-11T00:00:00Z");
  assert.equal(fm.lastAt, "2026-10-06T00:00:00Z");
});

test("quotes are verbatim and newest first", () => {
  const fm = buildSignals(data, cats).signals.find((s) => s.category === "fine_motor")!;
  assert.equal(fm.quotes[0]!.text, "trouble with zippers this week");
  assert.deepEqual(fm.quotes.map((q) => q.observationId), ["o4", "o3", "o2", "o1"]);
});

test("only watched signals with 2+ families get a drafted item; wording avoids verdict words", () => {
  const r = buildSignals(data, cats);
  const fm = r.signals.find((s) => s.category === "fine_motor")!;
  assert.match(fm.draft!.question, /^3 independent reports of difficulty with fine-motor tasks — candidate item for the next community questionnaire\.$/);
  assert.match(fm.draft!.item, /\?$/);
  assert.equal(r.signals.find((s) => s.category === "sleep")!.draft, null); // not watched
  assert.equal(r.signals.find((s) => s.category === "speech")!.stage, "single");
  for (const s of r.signals) assert.doesNotMatch(JSON.stringify(s.draft ?? ""), /confirm|proven|diagnos/i);
});

test("counts, ranking and uncategorized", () => {
  const r = buildSignals(data, cats);
  assert.equal(r.observationCount, 8);
  assert.equal(r.familyCount, 3);
  assert.equal(r.uncategorized, 1);
  assert.equal(r.signals[0]!.category, "fine_motor"); // most families first
});
