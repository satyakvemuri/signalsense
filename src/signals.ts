import { CATEGORIES, THEMES } from "./themes.js";
import { assertNoVerdictWords, draftQuestion } from "./convergence.js";
import type { Observation, Signal, SignalStage, SignalsResponse } from "./types.js";

// Maps a distinct-family count to its stage: 1 single note, 2 echo, 3+ converging.
export function stageFor(familyCount: number): SignalStage {
  return familyCount >= 3 ? "converging" : familyCount === 2 ? "echo" : "single";
}

// Groups observations by their Mem0 category into signals, ranked by family count then recency.
export function buildSignals(
  observations: Observation[],
  categoriesById: Map<string, string[]>,
  now: Date = new Date(),
): SignalsResponse {
  const byCategory = new Map<string, Observation[]>();
  let uncategorized = 0;
  for (const o of observations) {
    const cats = categoriesById.get(o.id) ?? [];
    const known = cats.filter((c) => CATEGORIES.some((k) => k.id === c));
    if (known.length === 0) uncategorized++;
    for (const c of known) (byCategory.get(c) ?? byCategory.set(c, []).get(c)!).push(o);
  }

  const signals: Signal[] = [];
  for (const cat of CATEGORIES) {
    const obs = (byCategory.get(cat.id) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (obs.length === 0) continue;
    const firstByFamily = new Map<string, string>();
    for (const o of obs) if (!firstByFamily.has(o.familyId)) firstByFamily.set(o.familyId, o.createdAt);
    const familyCount = firstByFamily.size;
    const theme = THEMES.find((t) => t.categoryId === cat.id);
    signals.push({
      category: cat.id,
      label: assertNoVerdictWords(cat.label),
      area: cat.area,
      watched: cat.watched,
      stage: stageFor(familyCount),
      familyCount,
      reportCount: obs.length,
      firstAt: obs[0]!.createdAt,
      lastAt: obs[obs.length - 1]!.createdAt,
      families: [...firstByFamily].map(([familyId, firstAt]) => ({ familyId, firstAt })),
      quotes: obs
        .slice()
        .reverse()
        .map((o) => ({ observationId: o.id, familyId: o.familyId, text: o.text, createdAt: o.createdAt })),
      draft:
        cat.watched && theme && familyCount >= 2
          ? { item: assertNoVerdictWords(theme.item), question: draftQuestion(familyCount, theme.label) }
          : null,
    });
  }
  signals.sort((a, b) => b.familyCount - a.familyCount || b.lastAt.localeCompare(a.lastAt));

  return {
    generatedAt: now.toISOString(),
    observationCount: observations.length,
    familyCount: new Set(observations.map((o) => o.familyId)).size,
    uncategorized,
    signals,
  };
}
