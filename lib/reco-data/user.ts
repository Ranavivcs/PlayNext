// Load per-user inputs for a recommendation run: owned games (taste +
// exclusion), tunable weights + soft preferences, and dismissed games. Client
// injected: a service-role script bypasses RLS; a server action passes the
// user's own client so the owner-only policies apply.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameLength, OwnedGame, Weights } from "../reco/types.ts";

// Default weights — content-led, per the offline evaluation (scripts/eval-*.ts,
// docs/progress.md): content/graph similarity carry personalization; popularity
// and recency only break ties (small) since a popularity-led mix tanks relevance
// (~85x worse NDCG than content). Small popularity/recency are kept for quality
// signal + discovery, not ranking. `graph` = Dijkstra similarity term.
export const DEFAULT_WEIGHTS: Weights = {
  content: 0.5,
  preference: 0.2,
  popularity: 0.05,
  recency: 0.05,
  collab: 0.1,
  graph: 0.25,
};

// "Adaptive" recommendation style: weights chosen per run from the user's
// library shape (analyzeTasteDiversity.mode). Both keep popularity ≈ 0 per the
// eval. FOCUSED libraries → content-dominant, minimal graph (graph slightly
// hurts a single coherent taste). DIVERSE libraries → boost the Dijkstra graph
// term (transitive similarity across taste clusters recovers them far better).
export const ADAPTIVE_WEIGHTS: Record<"single" | "clustered", Weights> = {
  single: { content: 0.6, preference: 0.2, popularity: 0.05, recency: 0.05, collab: 0.1, graph: 0.1 },
  clustered: { content: 0.45, preference: 0.2, popularity: 0.05, recency: 0.05, collab: 0.1, graph: 0.4 },
};

export interface UserContext {
  owned: OwnedGame[];
  weights: Weights;
  /** True when the user's style is "adaptive": ignore `weights` and let the run
   *  compute them per library shape (ADAPTIVE_WEIGHTS). */
  adaptiveWeights: boolean;
  preferredGenres: string[];
  preferredTags: string[];
  preferredLength: GameLength | null;
  dismissedAppIds: number[];
  /** Games the user liked / asked "more like this" — extra taste boosters. */
  likedAppIds: number[];
}

const LENGTHS: readonly GameLength[] = ["short", "medium", "long"];
function coerceLength(raw: unknown): GameLength | null {
  return typeof raw === "string" && (LENGTHS as readonly string[]).includes(raw)
    ? (raw as GameLength)
    : null;
}

const PAGE = 1000;

/** True when the stored weights jsonb means "adaptive": nothing stored (the
 *  product default) or the explicit { adaptive: true } sentinel. */
function isAdaptiveStored(raw: unknown): boolean {
  if (raw == null) return true;
  return typeof raw === "object" && (raw as Record<string, unknown>).adaptive === true;
}

/** Coerce the weights jsonb into a full Weights, defaulting any missing field. */
function coerceWeights(raw: unknown): Weights {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WEIGHTS };
  const w = raw as Record<string, unknown>;
  const num = (k: keyof Weights) =>
    typeof w[k] === "number" ? (w[k] as number) : DEFAULT_WEIGHTS[k] ?? 0;
  return {
    content: num("content"),
    preference: num("preference"),
    popularity: num("popularity"),
    recency: num("recency"),
    collab: num("collab"),
    graph: num("graph"),
  };
}

async function loadOwned(client: SupabaseClient, userId: string): Promise<OwnedGame[]> {
  const out: OwnedGame[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("user_games")
      .select("app_id,playtime_forever")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_games load: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      out.push({ appId: r.app_id as number, playtimeMinutes: (r.playtime_forever as number) ?? 0 });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadUserContext(
  client: SupabaseClient,
  userId: string,
): Promise<UserContext> {
  const [owned, prefsRes, dismissedRes, triedRes] = await Promise.all([
    loadOwned(client, userId),
    client
      .from("user_preferences")
      .select("preferred_genres,preferred_tags,preferred_length,weights")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("user_feedback")
      .select("app_id")
      .eq("user_id", userId)
      .in("action", ["dismissed", "hidden"]),
    client
      .from("user_tried_games")
      .select("app_id,rating")
      .eq("user_id", userId),
  ]);

  if (prefsRes.error) throw new Error(`user_preferences load: ${prefsRes.error.message}`);
  if (dismissedRes.error) throw new Error(`user_feedback load: ${dismissedRes.error.message}`);
  if (triedRes.error) throw new Error(`user_tried_games load: ${triedRes.error.message}`);

  const prefs = prefsRes.data;
  const tried = triedRes.data ?? [];

  // Liked games boost the taste vector.
  const likedAppIds = [
    ...new Set(
      tried.filter((r) => r.rating === "like").map((r) => r.app_id as number),
    ),
  ];
  // Exclude from results: explicit dismiss/hide, plus EVERY tried game (the user
  // is already trying it — don't re-recommend it — and disliked ones are negatives).
  const dismissedAppIds = [
    ...new Set([
      ...(dismissedRes.data ?? []).map((r) => r.app_id as number),
      ...tried.map((r) => r.app_id as number),
    ]),
  ];

  return {
    owned,
    weights: coerceWeights(prefs?.weights),
    adaptiveWeights: isAdaptiveStored(prefs?.weights),
    preferredGenres: (prefs?.preferred_genres as string[]) ?? [],
    preferredTags: (prefs?.preferred_tags as string[]) ?? [],
    preferredLength: coerceLength(prefs?.preferred_length),
    dismissedAppIds,
    likedAppIds,
  };
}
