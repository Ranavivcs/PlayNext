// Orchestrator for content-based ranking. Pure: no DB/network/LLM/random.
// Two stages: full re-score → shortlist → MMR diversity → topK.

import type { GameFeatures, RecommendInput, ScoredGame } from "./types.ts";
import { buildIdf, gameVector, tasteVector, cosine, type SparseVector } from "./vectorize.ts";
import { popularityScore, recencyScore, preferenceScore } from "./score.ts";
import { mmrRerank } from "./mmr.ts";

const DEFAULT_TOP_K = 10;
const DEFAULT_MMR_LAMBDA = 0.7;
const SHORTLIST_FACTOR = 4;

interface Candidate {
  scored: ScoredGame;
  vector: SparseVector;
}

/** Resolve features for owned games: explicit list, else matched from candidates. */
function resolveOwnedFeatures(input: RecommendInput): GameFeatures[] {
  if (input.ownedFeatures && input.ownedFeatures.length > 0) return input.ownedFeatures;
  const ownedIds = new Set(input.owned.map((o) => o.appId));
  return input.candidates.filter((c) => ownedIds.has(c.appId));
}

export function recommend(input: RecommendInput): ScoredGame[] {
  const topK = input.topK ?? DEFAULT_TOP_K;
  const mmrLambda = input.mmrLambda ?? DEFAULT_MMR_LAMBDA;
  const now = input.now ?? new Date();
  const weights = input.weights;

  const ownedFeatures = resolveOwnedFeatures(input);

  // IDF over the full known universe (candidates + owned) so term rarity is stable.
  const idf = buildIdf([...input.candidates, ...ownedFeatures]);

  const playtimeByApp = new Map<number, number>();
  for (const o of input.owned) playtimeByApp.set(o.appId, o.playtimeMinutes);

  const taste = tasteVector(ownedFeatures, playtimeByApp, idf);
  const hasTaste = taste.size > 0;

  // Corpus max for popularity normalization (over candidates).
  let maxLogReviews = 0;
  for (const c of input.candidates) {
    const lr = Math.log(1 + Math.max(0, c.totalReviews));
    if (lr > maxLogReviews) maxLogReviews = lr;
  }

  const excluded = new Set<number>([
    ...input.owned.map((o) => o.appId),
    ...(input.dismissedAppIds ?? []),
  ]);

  const scored: Candidate[] = [];
  for (const game of input.candidates) {
    if (excluded.has(game.appId)) continue;

    const vector = gameVector(game, idf);
    const contentRaw = hasTaste ? cosine(taste, vector) : 0;
    const prefRaw = preferenceScore(
      game,
      input.preferredGenres,
      input.preferredTags,
      input.preferredLength,
    );
    const popRaw = popularityScore(game.totalReviews, game.positiveRatio, maxLogReviews);
    const recRaw = recencyScore(game.releaseDate, now);

    const breakdown = {
      content: weights.content * contentRaw,
      preference: weights.preference * prefRaw,
      popularity: weights.popularity * popRaw,
      recency: weights.recency * recRaw,
      collab: weights.collab * 0, // CF deferred; kept 0 so breakdown still sums to score.
    };
    const score =
      breakdown.content +
      breakdown.preference +
      breakdown.popularity +
      breakdown.recency +
      breakdown.collab;

    scored.push({ scored: { appId: game.appId, name: game.name, score, breakdown }, vector });
  }

  scored.sort((a, b) => b.scored.score - a.scored.score);

  // Stage 2: re-rank a shortlist for diversity, then take topK.
  const shortlist = scored.slice(0, Math.max(topK, topK * SHORTLIST_FACTOR));
  const reranked = mmrRerank(
    shortlist.map((c) => ({ ...c, score: c.scored.score })),
    mmrLambda,
    topK,
  );
  return reranked.map((c) => c.scored);
}
