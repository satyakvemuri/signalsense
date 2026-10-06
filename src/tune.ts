import "./env.js";
import { loadSeeds, listFamilyIds, listObservations, getObservation } from "./store.js";
import { createMem0ServiceFromEnv } from "./mem0.js";
import { syncObservations } from "./convergence.js";

// Probe queries: fine-motor phrasings that SHOULD converge, then noise-like ones that should NOT.
const SHOULD_CONVERGE = ["trouble with zippers this week", "dropping things a lot, hands seem clumsy", "handwriting got messy"];
const SHOULD_NOT = ["not sleeping well", "refuses to eat", "very moody today", "speech sounds slurred"];

// Loads seeds, syncs them to Mem0, then prints every cross-family score per probe so a threshold can be chosen.
async function main(): Promise<void> {
  const mem = createMem0ServiceFromEnv();
  if (!mem) throw new Error("Set MEM0_API_KEY (in .env or the environment) to tune against live Mem0");
  loadSeeds();
  console.log("sync:", await syncObservations(mem, listObservations()));
  for (const [label, probes] of [["SHOULD converge", SHOULD_CONVERGE], ["should NOT converge", SHOULD_NOT]] as const) {
    console.log(`\n== ${label} ==`);
    for (const q of probes) {
      const hits = await mem.search(q, listFamilyIds());
      console.log(`\n"${q}"`);
      for (const h of hits) {
        const o = h.observationId ? getObservation(h.observationId) : undefined;
        console.log(`  ${h.score.toFixed(3)}  ${(o?.familyId ?? h.familyId).padEnd(6)} ${JSON.stringify(h.categories).padEnd(14)} ${o?.text ?? h.text}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
