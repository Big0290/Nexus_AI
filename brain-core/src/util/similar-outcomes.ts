import type { SimilarOutcome } from '../lib/types.js';

/** Merge two ranked lists by outcome id, keeping the higher score per id. */
export function mergeSimilarOutcomes(a: SimilarOutcome[], b: SimilarOutcome[]): SimilarOutcome[] {
  const map = new Map<string, SimilarOutcome>();
  for (const s of [...a, ...b]) {
    const prev = map.get(s.memory.id);
    if (!prev || s.score > prev.score) map.set(s.memory.id, s);
  }
  return [...map.values()].sort((x, y) => y.score - x.score).slice(0, 8);
}
