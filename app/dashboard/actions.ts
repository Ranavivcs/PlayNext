"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ingestLibrary } from "@/lib/steam/ingest";
import { generateRecommendations } from "@/lib/reco-data/run";
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
  const filters = parseFilters(formData);
  let count = 0;
  try {
    const { results } = await generateRecommendations({
      client: supabase,
      userId: user.id,
      filters,
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
