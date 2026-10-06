import type { Cluster, Convergence, ConvergenceMatch, Observation } from "./types.js";
import type { MemoryHit, MemoryService } from "./mem0.js";
import { THEMES, watchedCategoryIds } from "./themes.js";
import type { Theme } from "./themes.js";

// Minimum Mem0 score for a same-category hit to count; a floor against junk (the category gate does the real separating; live same-category hits scored 0.32-0.41).
export const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD) || 0.25;

// How long POST waits for Mem0 to finish enriching the poster's own memory before falling back.
export const SETTLE_TIMEOUT_MS = 20_000;

const VERDICT_WORDS = /\b(confirm\w*|prov(?:en|ed|es|e)|diagnos\w*)\b/i;

// Throws if generated text contains a verdict word (confirmed, proven, diagnosis…); returns the text otherwise.
export function assertNoVerdictWords(text: string): string {
  const hit = VERDICT_WORDS.exec(text);
  if (hit) throw new Error(`Generated text contains banned verdict word "${hit[0]}": ${text}`);
  return text;
}

// Options for picking which hits count as matches.
export interface MatchOptions {
  excludeFamilyId: string | null; // the poster's family, whose own hits never count
  categoryIds: string[] | null; // hit must share one of these categories (null = no category gate)
  threshold?: number;
}

// Turns raw Mem0 hits into one best match per OTHER family, with verbatim quotes from our own store.
export function bestMatchPerOtherFamily(
  hits: MemoryHit[],
  lookup: (id: string) => Observation | undefined,
  { excludeFamilyId, categoryIds, threshold = MATCH_THRESHOLD }: MatchOptions,
): ConvergenceMatch[] {
  const best = new Map<string, ConvergenceMatch>();
  for (const h of hits) {
    const obs = h.observationId ? lookup(h.observationId) : undefined;
    if (h.observationId && !obs) continue; // orphan from an earlier run: not in this store, so no verbatim quote
    const familyId = obs?.familyId ?? h.familyId;
    if (!familyId || familyId === excludeFamilyId || h.score < threshold) continue;
    if (categoryIds && !h.categories.some((c) => categoryIds.includes(c))) continue;
    const prev = best.get(familyId);
    if (!prev || h.score > prev.score) {
      best.set(familyId, { familyId, text: obs?.text ?? h.text, score: h.score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// Builds the convergence result from hits that were already searched.
export function computeConvergence(
  hits: MemoryHit[],
  lookup: (id: string) => Observation | undefined,
  options: MatchOptions,
): Convergence {
  const matches = bestMatchPerOtherFamily(hits, lookup, options);
  return { available: true, count: matches.length, matches };
}

// Mirrors a new observation to Mem0, waits for it to be categorized, and finds other families reporting the same watched theme.
export async function findConvergence(
  mem: MemoryService,
  observation: Observation,
  familyIds: string[],
  lookup: (id: string) => Observation | undefined,
  settleTimeoutMs: number = SETTLE_TIMEOUT_MS,
): Promise<Convergence> {
  await mem.add(observation);
  const own = await mem.awaitMemory(observation, settleTimeoutMs);
  const watched = watchedCategoryIds();
  // If Mem0 categorized the post and none of its categories is watched, there is nothing to converge on.
  // If it hasn't categorized it (or hasn't finished at all), let the hits' own categories decide.
  const categoryIds = own && own.categories.length > 0 ? own.categories.filter((c) => watched.includes(c)) : watched;
  if (categoryIds.length === 0) return { available: true, count: 0, matches: [] };
  const hits = await mem.search(own?.text ?? observation.text, familyIds);
  return computeConvergence(hits, lookup, { excludeFamilyId: observation.familyId, categoryIds });
}

// Drafts the community-questionnaire prompt for a cluster, rejecting any verdict wording.
export function draftQuestion(count: number, label: string): string {
  return assertNoVerdictWords(
    `${count} independent reports of ${label} — candidate item for the next community questionnaire.`,
  );
}

// Searches Mem0 once per watched theme and returns the themes reported by 2+ distinct families.
export async function buildClusters(
  mem: Pick<MemoryService, "search">,
  familyIds: string[],
  lookup: (id: string) => Observation | undefined,
  themes: Theme[] = THEMES,
  threshold: number = MATCH_THRESHOLD,
): Promise<Cluster[]> {
  const clusters: Cluster[] = [];
  for (const theme of themes) {
    const hits = await mem.search(theme.query, familyIds);
    const quotes = bestMatchPerOtherFamily(hits, lookup, {
      excludeFamilyId: null,
      categoryIds: [theme.categoryId],
      threshold,
    });
    if (quotes.length >= 2) {
      clusters.push({
        theme: assertNoVerdictWords(theme.label),
        familyCount: quotes.length,
        quotes,
        question: draftQuestion(quotes.length, theme.label),
      });
    }
  }
  return clusters;
}

// Adds every observation Mem0 doesn't already hold (matched by observation id); returns counts.
export async function syncObservations(
  mem: Pick<MemoryService, "add" | "syncedObservationIds">,
  observations: Observation[],
): Promise<{ added: number; skipped: number }> {
  const synced = new Map<string, Set<string>>();
  let added = 0;
  let skipped = 0;
  for (const o of observations) {
    if (!synced.has(o.familyId)) synced.set(o.familyId, await mem.syncedObservationIds(o.familyId));
    if (synced.get(o.familyId)!.has(o.id)) {
      skipped++;
      continue;
    }
    await mem.add(o);
    added++;
  }
  return { added, skipped };
}
