import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { syncSteamLibrary, updateRecommendations, deleteAccount } from "./actions";
import { RecCard, type RecItem, type Breakdown } from "./rec-card";
import { MyGamesPanel } from "./my-games-panel";
import type { HardFilters } from "@/lib/reco-data/filters";
import { DEFAULT_WEIGHTS } from "@/lib/reco-data/user";
import type { Weights } from "@/lib/reco/types";
import {
  WEIGHT_PRESETS,
  presetFromWeights,
  GENRE_OPTIONS,
  VIBE_OPTIONS,
  DIFFICULTY_OPTIONS,
  VIBE_OPTION_SET,
  DIFFICULTY_VALUE_SET,
} from "./preferences-options";
import { GenrePicker } from "./preference-chips";
import { SeedPicker } from "./seed-picker";
import { SubmitButton } from "@/components/submit-button";

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
    account_msg?: string;
    account_error?: string;
    mygames_msg?: string;
    mygames_error?: string;
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
    account_msg,
    account_error,
    mygames_msg,
    mygames_error,
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
    | { filters?: HardFilters; tasteMode?: string; tasteClusters?: number }
    | null;
  const appliedFilters = runParams?.filters ?? {};
  const tasteMode = runParams?.tasteMode;
  const tasteClusters = runParams?.tasteClusters;

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
  const savedWeights: Weights = {
    ...DEFAULT_WEIGHTS,
    ...((prefsRow?.weights as Partial<Weights> | null) ?? {}),
  };
  const savedPreset = presetFromWeights(savedWeights);

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
    .select("app_id, rating, games(name, header_image)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const myGames = (triedRaw ?? []).map((row) => {
    const r = row as {
      app_id: number;
      rating: string | null;
      games:
        | { name: string; header_image: string | null }
        | { name: string; header_image: string | null }[]
        | null;
    };
    const game = Array.isArray(r.games) ? r.games[0] : r.games;
    return {
      appId: r.app_id,
      rating: r.rating,
      name: game?.name ?? `App ${r.app_id}`,
      headerImage: game?.header_image ?? null,
    };
  });
  const triedSet = new Set(myGames.map((g) => g.appId));

  // Show the top 10 recommendations the user hasn't already tried. We persist a
  // deeper list (see updateRecommendations), so trying a game drops it out and
  // the next-best slides up to keep the grid full.
  const visibleRecs = recItems.filter((r) => !triedSet.has(r.appId)).slice(0, 10);

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-5xl px-6 py-7">
        <header className="panel mb-7 flex items-center justify-between px-5 py-3.5">
          <span className="brand">
            <span className="brand-logo">▶</span>
            Play<span className="brand-grad">Next</span>
          </span>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{displayName}</p>
              <p className="text-xs leading-tight text-faint">{user.email}</p>
            </div>
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </header>

        {steam_linked && (
          <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">Steam account linked.</p>
        )}
        {steam_error && (
          <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{steam_error}</p>
        )}
        {sync_msg && <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{sync_msg}</p>}
        {sync_error && (
          <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">Sync failed: {sync_error}</p>
        )}
        {recs_msg && <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{recs_msg}</p>}
        {recs_error && (
          <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">
            Recommendations failed: {recs_error}
          </p>
        )}
        {account_msg && (
          <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{account_msg}</p>
        )}
        {account_error && (
          <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{account_error}</p>
        )}
        {mygames_msg && (
          <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{mygames_msg}</p>
        )}
        {mygames_error && (
          <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{mygames_error}</p>
        )}

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
        {/* Adaptive-engine transparency: how the engine read your taste. */}
        {tasteMode && (
          <p className="mb-5 text-xs text-faint">
            {tasteMode === "clustered" ? (
              <>
                🧠 Adapted to your taste: your library spans{" "}
                <span className="font-medium text-foreground">{tasteClusters} distinct clusters</span>,
                so each pick is matched to your closest one.
              </>
            ) : (
              <>🧠 Adapted to your taste: a focused library, matched to your overall taste.</>
            )}
          </p>
        )}

        <>
            <details
              className="panel mb-7 overflow-hidden"
              {...(latestRec ? {} : { open: true })}
            >
              <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 text-sm font-semibold">
                <span>Adjust recommendations</span>
                <span className="text-faint">▾</span>
              </summary>
              <form
                action={updateRecommendations}
                className="space-y-6 border-t border-border p-5"
              >
                {(gameCount ?? 0) === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    No Steam library linked — pick a few games you like below to get
                    recommendations (or link Steam under your account).
                  </p>
                )}

                {/* Seed games — optional taste source for this run */}
                <SeedPicker />

                {/* How you play — the only hard filter */}
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold">How you want to play</p>
                    <p className="text-xs text-faint">
                      The one hard filter — results are limited to games that fit.
                    </p>
                  </div>
                  <ChipGroup label="Mode">
                    {MODE_OPTIONS.map((m) => (
                      <Chip
                        key={m.value || "any"}
                        type="radio"
                        name="mode"
                        value={m.value}
                        label={m.label}
                        defaultChecked={(appliedFilters.mode ?? "") === m.value}
                      />
                    ))}
                  </ChipGroup>
                </div>

                {/* Lean toward — soft preferences */}
                <div className="space-y-4 border-t border-border pt-5">
                  <div>
                    <p className="text-sm font-semibold">Lean toward</p>
                    <p className="text-xs text-faint">
                      Soft preferences — nudge ranking (raise the &quot;Preference&quot;
                      score), they don&apos;t exclude anything.
                    </p>
                  </div>
                  <GenrePicker initialSelected={savedGenres} />
                  <ChipGroup label="Vibe & theme">
                    <Chip
                      type="radio"
                      name="vibe"
                      value=""
                      label="Any"
                      defaultChecked={savedVibe === ""}
                    />
                    {VIBE_OPTIONS.map((v) => (
                      <Chip
                        key={v}
                        type="radio"
                        name="vibe"
                        value={v}
                        label={v}
                        defaultChecked={savedVibe === v}
                      />
                    ))}
                  </ChipGroup>
                  <ChipGroup label="Difficulty">
                    <Chip
                      type="radio"
                      name="difficulty"
                      value=""
                      label="Any"
                      defaultChecked={savedDifficulty === ""}
                    />
                    {DIFFICULTY_OPTIONS.map((d) => (
                      <Chip
                        key={d.value}
                        type="radio"
                        name="difficulty"
                        value={d.value}
                        label={d.label}
                        defaultChecked={savedDifficulty === d.value}
                      />
                    ))}
                  </ChipGroup>
                  {/* "Game length" control is PARKED: SteamSpy's median playtime
                      is dead (all zeros), so it has no data source yet. The
                      column/engine/action plumbing stays; re-add this ChipGroup
                      once a real source (HowLongToBeat / IGDB) feeds
                      games.median_playtime. */}
                </div>

                {/* Recommendation style — friendly presets instead of raw weights */}
                <div className="space-y-3 border-t border-border pt-5">
                  <div>
                    <p className="text-sm font-semibold">Recommendation style</p>
                    <p className="text-xs text-faint">
                      {WEIGHT_PRESETS.find((p) => p.value === savedPreset)?.description ??
                        "Choose how the ranking is balanced."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {WEIGHT_PRESETS.map((p) => (
                      <label key={p.value} className="cursor-pointer" title={p.description}>
                        <input
                          type="radio"
                          name="preset"
                          value={p.value}
                          defaultChecked={savedPreset === p.value}
                          className="pn-check sr-only"
                        />
                        <span className="chip">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <SubmitButton className="btn btn-primary" pendingText="Updating…">
                  Update recommendations
                </SubmitButton>
              </form>
            </details>

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
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">Setup</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <DashboardCard title="Steam account" hint="Link your Steam account">
            {steam ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {steam.avatar_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={steam.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-lg"
                      width={40}
                      height={40}
                    />
                  )}
                  <div>
                    <p className="font-semibold text-foreground">
                      {steam.persona_name ?? steam.steam_id}
                    </p>
                    <p className="text-xs text-faint">
                      {steam.profile_public ? "Public profile" : "Private profile"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <form action={syncSteamLibrary}>
                    <SubmitButton className="btn btn-primary btn-sm" pendingText="Syncing…">
                      {steam.last_synced_at ? "Re-sync library" : "Sync library"}
                    </SubmitButton>
                  </form>
                  <a
                    href="/api/steam/link"
                    className="text-xs text-faint underline hover:text-brand"
                  >
                    Change account
                  </a>
                </div>
              </div>
            ) : (
              <a href="/api/steam/link" className="btn btn-primary btn-sm">
                Link Steam account
              </a>
            )}
          </DashboardCard>
          <DashboardCard title="Your library" hint="Owned games & playtime">
            {!steam ? (
              "Link Steam to import."
            ) : !steam.last_synced_at ? (
              'Click "Sync library" to import your games.'
            ) : (
              <div className="space-y-3">
                <p className="text-foreground">
                  <span className="text-lg font-bold text-brand">{gameCount ?? 0}</span> games
                  imported
                </p>
                {topGames.length > 0 && (
                  <ul className="space-y-1.5">
                    {topGames.map((g) => (
                      <li key={g.appId} className="flex items-center justify-between gap-2">
                        <span className="truncate">{g.name}</span>
                        <span className="shrink-0 text-xs text-faint">
                          {formatPlaytime(g.playtimeForever)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-faint">
                  Last synced {formatSyncedAt(steam.last_synced_at)}
                </p>
              </div>
            )}
          </DashboardCard>
        </div>
      </section>

      {/* Danger zone — account deletion (collapsed by default). */}
      <section className="mt-10">
        <details className="rounded-xl border border-destructive/40 bg-destructive/5">
          <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-destructive">
            Danger zone
          </summary>
          <div className="space-y-4 border-t border-destructive/30 p-5">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Permanently deletes your account, your synced library, preferences, and
                recommendations. This also unlinks your Steam account so it can be linked to a
                new account. This can&apos;t be undone.
              </p>
            </div>
            <form action={deleteAccount} className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" className="h-4 w-4 accent-[var(--brand)]" />
                I understand this is permanent.
              </label>
              <button
                type="submit"
                className="rounded-lg border border-destructive/60 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/20"
              >
                Delete my account
              </button>
            </form>
          </div>
        </details>
      </section>
      </div>
    </main>
  );
}

// Mode is single-select; "" = Any (parseFilters treats it as no constraint).
// "How do you want to play?" — the only hard filter. "" = Any (no constraint).
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "single-player", label: "Solo" },
  { value: "multiplayer", label: "Multiplayer" },
  { value: "co-op", label: "Co-op (play with friends)" },
];

/** A label-wrapped, visually-hidden input styled as a toggle pill (pure CSS). */
function Chip({
  name,
  value,
  label,
  type = "checkbox",
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  type?: "checkbox" | "radio";
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="pn-check sr-only"
      />
      <span className="chip">{label}</span>
    </label>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}


function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "unplayed";
  const hours = minutes / 60;
  return hours < 1 ? `${minutes} min` : `${hours.toFixed(1)} h`;
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

function DashboardCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-faint">{hint}</p>
      <div className="mt-4 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
