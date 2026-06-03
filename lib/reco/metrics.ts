// Ranking-quality metrics with binary relevance. Pure.
// `ranked` is the predicted ordering of ids; `relevant` is the ground-truth set.

function isRel(id: number, relevant: Set<number>): number {
  return relevant.has(id) ? 1 : 0;
}

/** Discounted cumulative gain over the top-k (binary gains). */
export function dcgAtK(ranked: number[], relevant: Set<number>, k: number): number {
  let dcg = 0;
  const n = Math.min(k, ranked.length);
  for (let i = 0; i < n; i++) {
    dcg += isRel(ranked[i], relevant) / Math.log2(i + 2);
  }
  return dcg;
}

/** Ideal DCG: as if all relevant items were ranked first. */
function idealDcgAtK(relevantCount: number, k: number): number {
  let idcg = 0;
  const n = Math.min(k, relevantCount);
  for (let i = 0; i < n; i++) idcg += 1 / Math.log2(i + 2);
  return idcg;
}

/** Normalized DCG@k in [0, 1]; 0 when there are no relevant items. */
export function ndcgAtK(ranked: number[], relevant: Set<number>, k: number): number {
  const idcg = idealDcgAtK(relevant.size, k);
  if (idcg === 0) return 0;
  return dcgAtK(ranked, relevant, k) / idcg;
}

/** Fraction of the top-k that is relevant. */
export function precisionAtK(ranked: number[], relevant: Set<number>, k: number): number {
  if (k <= 0) return 0;
  const n = Math.min(k, ranked.length);
  let hits = 0;
  for (let i = 0; i < n; i++) hits += isRel(ranked[i], relevant);
  return hits / k;
}

/** Fraction of relevant items found in the top-k. */
export function recallAtK(ranked: number[], relevant: Set<number>, k: number): number {
  if (relevant.size === 0) return 0;
  const n = Math.min(k, ranked.length);
  let hits = 0;
  for (let i = 0; i < n; i++) hits += isRel(ranked[i], relevant);
  return hits / relevant.size;
}

/** Average precision over the full ranking; 0 when there are no relevant items. */
export function averagePrecision(ranked: number[], relevant: Set<number>): number {
  if (relevant.size === 0) return 0;
  let hits = 0;
  let sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) {
      hits++;
      sum += hits / (i + 1);
    }
  }
  return sum / relevant.size;
}

/** Reciprocal rank of the first relevant item; 0 if none appear. */
export function reciprocalRank(ranked: number[], relevant: Set<number>): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}
