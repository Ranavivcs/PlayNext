// Load per-user inputs for a recommendation run: owned games (taste +
// exclusion), tunable weights + soft preferences, and dismissed games. Client
// injected: a service-role script bypasses RLS; a server action passes the
// user's own client so the owner-only policies apply.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnedGame, Weights } from "../reco/types.ts";

// Mirrors the user_preferences.weights default in 0001_initial_schema.sql.
export const DEFAULT_WEIGHTS: Weights = {
  content: 0.4,
  preference: 0.25,
  popularity: 0.15,
  recency: 0.1,
  collab: 0.1,
};

export interface UserContext {
  owned: OwnedGame[];
  weights: Weights;
  preferredGenres: string[];
  preferredTags: string[];
  dismissedAppIds: number[];
}

const PAGE = 1000;

/** Coerce the weights jsonb into a full Weights, defaulting any missing field. */
function coerceWeights(raw: unknown): Weights {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WEIGHTS };
  const w = raw as Record<string, unknown>;
  const num = (k: keyof Weights) =>
    typeof w[k] === "number" ? (w[k] as number) : DEFAULT_WEIGHTS[k];
  return {
    content: num("content"),
    preference: num("preference"),
    popularity: num("popularity"),
    recency: num("recency"),
    collab: num("collab"),
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
  const [owned, prefsRes, dismissedRes] = await Promise.all([
    loadOwned(client, userId),
    client
      .from("user_preferences")
      .select("preferred_genres,preferred_tags,weights")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("user_feedback")
      .select("app_id")
      .eq("user_id", userId)
      .in("action", ["dismissed", "hidden"]),
  ]);

  if (prefsRes.error) throw new Error(`user_preferences load: ${prefsRes.error.message}`);
  if (dismissedRes.error) throw new Error(`user_feedback load: ${dismissedRes.error.message}`);

  const prefs = prefsRes.data;
  const dismissedAppIds = [
    ...new Set((dismissedRes.data ?? []).map((r) => r.app_id as number)),
  ];

  return {
    owned,
    weights: coerceWeights(prefs?.weights),
    preferredGenres: (prefs?.preferred_genres as string[]) ?? [],
    preferredTags: (prefs?.preferred_tags as string[]) ?? [],
    dismissedAppIds,
  };
}
