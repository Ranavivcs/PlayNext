// Server-only Steam Web API wrapper. Uses STEAM_API_KEY, which must never reach
// the browser. Step A needs only player summaries; ownership/playtime ingest
// (GetOwnedGames, appdetails, etc.) is added in Step B.

const STEAM_API = "https://api.steampowered.com";

function apiKey(): string {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY is not set");
  return key;
}

export type SteamPlayerSummary = {
  steamId: string;
  personaName: string | null;
  avatarUrl: string | null;
  /** communityvisibilitystate === 3 means the profile is public. */
  profilePublic: boolean;
};

/** Fetch one player's public summary (persona, avatar, visibility). */
export async function getPlayerSummary(
  steamId: string,
): Promise<SteamPlayerSummary | null> {
  const url = `${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey()}&steamids=${steamId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Steam GetPlayerSummaries failed: ${res.status}`);
  }
  const json = await res.json();
  const player = json?.response?.players?.[0];
  if (!player) return null;

  return {
    steamId: String(player.steamid),
    personaName: player.personaname ?? null,
    avatarUrl: player.avatarfull ?? player.avatarmedium ?? player.avatar ?? null,
    profilePublic: player.communityvisibilitystate === 3,
  };
}

export type SteamOwnedGame = {
  appId: number;
  name: string;
  playtimeForever: number; // minutes
  playtime2Weeks: number; // minutes
  lastPlayed: string | null; // ISO timestamp, or null if never played
};

export type OwnedGamesResult = {
  /** True when the library isn't visible (private profile or game-details hidden). */
  private: boolean;
  games: SteamOwnedGame[];
};

/**
 * Fetch a user's owned games with playtime. A private library (or hidden game
 * details) comes back with no `games` array — we surface that as `private`
 * rather than an error so callers can cold-start.
 */
export async function getOwnedGames(steamId: string): Promise<OwnedGamesResult> {
  const url =
    `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${apiKey()}` +
    `&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Steam GetOwnedGames failed: ${res.status}`);
  }
  const json = await res.json();
  const response = json?.response;

  if (!response || !Array.isArray(response.games)) {
    return { private: true, games: [] };
  }

  const games: SteamOwnedGame[] = response.games.map(
    (g: {
      appid: number;
      name?: string;
      playtime_forever?: number;
      playtime_2weeks?: number;
      rtime_last_played?: number;
    }) => ({
      appId: g.appid,
      name: g.name?.trim() || `App ${g.appid}`,
      playtimeForever: g.playtime_forever ?? 0,
      playtime2Weeks: g.playtime_2weeks ?? 0,
      lastPlayed:
        g.rtime_last_played && g.rtime_last_played > 0
          ? new Date(g.rtime_last_played * 1000).toISOString()
          : null,
    }),
  );

  return { private: false, games };
}

// ----------------------------------------------------------------------------
// Metadata enrichment (Step C). Two keyless public endpoints:
//  - Steam store `appdetails`: structured store metadata (genres, categories,
//    platforms, description, release date, price, metacritic).
//  - SteamSpy: community tags (with vote weights) + positive/negative counts.
// Both are rate-limited; callers must throttle and back off on 429.
// ----------------------------------------------------------------------------

export type SteamAppDetails = {
  appId: number;
  name: string;
  /** Steam content type — only "game" rows are useful for recs. */
  type: string;
  shortDesc: string | null;
  headerImage: string | null;
  /** ISO yyyy-mm-dd, or null when Steam gives a non-date string (e.g. "Q1 2025"). */
  releaseDate: string | null;
  priceCents: number | null;
  isFree: boolean;
  metacritic: number | null;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  genres: string[];
  categories: string[];
};

/** Parse Steam's human release string ("10 Nov, 2020") to yyyy-mm-dd, else null. */
function parseReleaseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fetch one game's store metadata. Returns null when the app id has no store
 * page or isn't a purchasable game (success:false). Throws on 429 so the caller
 * can back off and retry.
 */
export async function getAppDetails(appId: number): Promise<SteamAppDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`Steam appdetails failed: ${res.status}`);

  const json = await res.json();
  const entry = json?.[String(appId)];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;

  return {
    appId,
    name: typeof d.name === "string" ? d.name : `App ${appId}`,
    type: d.type ?? "unknown",
    shortDesc: d.short_description?.trim() || null,
    headerImage: d.header_image ?? null,
    releaseDate: parseReleaseDate(d.release_date?.date),
    priceCents: d.is_free ? 0 : (d.price_overview?.final ?? null),
    isFree: Boolean(d.is_free),
    metacritic: typeof d.metacritic?.score === "number" ? d.metacritic.score : null,
    platforms: {
      windows: Boolean(d.platforms?.windows),
      mac: Boolean(d.platforms?.mac),
      linux: Boolean(d.platforms?.linux),
    },
    genres: Array.isArray(d.genres)
      ? d.genres.map((g: { description?: string }) => g.description).filter(Boolean)
      : [],
    categories: Array.isArray(d.categories)
      ? d.categories.map((c: { description?: string }) => c.description).filter(Boolean)
      : [],
  };
}

export type SteamSpyDetails = {
  appId: number;
  name: string;
  /** Community tags with vote weights. */
  tags: { tag: string; votes: number }[];
  totalReviews: number;
  /** 0..1 share of positive reviews; 0 when there are no reviews. */
  positiveRatio: number;
};

/**
 * Fetch SteamSpy aggregate data for one app: community tags + review counts.
 * Returns null when the app is unknown. Throws "RATE_LIMIT" on 429.
 */
export async function getSteamSpyAppDetails(appId: number): Promise<SteamSpyDetails | null> {
  const url = `https://steamspy.com/api.php?request=appdetails&appid=${appId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`SteamSpy appdetails failed: ${res.status}`);

  const d = await res.json();
  if (!d || typeof d.appid !== "number") return null;

  const positive = Number(d.positive) || 0;
  const negative = Number(d.negative) || 0;
  const total = positive + negative;

  // SteamSpy returns {} or [] for tags when there are none.
  const rawTags = d.tags && !Array.isArray(d.tags) ? (d.tags as Record<string, number>) : {};
  const tags = Object.entries(rawTags).map(([tag, votes]) => ({
    tag,
    votes: Number(votes) || 0,
  }));

  return {
    appId,
    name: typeof d.name === "string" ? d.name : `App ${appId}`,
    tags,
    totalReviews: total,
    positiveRatio: total > 0 ? positive / total : 0,
  };
}

/**
 * Top-N most-popular PC games from SteamSpy's `all` list, used to seed the
 * candidate catalog. Each `all` page returns ~1000 games by owners, so reaching
 * more than 1000 requires paging (page 0, 1, 2…). SteamSpy throttles this
 * endpoint to ~1 request/minute, so we wait ~61s between pages.
 *
 * SteamSpy keys each page object by appid, so `Object.values` would return them
 * in ascending-appid order (V8 orders integer-like keys numerically), NOT by
 * popularity. We merge all pages and re-sort by total reviews (positive +
 * negative) desc to recover a sensible popularity ranking before slicing.
 */
export async function getSteamSpyTop(limit: number): Promise<{ appId: number; name: string }[]> {
  const PER_PAGE = 1000;
  const pages = Math.max(1, Math.ceil(limit / PER_PAGE));
  const merged = new Map<number, { appId: number; name: string; reviews: number }>();

  for (let page = 0; page < pages; page++) {
    // Respect SteamSpy's ~1 req/min throttle on the `all` endpoint.
    if (page > 0) await new Promise((r) => setTimeout(r, 61_000));

    const url = `https://steamspy.com/api.php?request=all&page=${page}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`SteamSpy all page ${page} failed: ${res.status}`);

    const json = (await res.json()) as Record<
      string,
      { appid: number; name?: string; positive?: number; negative?: number }
    >;
    const entries = Object.values(json).filter((g) => typeof g?.appid === "number");
    if (entries.length === 0) break; // ran past the last populated page

    for (const g of entries) {
      merged.set(g.appid, {
        appId: g.appid,
        name: g.name?.trim() || `App ${g.appid}`,
        reviews: (Number(g.positive) || 0) + (Number(g.negative) || 0),
      });
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, limit)
    .map(({ appId, name }) => ({ appId, name }));
}
