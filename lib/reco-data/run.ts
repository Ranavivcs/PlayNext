// Orchestrates a live recommendation run: load DB inputs → hard-filter → call
// the pure engine → persist the ranked output. The Supabase client is injected
// (service-role script vs user-scoped server action); recommendations /
// recommendation_items are owner-scoped, so writing user_id = userId satisfies
// RLS on the app path and is just an explicit value on the script path.

import type { SupabaseClient } from "@supabase/supabase-js";
import { recommend, analyzeTasteDiversity } from "../reco/recommend.ts";
import { buildIdf } from "../reco/vectorize.ts";
import type { ScoredGame } from "../reco/types.ts";
import { loadCatalog, loadFeaturesFor } from "./catalog.ts";
import { applyHardFilters, type HardFilters } from "./filters.ts";
import { loadUserContext } from "./user.ts";

export interface RunOptions {
  client: SupabaseClient;
  userId: string;
  filters?: HardFilters;
  topK?: number;
  mmrLambda?: number;
  /** Injectable reference time for the recency term (deterministic tests). */
  now?: Date;
  /** Persist to recommendations/recommendation_items (default true). */
  persist?: boolean;
  /**
   * Seed-based mode: when non-empty, taste comes ONLY from these games (the
   * user's Steam library is ignored for the taste vector), so a user without a
   * linked library — or one who wants recs based on specific games — can still
   * get recommendations. The user's owned library is still excluded from the
   * results (you don't want to be recommended games you already have).
   */
  seedAppIds?: number[];
}

export interface RunResult {
  results: ScoredGame[];
  /** Number of candidates after hard filters. */
  candidateCount: number;
  /** recommendations.id, or null when persist === false. */
  recId: string | null;
}

async function persistRun(
  client: SupabaseClient,
  userId: string,
  params: Record<string, unknown>,
  results: ScoredGame[],
): Promise<string> {
  const { data, error } = await client
    .from("recommendations")
    .insert({ user_id: userId, params })
    .select("id")
    .single();
  if (error) throw new Error(`recommendations insert: ${error.message}`);
  const recId = data.id as string;

  const items = results.map((r, i) => ({
    rec_id: recId,
    app_id: r.appId,
    rank: i + 1,
    score: r.score,
    score_breakdown: r.breakdown,
  }));
  if (items.length > 0) {
    const { error: itemsError } = await client
      .from("recommendation_items")
      .insert(items);
    if (itemsError) throw new Error(`recommendation_items insert: ${itemsError.message}`);
  }
  return recId;
}

export async function generateRecommendations(opts: RunOptions): Promise<RunResult> {
  const { client, userId, filters = {}, topK, mmrLambda, now, persist = true, seedAppIds } = opts;

  const [catalog, user] = await Promise.all([
    loadCatalog(client),
    loadUserContext(client, userId),
  ]);

  const useSeeds = Array.isArray(seedAppIds) && seedAppIds.length > 0;

  // Synthetic playtime for a liked / "more like this" game so it contributes to
  // the taste vector (weight = log(1 + minutes)) at roughly the strength of a
  // moderately-played owned game, without drowning a genuinely heavy library.
  const LIKED_TASTE_MINUTES = 600;

  // Seed mode: taste comes from the picked games (flat playtime → equal weight),
  // ignoring the Steam library. Otherwise taste comes from the owned library PLUS
  // any games the user liked / asked "more like this" (explicit positive feedback).
  const owned = useSeeds
    ? seedAppIds.map((appId) => ({ appId, playtimeMinutes: 60 }))
    : (() => {
        const byApp = new Map(user.owned.map((o) => [o.appId, o]));
        for (const appId of user.likedAppIds) {
          if (!byApp.has(appId)) byApp.set(appId, { appId, playtimeMinutes: LIKED_TASTE_MINUTES });
        }
        return [...byApp.values()];
      })();

  // Still never recommend games the user actually owns — in seed mode the real
  // library isn't the taste source but is folded into the exclusion set.
  const dismissedAppIds = useSeeds
    ? [...new Set([...user.dismissedAppIds, ...user.owned.map((o) => o.appId)])]
    : user.dismissedAppIds;

  const ownedFeatures = await loadFeaturesFor(
    client,
    owned.map((o) => o.appId),
  );

  const candidates = applyHardFilters(catalog, filters).map((e) => e.features);

  // ADAPTIVE TASTE: pick single-centroid vs clustered matching from how diverse
  // this user's library is (idf built the same way the engine does, so the
  // clustering is consistent). Focused taste → single; multi-genre → clustered
  // (which our evaluation showed recovers diverse libraries far better).
  const idf = buildIdf([...candidates, ...ownedFeatures]);
  const diversity = analyzeTasteDiversity(ownedFeatures, idf);

  const results = recommend({
    candidates,
    owned,
    ownedFeatures,
    preferredGenres: user.preferredGenres,
    preferredTags: user.preferredTags,
    preferredLength: user.preferredLength,
    dismissedAppIds,
    weights: user.weights,
    tasteMode: diversity.mode,
    topK,
    mmrLambda,
    now,
    // Use Kruskal-MST single-linkage clustering for diversity (the graph
    // algorithm), instead of MMR, on the live path.
    diversify: "mst",
  });

  let recId: string | null = null;
  if (persist) {
    recId = await persistRun(
      client,
      userId,
      {
        weights: user.weights,
        filters,
        preferredLength: user.preferredLength,
        topK: topK ?? null,
        mmrLambda: mmrLambda ?? null,
        seedAppIds: useSeeds ? seedAppIds : null,
        tasteMode: diversity.mode,
        tasteClusters: diversity.clusterCount,
      },
      results,
    );
  }

  return { results, candidateCount: candidates.length, recId };
}
