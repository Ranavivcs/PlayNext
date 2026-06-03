// TF-IDF content vectors over genre/tag features. Pure: no DB/network/random.
// Vectors are sparse Maps keyed by namespaced terms ("g:<genre>" / "t:<tag>").

import type { GameFeatures } from "./types.ts";

export type SparseVector = Map<string, number>;

/** Namespaced feature terms for a game: genres as `g:`, tags as `t:`. */
export function terms(game: GameFeatures): string[] {
  const out: string[] = [];
  for (const g of game.genres) out.push(`g:${g}`);
  for (const t of game.tags) out.push(`t:${t}`);
  return out;
}

/**
 * Smoothed inverse document frequency over a corpus. Rare terms get a larger
 * idf (weigh more); the +1 smoothing keeps values positive and avoids div-by-0.
 * idf(t) = ln((1 + N) / (1 + df)) + 1
 */
export function buildIdf(corpus: GameFeatures[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const game of corpus) {
    for (const term of new Set(terms(game))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = corpus.length;
  const idf = new Map<string, number>();
  for (const [term, d] of df) {
    idf.set(term, Math.log((1 + n) / (1 + d)) + 1);
  }
  return idf;
}

function l2normalize(vec: SparseVector): SparseVector {
  let sumSq = 0;
  for (const v of vec.values()) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  for (const [k, v] of vec) vec.set(k, v / norm);
  return vec;
}

/** L2-normalized TF-IDF vector for a single game (binary term frequency). */
export function gameVector(game: GameFeatures, idf: Map<string, number>): SparseVector {
  const vec: SparseVector = new Map();
  for (const term of terms(game)) {
    const w = idf.get(term) ?? 0;
    if (w !== 0) vec.set(term, w);
  }
  return l2normalize(vec);
}

/** Cosine similarity of two sparse vectors (robust to non-normalized input). */
export function cosine(a: SparseVector, b: SparseVector): number {
  // Iterate the smaller vector for the dot product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const o = large.get(k);
    if (o !== undefined) dot += v * o;
  }
  let na = 0;
  for (const v of a.values()) na += v * v;
  let nb = 0;
  for (const v of b.values()) nb += v * v;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Playtime-weighted centroid of the owned games' vectors (the "taste vector").
 * Each owned game contributes with weight = log(1 + minutes), so heavily played
 * games dominate but lightly played ones still count. Result is L2-normalized.
 * Returns an empty vector when there is nothing owned (cold start).
 */
export function tasteVector(
  ownedFeatures: GameFeatures[],
  playtimeByApp: Map<number, number>,
  idf: Map<string, number>,
): SparseVector {
  const acc: SparseVector = new Map();
  for (const game of ownedFeatures) {
    const minutes = playtimeByApp.get(game.appId) ?? 0;
    const weight = Math.log(1 + Math.max(0, minutes));
    if (weight === 0) continue;
    const vec = gameVector(game, idf);
    for (const [term, v] of vec) {
      acc.set(term, (acc.get(term) ?? 0) + weight * v);
    }
  }
  return l2normalize(acc);
}
