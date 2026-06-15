// Orchestrator for content-based ranking. Pure: no DB/network/LLM/random.
// Two stages: full re-score → shortlist → MMR diversity → topK.

import type { GameFeatures, RecommendInput, ScoredGame } from "./types.ts";
import { buildIdf, gameVector, tasteVector, cosine, type SparseVector } from "./vectorize.ts";
import { popularityScore, recencyScore, preferenceScore, graphScore } from "./score.ts";
import { mmrRerank } from "./mmr.ts";
import {
  buildSimilarityGraph,
  dijkstra,
  kruskalMST,
  mstClusters,
  clusterByMst,
  type SimGraph,
} from "./graph.ts";

const DEFAULT_TOP_K = 10;
const DEFAULT_MMR_LAMBDA = 0.7;
const SHORTLIST_FACTOR = 4;
const DEFAULT_GRAPH_K = 10;
// Cap the similarity-graph node count (build is O(n^2)). The topK always comes
// from the highest base-scored candidates, so graphing the head is sufficient.
const GRAPH_MAX_NODES = 800;
// Clustered taste: owned games linked by an MST edge of distance ≤ this (i.e.
// cosine similarity ≥ 1 − this) share a taste cluster; less-similar games split
// into separate clusters (orphans become singletons). Tuned via the eval harness.
const CLUSTER_MAX_DIST = 0.8;

/**
 * Build the content taste as one or more centroids. "single" returns the lone
 * playtime-weighted centroid over all owned games. "clustered" groups owned
 * games via MST single-linkage (reusing the graph/union-find machinery) and
 * returns one playtime-weighted centroid per cluster, so a candidate can match
 * the user's NEAREST taste cluster instead of a blurry all-games average.
 */
function buildTasteCentroids(
  ownedFeatures: GameFeatures[],
  playtimeByApp: Map<number, number>,
  idf: Map<string, number>,
  mode: "single" | "clustered",
  graphK: number,
): SparseVector[] {
  if (ownedFeatures.length === 0) return [];
  const single = () => {
    const t = tasteVector(ownedFeatures, playtimeByApp, idf);
    return t.size > 0 ? [t] : [];
  };
  if (mode === "single" || ownedFeatures.length < 2) return single();

  // Cluster the owned games (single-linkage MST cut) and build one playtime-
  // weighted centroid per cluster.
  const groups = clusterByMst(ownedFeatures, idf, graphK, CLUSTER_MAX_DIST);
  const centroids: SparseVector[] = [];
  for (const idxs of groups) {
    const members = idxs.map((i) => ownedFeatures[i]);
    const c = tasteVector(members, playtimeByApp, idf);
    if (c.size > 0) centroids.push(c);
  }
  return centroids.length > 0 ? centroids : single();
}

/** How diverse a user's taste is, from clustering their owned games. */
export interface TasteDiversity {
  /** Total taste clusters (incl. singletons). */
  clusterCount: number;
  /** Clusters with ≥2 games — distinct genre groupings. */
  multiGameClusters: number;
  /** Recommended taste representation: "clustered" when the library forms more
   *  than one taste cluster (a single average would blur distinct groupings);
   *  "single" only for an essentially monolithic library. */
  mode: "single" | "clustered";
}

/**
 * Analyze a user's taste diversity by clustering their owned games. A library
 * with ≥2 multi-game clusters (e.g. shooters AND sports sims) is "diverse" and
 * benefits from nearest-cluster (clustered) matching; an essentially single-
 * cluster library is "focused" and is best served by one averaged centroid.
 * Pure — the engine/bridge uses this to pick `tasteMode` per user.
 */
export function analyzeTasteDiversity(
  ownedFeatures: GameFeatures[],
  idf: Map<string, number>,
  graphK: number = DEFAULT_GRAPH_K,
  maxDist: number = CLUSTER_MAX_DIST,
): TasteDiversity {
  if (ownedFeatures.length < 2) {
    return { clusterCount: ownedFeatures.length, multiGameClusters: 0, mode: "single" };
  }
  const groups = clusterByMst(ownedFeatures, idf, graphK, maxDist);
  const multiGameClusters = groups.filter((g) => g.length >= 2).length;
  return {
    clusterCount: groups.length,
    multiGameClusters,
    // More than one cluster ⇒ distinct tastes a single centroid would blur, so
    // match each candidate to the user's NEAREST cluster. One cluster ⇒ a
    // monolithic, focused library where a single averaged centroid is best.
    mode: groups.length >= 2 ? "clustered" : "single",
  };
}

interface Candidate {
  scored: ScoredGame;
  vector: SparseVector;
}

/**
 * Pick `topK` items spreading across MST clusters: one best-scoring item per
 * fresh cluster first (diversity), then fill remaining slots by score. Items
 * arrive already sorted by score descending.
 */
function mstDiversify(
  items: Candidate[],
  clusterByApp: Map<number, number>,
  topK: number,
): Candidate[] {
  const result: Candidate[] = [];
  const usedClusters = new Set<number>();
  const chosen = new Set<number>();

  for (const item of items) {
    if (result.length >= topK) break;
    const cluster = clusterByApp.get(item.scored.appId) ?? -1;
    if (!usedClusters.has(cluster)) {
      result.push(item);
      usedClusters.add(cluster);
      chosen.add(item.scored.appId);
    }
  }
  for (const item of items) {
    if (result.length >= topK) break;
    if (!chosen.has(item.scored.appId)) result.push(item);
  }
  return result;
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

  const tasteCentroids = buildTasteCentroids(
    ownedFeatures,
    playtimeByApp,
    idf,
    input.tasteMode ?? "single",
    input.graphK ?? DEFAULT_GRAPH_K,
  );
  const hasTaste = tasteCentroids.length > 0;
  // Content similarity = best match across taste clusters (nearest cluster).
  const contentSim = (vec: SparseVector): number => {
    let best = 0;
    for (const c of tasteCentroids) {
      const s = cosine(c, vec);
      if (s > best) best = s;
    }
    return best;
  };

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

  // Phase 1: cheap non-graph scoring for every candidate (no O(n^2) work yet).
  interface Base {
    game: GameFeatures;
    vector: SparseVector;
    content: number;
    preference: number;
    popularity: number;
    recency: number;
    baseScore: number;
  }
  const base: Base[] = [];
  for (const game of input.candidates) {
    if (excluded.has(game.appId)) continue;
    const vector = gameVector(game, idf);
    const content = weights.content * (hasTaste ? contentSim(vector) : 0);
    const preference =
      weights.preference *
      preferenceScore(game, input.preferredGenres, input.preferredTags, input.preferredLength);
    const popularity =
      weights.popularity * popularityScore(game.totalReviews, game.positiveRatio, maxLogReviews);
    const recency = weights.recency * recencyScore(game.releaseDate, now);
    base.push({
      game,
      vector,
      content,
      preference,
      popularity,
      recency,
      baseScore: content + preference + popularity + recency,
    });
  }

  // Phase 2: graph algorithms (Dijkstra similarity + Kruskal-MST diversity).
  // O(n^2), so cap the node set to the top candidates by base score (∪ owned) —
  // the topK always comes from this head anyway. Only built when needed.
  const graphWeight = weights.graph ?? 0;
  const useMst = (input.diversify ?? "mmr") === "mst";
  let graphSimByApp: Map<number, number> | null = null;
  let clusterByApp: Map<number, number> | null = null;
  if (graphWeight > 0 || useMst) {
    const topByBase = [...base]
      .sort((a, b) => b.baseScore - a.baseScore)
      .slice(0, GRAPH_MAX_NODES)
      .map((b) => b.game);
    const featByApp = new Map<number, GameFeatures>();
    for (const g of topByBase) featByApp.set(g.appId, g);
    for (const f of ownedFeatures) if (!featByApp.has(f.appId)) featByApp.set(f.appId, f);
    const graph: SimGraph = buildSimilarityGraph(
      [...featByApp.values()],
      idf,
      input.graphK ?? DEFAULT_GRAPH_K,
    );

    if (graphWeight > 0) {
      // Multi-source Dijkstra from the owned games (taste sources at distance 0).
      const sources = new Map<number, number>();
      for (const o of input.owned) {
        const idx = graph.indexByApp.get(o.appId);
        if (idx !== undefined) sources.set(idx, 0);
      }
      const dist = dijkstra(graph, sources);
      graphSimByApp = new Map();
      for (let i = 0; i < graph.n; i++) {
        graphSimByApp.set(graph.appIds[i], graphScore(dist[i]));
      }
    }
    if (useMst) {
      const clusters = mstClusters(kruskalMST(graph), graph.n, topK);
      clusterByApp = new Map();
      for (let i = 0; i < graph.n; i++) clusterByApp.set(graph.appIds[i], clusters[i]);
    }
  }

  // Phase 3: fold in the graph term and assemble final scored candidates.
  const scored: Candidate[] = base.map((b) => {
    const breakdown = {
      content: b.content,
      preference: b.preference,
      popularity: b.popularity,
      recency: b.recency,
      collab: weights.collab * 0, // CF deferred; kept 0 so breakdown still sums to score.
      graph: graphWeight * (graphSimByApp?.get(b.game.appId) ?? 0),
    };
    const score = b.baseScore + breakdown.collab + breakdown.graph;
    return {
      scored: { appId: b.game.appId, name: b.game.name, score, breakdown },
      vector: b.vector,
    };
  });

  scored.sort((a, b) => b.scored.score - a.scored.score);

  // Stage 2: re-rank a shortlist for diversity, then take topK.
  const shortlist = scored.slice(0, Math.max(topK, topK * SHORTLIST_FACTOR));
  if (useMst && clusterByApp) {
    return mstDiversify(shortlist, clusterByApp, topK).map((c) => c.scored);
  }
  const reranked = mmrRerank(
    shortlist.map((c) => ({ ...c, score: c.scored.score })),
    mmrLambda,
    topK,
  );
  return reranked.map((c) => c.scored);
}
