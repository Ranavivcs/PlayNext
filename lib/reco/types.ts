// Pure recommendation-engine types. No DB/network/LLM here — this module only
// computes scores from data it is handed.

export interface Weights {
  content: number;
  preference: number;
  popularity: number;
  recency: number;
  collab: number;
  /** Graph-similarity term (Dijkstra shortest-path on the game graph). Optional
   *  so older callers/persisted rows without it default to 0. */
  graph?: number;
}

/** Game-length / time-investment bucket (from median total playtime). */
export type GameLength = "short" | "medium" | "long";

/** Feature record for a single game (one row of the catalog). */
export interface GameFeatures {
  appId: number;
  name: string;
  genres: string[];
  tags: string[];
  /** Total review count; drives the (damped) popularity term. */
  totalReviews: number;
  /** Share of positive reviews, 0..1; gates popularity by quality. */
  positiveRatio: number;
  /** ISO date (yyyy-mm-dd) used for the recency term; optional. */
  releaseDate?: string | null;
  /** Median total playtime in minutes (SteamSpy median_forever); length proxy. */
  medianPlaytimeMinutes?: number | null;
  /** Optional dense semantic vector (Phase 4); unused until embeddings exist. */
  embedding?: number[];
}

/** A game the user owns, with implicit-feedback playtime. */
export interface OwnedGame {
  appId: number;
  playtimeMinutes: number;
}

export interface RecommendInput {
  /** Catalog to rank. Owned/dismissed entries are filtered out of the result. */
  candidates: GameFeatures[];
  /** The user's owned games (taste signal + exclusion). */
  owned: OwnedGame[];
  /**
   * Features for the owned games, used to build the taste vector. If omitted,
   * owned features are taken from `candidates` by matching appId.
   */
  ownedFeatures?: GameFeatures[];
  preferredGenres?: string[];
  preferredTags?: string[];
  /** Preferred game length; folded into the preference term. */
  preferredLength?: GameLength | null;
  dismissedAppIds?: number[];
  weights: Weights;
  /** How many results to return (default 10). */
  topK?: number;
  /** MMR trade-off: 1 = pure relevance, 0 = pure diversity (default 0.7). */
  mmrLambda?: number;
  /** Neighbours per node in the similarity graph (Dijkstra/MST). Default 10. */
  graphK?: number;
  /** Diversity method for the final shortlist (default "mmr"). "mst" uses
   *  Kruskal single-linkage clustering to spread results across clusters. */
  diversify?: "mmr" | "mst";
  /** Reference time for the recency term (injectable for deterministic tests). */
  now?: Date;
}

/** Per-component weighted contributions; these sum to `score`. */
export interface ScoreBreakdown {
  content: number;
  preference: number;
  popularity: number;
  recency: number;
  collab: number;
  graph: number;
}

export interface ScoredGame {
  appId: number;
  name: string;
  score: number;
  breakdown: ScoreBreakdown;
}
