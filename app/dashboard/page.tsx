import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { syncSteamLibrary, updateRecommendations } from "./actions";
import type { HardFilters } from "@/lib/reco-data/filters";
import { DEFAULT_WEIGHTS } from "@/lib/reco-data/user";
import type { Weights } from "@/lib/reco/types";
import { GENRE_OPTIONS, TAG_GROUPS, WEIGHT_FIELDS } from "./preferences-options";

interface Breakdown {
  content: number;
  preference: number;
  popularity: number;
  recency: number;
  collab: number;
}

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

  const { steam_linked, steam_error, sync_msg, sync_error, recs_msg, recs_error } =
    await searchParams;

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
  const appliedFilters =
    (latestRec?.params as { filters?: HardFilters } | null)?.filters ?? {};

  // Saved soft preferences (engine reads these on the next run).
  const { data: prefsRow } = await supabase
    .from("user_preferences")
    .select("preferred_genres, preferred_tags, weights")
    .eq("user_id", user.id)
    .maybeSingle();
  const selectedGenres = new Set((prefsRow?.preferred_genres as string[]) ?? []);
  const selectedTags = new Set((prefsRow?.preferred_tags as string[]) ?? []);
  const savedWeights: Weights = {
    ...DEFAULT_WEIGHTS,
    ...((prefsRow?.weights as Partial<Weights> | null) ?? {}),
  };

  let recItems: {
    appId: number;
    rank: number;
    score: number;
    breakdown: Breakdown;
    name: string;
    headerImage: string | null;
  }[] = [];

  if (latestRec) {
    const { data: itemsRaw } = await supabase
      .from("recommendation_items")
      .select("app_id, rank, score, score_breakdown, games(name, header_image)")
      .eq("rec_id", latestRec.id)
      .order("rank", { ascending: true });

    recItems = (itemsRaw ?? []).map((row) => {
      const r = row as {
        app_id: number;
        rank: number;
        score: number;
        score_breakdown: Breakdown | null;
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
        },
        name: game?.name ?? `App ${r.app_id}`,
        headerImage: game?.header_image ?? null,
      };
    });
  }

  return (
    <main className="flex-1 p-8">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">PlayNext</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </header>

      {steam_linked && (
        <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Steam account linked.
        </p>
      )}
      {steam_error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {steam_error}
        </p>
      )}
      {sync_msg && (
        <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {sync_msg}
        </p>
      )}
      {sync_error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Sync failed: {sync_error}
        </p>
      )}
      {recs_msg && (
        <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {recs_msg}
        </p>
      )}
      {recs_error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Recommendations failed: {recs_error}
        </p>
      )}

      {/* HERO: the games come first. Controls live in a collapsed "Adjust" panel
          so they don't push the recommendations below the fold. */}
      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">Recommended for you</h2>
          {latestRec && (
            <p className="shrink-0 text-xs text-gray-400">
              Last run {formatSyncedAt(latestRec.created_at)}
            </p>
          )}
        </div>

        {(gameCount ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            Link and sync your Steam library (below) to get recommendations.
          </p>
        ) : (
          <>
            <details
              className="mb-6 rounded-lg border border-gray-200"
              {...(latestRec ? {} : { open: true })}
            >
              <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-gray-700">
                Adjust recommendations
              </summary>
              <form
                action={updateRecommendations}
                className="space-y-5 border-t border-gray-100 p-4"
              >
                {/* Must match — hard filters */}
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Must match</p>
                    <p className="text-xs text-gray-400">
                      Hard filters — results are limited to games that fit.
                    </p>
                  </div>
                  <ChipGroup label="Platform">
                    {PLATFORM_OPTIONS.map((p) => (
                      <Chip
                        key={p.value}
                        name="platform"
                        value={p.value}
                        label={p.label}
                        defaultChecked={appliedFilters.platforms?.includes(p.value)}
                      />
                    ))}
                  </ChipGroup>
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
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Lean toward</p>
                    <p className="text-xs text-gray-400">
                      Soft preferences — nudge ranking (raise the &quot;Preference&quot;
                      score), they don&apos;t exclude anything.
                    </p>
                  </div>
                  <ChipGroup label="Genres">
                    {GENRE_OPTIONS.map((g) => (
                      <Chip
                        key={g}
                        name="genre"
                        value={g}
                        label={g}
                        defaultChecked={selectedGenres.has(g)}
                      />
                    ))}
                  </ChipGroup>
                  {TAG_GROUPS.map((group) => (
                    <ChipGroup key={group.label} label={group.label}>
                      {group.tags.map((t) => (
                        <Chip
                          key={t}
                          name="tag"
                          value={t}
                          label={t}
                          defaultChecked={selectedTags.has(t)}
                        />
                      ))}
                    </ChipGroup>
                  ))}
                </div>

                {/* Advanced — signal weights (power-user knobs) */}
                <details className="border-t border-gray-100 pt-4">
                  <summary className="cursor-pointer select-none text-sm font-medium text-gray-700">
                    Advanced — signal weights
                  </summary>
                  <p className="mt-1 text-xs text-gray-400">Each 0–1. Higher = counts more.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {WEIGHT_FIELDS.map((f) => (
                      <label key={f.key} className="block space-y-1">
                        <span className="text-xs text-gray-500">{f.label}</span>
                        <input
                          type="number"
                          name={`w_${f.key}`}
                          min={0}
                          max={1}
                          step={0.05}
                          defaultValue={savedWeights[f.key]}
                          className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                </details>

                <button
                  type="submit"
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                >
                  Update recommendations
                </button>
              </form>
            </details>

            {recItems.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recItems.map((item) => (
                  <RecCard key={item.appId} item={item} />
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                No recommendations yet — open <span className="font-medium">Adjust
                recommendations</span> and hit Update.
              </p>
            )}
          </>
        )}
      </section>

      {/* Setup / status — secondary, below the games. */}
      <section className="grid gap-4 sm:grid-cols-2">
        <DashboardCard title="Steam account" hint="Link your Steam account (Phase 2)">
          {steam ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {steam.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={steam.avatar_url}
                    alt=""
                    className="h-10 w-10 rounded"
                    width={40}
                    height={40}
                  />
                )}
                <div>
                  <p className="font-medium text-gray-800">
                    {steam.persona_name ?? steam.steam_id}
                  </p>
                  <p className="text-xs text-gray-400">
                    {steam.profile_public ? "Public profile" : "Private profile"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <form action={syncSteamLibrary}>
                  <button
                    type="submit"
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
                  >
                    {steam.last_synced_at ? "Re-sync library" : "Sync library"}
                  </button>
                </form>
                <a
                  href="/api/steam/link"
                  className="text-xs text-gray-400 underline hover:text-gray-600"
                >
                  Change account
                </a>
              </div>
            </div>
          ) : (
            <a
              href="/api/steam/link"
              className="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            >
              Link Steam account
            </a>
          )}
        </DashboardCard>
        <DashboardCard title="Your library" hint="Owned games & playtime (Phase 2)">
          {!steam ? (
            "Link Steam to import."
          ) : !steam.last_synced_at ? (
            'Click "Sync library" to import your games.'
          ) : (
            <div className="space-y-3">
              <p className="text-gray-800">
                <span className="font-medium">{gameCount ?? 0}</span> games imported
              </p>
              {topGames.length > 0 && (
                <ul className="space-y-1">
                  {topGames.map((g) => (
                    <li key={g.appId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatPlaytime(g.playtimeForever)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-gray-400">
                Last synced {formatSyncedAt(steam.last_synced_at)}
              </p>
            </div>
          )}
        </DashboardCard>
      </section>
    </main>
  );
}

const PLATFORM_OPTIONS: { value: "windows" | "mac" | "linux"; label: string }[] = [
  { value: "windows", label: "Windows" },
  { value: "mac", label: "Mac" },
  { value: "linux", label: "Linux" },
];

// Mode is single-select; "" = Any (parseFilters treats it as no constraint).
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "single-player", label: "Single-player" },
  { value: "multiplayer", label: "Multiplayer" },
  { value: "co-op", label: "Co-op" },
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
        className="peer sr-only"
      />
      <span className="inline-block rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 transition-colors hover:border-gray-400 peer-checked:border-gray-900 peer-checked:bg-gray-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-gray-400">
        {label}
      </span>
    </label>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const BREAKDOWN_PARTS: { key: keyof Breakdown; label: string; color: string }[] = [
  { key: "content", label: "Content", color: "bg-indigo-500" },
  { key: "preference", label: "Preference", color: "bg-emerald-500" },
  { key: "popularity", label: "Popularity", color: "bg-amber-500" },
  { key: "recency", label: "Recency", color: "bg-sky-500" },
  { key: "collab", label: "Collab", color: "bg-rose-500" },
];

function RecCard({
  item,
}: {
  item: {
    appId: number;
    rank: number;
    score: number;
    breakdown: Breakdown;
    name: string;
    headerImage: string | null;
  };
}) {
  const total = BREAKDOWN_PARTS.reduce((s, p) => s + Math.max(0, item.breakdown[p.key]), 0);
  return (
    <li className="overflow-hidden rounded-lg border border-gray-200">
      {item.headerImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.headerImage} alt="" className="h-28 w-full object-cover" />
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-gray-800">
            {item.rank}. {item.name}
          </span>
          <span className="shrink-0 text-xs text-gray-400">{item.score.toFixed(3)}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded bg-gray-100">
          {total > 0 &&
            BREAKDOWN_PARTS.map((p) => {
              const v = Math.max(0, item.breakdown[p.key]);
              if (v <= 0) return null;
              return (
                <div
                  key={p.key}
                  className={p.color}
                  style={{ width: `${(v / total) * 100}%` }}
                  title={`${p.label}: ${item.breakdown[p.key].toFixed(3)}`}
                />
              );
            })}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
          {BREAKDOWN_PARTS.filter((p) => item.breakdown[p.key] > 0).map((p) => (
            <li key={p.key} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-sm ${p.color}`} />
              {p.label} {item.breakdown[p.key].toFixed(3)}
            </li>
          ))}
        </ul>
      </div>
    </li>
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
    <div className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
      <div className="mt-3 text-sm text-gray-600">{children}</div>
    </div>
  );
}
