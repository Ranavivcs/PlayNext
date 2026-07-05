import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecCard, type RecItem, type Breakdown } from "./rec-card";
import { MyGamesPanel } from "./my-games-panel";
import type { HardFilters } from "@/lib/reco-data/filters";
import {
  presetFromStored,
  GENRE_OPTIONS,
  VIBE_OPTION_SET,
  DIFFICULTY_VALUE_SET,
} from "./preferences-options";
import { formatSyncedAt } from "./format";
import { DashboardHeader } from "./dashboard-header";
import { Banners } from "./dashboard-banners";
import { TasteLine } from "./taste-line";
import { AdjustPanel } from "./adjust-panel";
import { SetupCards, type SteamAccount } from "./setup-cards";
import { DangerZone } from "./danger-zone";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    steam_linked?: string;
    steam_error?: string;
    sync_msg?: string;
    sync_error?: string;
    recs_msg?: string;
    recs_error?: string;
    account_error?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is a defensive fallback.
  if (!user) {
    redirect("/login");
  }

  const displayName =
    ((user.user_metadata as { display_name?: string } | null)?.display_name ?? "").trim() ||
    user.email;

  const {
    steam_linked,
    steam_error,
    sync_msg,
    sync_error,
    recs_msg,
    recs_error,
    account_error,
  } = await searchParams;

  const { data: steam } = await supabase
    .from("steam_accounts")
    .select("steam_id, persona_name, avatar_url, profile_public, last_synced_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Library summary (only meaningful once Steam is linked + synced).
  const { count: gameCount } = await supabase
    .from("user_games")
    .select("app_id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { data: topGamesRaw } = await supabase
    .from("user_games")
    .select("app_id, playtime_forever, games(name, header_image)")
    .eq("user_id", user.id)
    .order("playtime_forever", { ascending: false })
    .limit(5);

  // The embedded `games` relation is a single row (FK), but the untyped client
  // can't express that — normalize here.
  const topGames = (topGamesRaw ?? []).map((row) => {
    const g = row as {
      app_id: number;
      playtime_forever: number;
      games: { name: string; header_image: string | null } | { name: string; header_image: string | null }[] | null;
    };
    const game = Array.isArray(g.games) ? g.games[0] : g.games;
    return {
      appId: g.app_id,
      playtimeForever: g.playtime_forever,
      name: game?.name ?? `App ${g.app_id}`,
      headerImage: game?.header_image ?? null,
    };
  });

  // Latest recommendation run + its ranked items (RLS: owner-only read).
  const { data: latestRec } = await supabase
    .from("recommendations")
    .select("id, created_at, params")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Reflect the filters used on the last run so the controls stay in sync.
  const runParams = latestRec?.params as
    | { filters?: HardFilters; tasteMode?: string; tasteClusters?: number; tasteLabels?: string[] }
    | null;
  const appliedFilters = runParams?.filters ?? {};
  const tasteMode = runParams?.tasteMode;
  // Detected taste styles, strongest first. The headline line shows a few; the
  // full list drives the per-card "matches your X taste" reason.
  const allTasteStyles = (runParams?.tasteLabels ?? []).filter(Boolean) as string[];
  const tasteStyles = allTasteStyles.slice(0, 3);

  // Saved soft preferences (engine reads these on the next run). Every UI option
  // is a community tag, so selections live in preferred_tags.
  const { data: prefsRow } = await supabase
    .from("user_preferences")
    .select("preferred_tags, weights")
    .eq("user_id", user.id)
    .maybeSingle();
  const tagList = (prefsRow?.preferred_tags as string[]) ?? [];
  // Split the saved tags back into their controls for pre-fill.
  const savedGenres = tagList.filter((t) => (GENRE_OPTIONS as readonly string[]).includes(t));
  const savedVibe = tagList.find((t) => VIBE_OPTION_SET.has(t)) ?? "";
  const savedDifficulty = tagList.find((t) => DIFFICULTY_VALUE_SET.has(t)) ?? "";
  const savedPreset = presetFromStored(prefsRow?.weights);

  let recItems: RecItem[] = [];

  if (latestRec) {
    const { data: itemsRaw } = await supabase
      .from("recommendation_items")
      .select("app_id, rank, score, score_breakdown, ai_explanation, games(name, header_image)")
      .eq("rec_id", latestRec.id)
      .order("rank", { ascending: true });

    recItems = (itemsRaw ?? []).map((row) => {
      const r = row as {
        app_id: number;
        rank: number;
        score: number;
        score_breakdown: Breakdown | null;
        ai_explanation: string | null;
        games:
          | { name: string; header_image: string | null }
          | { name: string; header_image: string | null }[]
          | null;
      };
      const game = Array.isArray(r.games) ? r.games[0] : r.games;
      return {
        appId: r.app_id,
        rank: r.rank,
        score: r.score,
        breakdown: r.score_breakdown ?? {
          content: 0,
          preference: 0,
          popularity: 0,
          recency: 0,
          collab: 0,
          graph: 0,
        },
        name: game?.name ?? `App ${r.app_id}`,
        headerImage: game?.header_image ?? null,
        aiExplanation: r.ai_explanation ?? null,
      };
    });
  }

  // "My games": games the user decided to try, with their feedback. Drives the
  // engine (liked/more → taste; dislike/less + any tried → excluded) and shows
  // the feedback controls.
  const { data: triedRaw } = await supabase
    .from("user_tried_games")
    .select("app_id, rating, score, games(name, header_image)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const myGames = (triedRaw ?? []).map((row) => {
    const r = row as {
      app_id: number;
      rating: string | null;
      score: number | null;
      games:
        | { name: string; header_image: string | null }
        | { name: string; header_image: string | null }[]
        | null;
    };
    const game = Array.isArray(r.games) ? r.games[0] : r.games;
    // Prefer the graded score; map any legacy like/dislike onto the scale so old
    // reviews still show as reviewed (like→8, dislike→3).
    const legacy = r.rating === "like" || r.rating === "more" ? 8 : r.rating === "dislike" || r.rating === "less" ? 3 : null;
    return {
      appId: r.app_id,
      score: r.score ?? legacy,
      name: game?.name ?? `App ${r.app_id}`,
      headerImage: game?.header_image ?? null,
    };
  });
  const triedSet = new Set(myGames.map((g) => g.appId));

  // Show the top 10 recommendations the user hasn't already tried. We persist a
  // deeper list (see updateRecommendations), so trying a game drops it out and
  // the next-best slides up to keep the grid full.
  const baseVisible = recItems.filter((r) => !triedSet.has(r.appId)).slice(0, 10);

  // Per-card "why": name the user's styles each shown game matches (game tags ∩
  // detected styles, strongest first). One small tag query for just these games;
  // the style list is already persisted in the run params.
  let visibleRecs = baseVisible;
  const visibleAppIds = baseVisible.map((r) => r.appId);
  if (visibleAppIds.length > 0 && allTasteStyles.length > 0) {
    const { data: tagRows } = await supabase
      .from("game_tags")
      .select("app_id, tag")
      .in("app_id", visibleAppIds);
    const tagsByApp = new Map<number, Set<string>>();
    for (const row of (tagRows ?? []) as { app_id: number; tag: string }[]) {
      const set = tagsByApp.get(row.app_id) ?? new Set<string>();
      set.add(row.tag);
      tagsByApp.set(row.app_id, set);
    }
    visibleRecs = baseVisible.map((r) => {
      const tags = tagsByApp.get(r.appId);
      // Preserve the user's style ranking; take the top 2 the game shares.
      const matchedStyles = tags ? allTasteStyles.filter((s) => tags.has(s)).slice(0, 2) : [];
      return { ...r, matchedStyles };
    });
  }

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-5xl px-6 py-7">
        <DashboardHeader displayName={displayName} email={user.email} />

        <Banners
          steam_linked={steam_linked}
          steam_error={steam_error}
          sync_msg={sync_msg}
          sync_error={sync_error}
          recs_msg={recs_msg}
          recs_error={recs_error}
          account_error={account_error}
        />

      {/* HERO: the games come first. Controls live in a collapsed "Adjust" panel
          so they don't push the recommendations below the fold. */}
      <section className="mb-12">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Recommended for you</h2>
          {latestRec && (
            <p className="shrink-0 text-xs text-faint">
              Last run {formatSyncedAt(latestRec.created_at)}
            </p>
          )}
        </div>
        <TasteLine tasteMode={tasteMode} tasteStyles={tasteStyles} />

        <>
            <AdjustPanel
              defaultOpen={!latestRec}
              gameCount={gameCount ?? 0}
              appliedFilters={appliedFilters}
              savedGenres={savedGenres}
              savedVibe={savedVibe}
              savedDifficulty={savedDifficulty}
              savedPreset={savedPreset}
            />

            {visibleRecs.length > 0 ? (
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {visibleRecs.map((item) => (
                  <RecCard key={item.appId} item={item} recId={latestRec!.id} />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No recommendations yet — open{" "}
                <span className="font-semibold text-foreground">Adjust recommendations</span>,
                pick games or set preferences, and hit Update.
              </p>
            )}
          </>
      </section>

      {/* MY GAMES + REVIEWED: optimistic client panel (instant try/rate/remove). */}
      <MyGamesPanel games={myGames} />

      {/* Setup / status — secondary, below the games. */}
      <SetupCards
        steam={steam as SteamAccount | null}
        gameCount={gameCount ?? 0}
        topGames={topGames}
      />

      {/* Danger zone — account deletion (collapsed by default). */}
      <DangerZone />
      </div>
    </main>
  );
}

