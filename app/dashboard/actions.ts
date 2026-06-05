"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestLibrary } from "@/lib/steam/ingest";
import { generateRecommendations } from "@/lib/reco-data/run";
import { explainRecommendation } from "@/lib/ai/explain";
import type { HardFilters } from "@/lib/reco-data/filters";
import { DEFAULT_WEIGHTS } from "@/lib/reco-data/user";
import type { Weights } from "@/lib/reco/types";
import {
  GENRE_OPTION_SET,
  VIBE_OPTION_SET,
  DIFFICULTY_VALUE_SET,
  MAX_GENRE_PICKS,
} from "./preferences-options";

const VALID_MODES = ["single-player", "multiplayer", "co-op"] as const;

/** Build HardFilters from the dashboard form, ignoring anything unrecognized. */
function parseFilters(formData: FormData): HardFilters {
  const modeRaw = formData.get("mode");
  const mode =
    typeof modeRaw === "string" && (VALID_MODES as readonly string[]).includes(modeRaw)
      ? (modeRaw as (typeof VALID_MODES)[number])
      : undefined;

  const filters: HardFilters = {};
  if (mode) filters.mode = mode;
  return filters;
}

export async function syncSteamLibrary() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: steam } = await supabase
    .from("steam_accounts")
    .select("steam_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!steam) {
    redirect(
      `/dashboard?steam_error=${encodeURIComponent("Link your Steam account first.")}`,
    );
  }

  const result = await ingestLibrary(user.id, steam.steam_id);
  revalidatePath("/dashboard");

  if (!result.ok) {
    redirect(`/dashboard?sync_error=${encodeURIComponent(result.error)}`);
  }
  if (result.private) {
    redirect(
      `/dashboard?sync_msg=${encodeURIComponent(
        "Your Steam profile (or game details) is private — set it to public, then sync to import your library.",
      )}`,
    );
  }
  redirect(`/dashboard?sync_msg=${encodeURIComponent(`Imported ${result.count} games.`)}`);
}

/** Clamp a form value to a weight in [0, 1]; fall back to a default if absent/NaN. */
function parseWeight(raw: FormDataEntryValue | null, fallback: number): number {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Read the editable weights from the form, preserving the hidden collab value. */
function parseWeights(formData: FormData, current: Partial<Weights> | null): Weights {
  const collab =
    typeof current?.collab === "number" ? current.collab : DEFAULT_WEIGHTS.collab;
  return {
    content: parseWeight(formData.get("w_content"), DEFAULT_WEIGHTS.content),
    preference: parseWeight(formData.get("w_preference"), DEFAULT_WEIGHTS.preference),
    popularity: parseWeight(formData.get("w_popularity"), DEFAULT_WEIGHTS.popularity),
    recency: parseWeight(formData.get("w_recency"), DEFAULT_WEIGHTS.recency),
    collab,
  };
}

/**
 * Single "Update recommendations" action: persist the soft preferences
 * (leanings + weights), then run the engine with the hard filters and persist
 * the ranked results — all under the user-scoped client (RLS owner-only).
 * Merging the two steps removes the confusing save-then-refresh two-step.
 */
export async function updateRecommendations(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1. Save soft preferences. Every UI option is a community tag (genres
  //    included), so they all land in preferred_tags; preferred_genres (Steam's
  //    coarse store-genre field) is intentionally left empty. Only keep options
  //    we offer (exact catalog strings); ignore anything else.
  const preferred_genres: string[] = [];
  // Genres: multi-select, capped. Vibe + Difficulty: single-select, uncapped.
  const genrePicks = [
    ...new Set(
      formData
        .getAll("tag")
        .filter((v): v is string => typeof v === "string" && GENRE_OPTION_SET.has(v)),
    ),
  ].slice(0, MAX_GENRE_PICKS);
  const vibeRaw = formData.get("vibe");
  const vibe = typeof vibeRaw === "string" && VIBE_OPTION_SET.has(vibeRaw) ? [vibeRaw] : [];
  const diffRaw = formData.get("difficulty");
  const difficulty =
    typeof diffRaw === "string" && DIFFICULTY_VALUE_SET.has(diffRaw) ? [diffRaw] : [];
  const preferred_tags = [...genrePicks, ...vibe, ...difficulty];

  const { data: existing } = await supabase
    .from("user_preferences")
    .select("weights")
    .eq("user_id", user.id)
    .maybeSingle();
  const weights = parseWeights(formData, existing?.weights as Partial<Weights> | null);

  const { error: prefsError } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      preferred_genres,
      preferred_tags,
      weights,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (prefsError) {
    revalidatePath("/dashboard");
    redirect(`/dashboard?recs_error=${encodeURIComponent(prefsError.message)}`);
  }

  // 2. Generate with the hard filters (engine reads the prefs we just saved).
  //    Seed games (if any) become the taste source for this run, capped at 5.
  const filters = parseFilters(formData);
  const seedAppIds = [
    ...new Set(
      formData
        .getAll("seed")
        .map((v) => (typeof v === "string" ? parseInt(v, 10) : NaN))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].slice(0, 5);

  let count = 0;
  try {
    const { results } = await generateRecommendations({
      client: supabase,
      userId: user.id,
      filters,
      seedAppIds,
      persist: true,
    });
    count = results.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not generate recommendations.";
    redirect(`/dashboard?recs_error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard?recs_msg=${encodeURIComponent(`Updated — ${count} recommendations.`)}`);
}

/**
 * Generate + persist the AI "why this matches you" blurb for one recommended
 * game. Reads the game's real facts + the user's taste + the engine's score
 * breakdown, calls the AI layer (lib/ai — explains, never ranks), and stores the
 * result on the item. AI failure becomes a banner; the ranked list is unaffected.
 */
export async function explainRec(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const recId = formData.get("rec_id");
  const appIdRaw = formData.get("app_id");
  const appId = typeof appIdRaw === "string" ? parseInt(appIdRaw, 10) : NaN;
  if (typeof recId !== "string" || !Number.isInteger(appId)) {
    redirect(`/dashboard?recs_error=${encodeURIComponent("Invalid explanation request.")}`);
  }

  try {
    // The score breakdown for this item (RLS returns it only if the user owns it).
    const { data: item, error: itemErr } = await supabase
      .from("recommendation_items")
      .select("score_breakdown")
      .eq("rec_id", recId)
      .eq("app_id", appId)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Recommendation not found.");

    const [{ data: game }, { data: genres }, { data: tags }, { data: topGames }] =
      await Promise.all([
        supabase
          .from("games")
          .select("name, short_desc, total_reviews, positive_ratio")
          .eq("app_id", appId)
          .maybeSingle(),
        supabase.from("game_genres").select("genre").eq("app_id", appId),
        supabase
          .from("game_tags")
          .select("tag")
          .eq("app_id", appId)
          .order("votes", { ascending: false })
          .limit(12),
        supabase
          .from("user_games")
          .select("playtime_forever, games(name)")
          .eq("user_id", user.id)
          .order("playtime_forever", { ascending: false })
          .limit(5),
      ]);
    if (!game) throw new Error("Game not found.");

    // Taste summary: top-played games, else fall back to saved preferred tags.
    const topNames = (topGames ?? [])
      .map((r) => {
        const g = (r as { games: { name: string } | { name: string }[] | null }).games;
        const one = Array.isArray(g) ? g[0] : g;
        return one?.name;
      })
      .filter((n): n is string => Boolean(n));
    let tasteSummary = topNames.length ? `plays a lot of ${topNames.join(", ")}` : "";
    if (!tasteSummary) {
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("preferred_tags")
        .eq("user_id", user.id)
        .maybeSingle();
      const t = (prefs?.preferred_tags as string[] | null) ?? [];
      if (t.length) tasteSummary = `likes ${t.join(", ")} games`;
    }

    const bd =
      (item.score_breakdown as {
        content?: number;
        preference?: number;
        popularity?: number;
        recency?: number;
      } | null) ?? {};

    const explanation = await explainRecommendation({
      game: {
        name: game.name as string,
        genres: (genres ?? []).map((r) => r.genre as string),
        tags: (tags ?? []).map((r) => r.tag as string),
        shortDesc: (game.short_desc as string | null) ?? null,
        totalReviews: (game.total_reviews as number | null) ?? null,
        positiveRatio: (game.positive_ratio as number | null) ?? null,
      },
      tasteSummary,
      breakdown: {
        content: Number(bd.content) || 0,
        preference: Number(bd.preference) || 0,
        popularity: Number(bd.popularity) || 0,
        recency: Number(bd.recency) || 0,
      },
    });

    const { error: updErr } = await supabase
      .from("recommendation_items")
      .update({ ai_explanation: explanation })
      .eq("rec_id", recId)
      .eq("app_id", appId);
    if (updErr) throw new Error(updErr.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not generate explanation.";
    redirect(`/dashboard?recs_error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Permanently delete the logged-in user's account. Requires an explicit confirm
 * checkbox (defense against accidental clicks). Uses the service-role admin
 * client to remove the auth user; FK `on delete cascade` wipes steam_accounts,
 * user_games, preferences, recommendations, etc. — which also frees that Steam
 * library's `steam_id` so it can be linked to a fresh account later.
 */
export async function deleteAccount(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (formData.get("confirm") !== "on") {
    redirect(
      `/dashboard?account_error=${encodeURIComponent("Tick the confirmation box to delete your account.")}`,
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    redirect(`/dashboard?account_error=${encodeURIComponent(error.message)}`);
  }

  // Clear the now-orphaned session cookies, then land on the homepage.
  try {
    await supabase.auth.signOut();
  } catch {
    // user is already gone; cookies are cleared regardless
  }
  revalidatePath("/", "layout");
  redirect("/?deleted=1");
}
