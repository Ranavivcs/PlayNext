// Maximal Marginal Relevance re-ranking for diversity. Pure.

import { cosine, type SparseVector } from "./vectorize.ts";

export interface MmrItem {
  score: number;
  vector: SparseVector;
}

/**
 * Greedy MMR: repeatedly select the item maximizing
 *   λ·score − (1−λ)·maxSimToAlreadySelected
 * λ=1 is pure relevance (returns items by score); λ=0 is pure diversity.
 * Returns up to k items in selection order.
 */
export function mmrRerank<T extends MmrItem>(items: T[], lambda: number, k: number): T[] {
  const limit = Math.min(k, items.length);

  // λ ≥ 1 is pure relevance: the diversity term is zeroed, so the greedy result
  // is exactly the top-k by score. Skip the O(k·n) similarity work (a stable sort
  // preserves input order among score ties, matching the greedy tie-break).
  if (lambda >= 1) {
    return items.slice().sort((a, b) => b.score - a.score).slice(0, limit);
  }

  const pool = items.slice();
  const selected: T[] = [];

  while (selected.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const s of selected) {
        const sim = cosine(pool[i].vector, s.vector);
        if (sim > maxSim) maxSim = sim;
      }
      const value = lambda * pool[i].score - (1 - lambda) * maxSim;
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    }
    selected.push(pool[bestIdx]);
    pool.splice(bestIdx, 1);
  }
  return selected;
}
