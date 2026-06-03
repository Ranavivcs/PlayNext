// Library ingest: pull owned games + playtime from Steam into Supabase.
// Catalog rows (`games`) are written with the admin client (service role) so
// they're shared cache; `user_games` carries the per-user playtime. We always
// upsert `games` before `user_games` to satisfy the foreign key.

import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnedGames } from "@/lib/steam/api";

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type IngestResult =
  | { ok: true; private: boolean; count: number }
  | { ok: false; error: string };

export async function ingestLibrary(
  userId: string,
  steamId: string,
): Promise<IngestResult> {
  let owned;
  try {
    owned = await getOwnedGames(steamId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Steam API error" };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Private library: don't error — record the state so the UI can cold-start.
  if (owned.private) {
    await admin
      .from("steam_accounts")
      .update({ profile_public: false, last_synced_at: now })
      .eq("user_id", userId);
    return { ok: true, private: true, count: 0 };
  }

  // 1) Catalog rows first (FK target). Minimal metadata; enriched later.
  const gameRows = owned.games.map((g) => ({
    app_id: g.appId,
    name: g.name,
    header_image: `${STEAM_CDN}/${g.appId}/header.jpg`,
    updated_at: now,
  }));
  for (const batch of chunk(gameRows, 500)) {
    const { error } = await admin.from("games").upsert(batch, { onConflict: "app_id" });
    if (error) return { ok: false, error: `games upsert: ${error.message}` };
  }

  // 2) Per-user ownership + playtime.
  const userGameRows = owned.games.map((g) => ({
    user_id: userId,
    app_id: g.appId,
    playtime_forever: g.playtimeForever,
    playtime_2weeks: g.playtime2Weeks,
    last_played: g.lastPlayed,
  }));
  for (const batch of chunk(userGameRows, 500)) {
    const { error } = await admin
      .from("user_games")
      .upsert(batch, { onConflict: "user_id,app_id" });
    if (error) return { ok: false, error: `user_games upsert: ${error.message}` };
  }

  // 3) Mark synced.
  await admin
    .from("steam_accounts")
    .update({ profile_public: true, last_synced_at: now })
    .eq("user_id", userId);

  return { ok: true, private: false, count: owned.games.length };
}
