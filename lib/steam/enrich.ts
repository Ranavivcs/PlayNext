// Catalog metadata enrichment (Phase 3, Step C). Populates the SHARED `games`
// catalog (+ game_genres / game_categories / game_tags) from Steam store
// appdetails and SteamSpy. Pure cache-fill: idempotent, rate-limited, and
// skip-if-fresh so overlapping libraries and re-runs don't re-fetch.
//
// Relative `.ts` imports (no `@/` alias) so this can run under plain Node
// (`node --env-file=.env.local`) as well as inside Next.

import { createAdminClient } from "../supabase/admin.ts";
import { getAppDetails, getSteamSpyAppDetails } from "./api.ts";

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_DELAY_MS = 1300; // ~<1 req/sec per host; polite for Steam + SteamSpy
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn`, retrying with exponential backoff on RATE_LIMIT. Null on give-up. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message === "RATE_LIMIT") {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export type EnrichStatus = "enriched" | "skipped-fresh" | "no-store-page" | "error";

export interface EnrichOptions {
  appIds: number[];
  ttlDays?: number;
  delayMs?: number;
  /** Called after each app so a long run can report progress. */
  onProgress?: (done: number, total: number, appId: number, status: EnrichStatus) => void;
}

export interface EnrichSummary {
  total: number;
  enriched: number;
  skippedFresh: number;
  noStorePage: number;
  errors: number;
}

type Admin = ReturnType<typeof createAdminClient>;

/** App ids already enriched within the TTL window — skip these. */
async function freshAppIds(admin: Admin, appIds: number[], ttlDays: number): Promise<Set<number>> {
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Set<number>();
  // Chunk the IN-list to keep the query small.
  for (let i = 0; i < appIds.length; i += 500) {
    const batch = appIds.slice(i, i + 500);
    const { data, error } = await admin
      .from("games")
      .select("app_id, enriched_at")
      .in("app_id", batch)
      .gte("enriched_at", cutoff);
    if (error) throw new Error(`fresh lookup: ${error.message}`);
    for (const row of data ?? []) fresh.add(row.app_id as number);
  }
  return fresh;
}

/** Replace all child rows for one app (delete-then-insert keeps it idempotent). */
async function replaceChildren(
  admin: Admin,
  table: "game_genres" | "game_categories" | "game_tags",
  rows: Record<string, unknown>[],
  appId: number,
): Promise<void> {
  const del = await admin.from(table).delete().eq("app_id", appId);
  if (del.error) throw new Error(`${table} delete: ${del.error.message}`);
  if (rows.length === 0) return;
  const ins = await admin.from(table).insert(rows);
  if (ins.error) throw new Error(`${table} insert: ${ins.error.message}`);
}

async function enrichOne(admin: Admin, appId: number): Promise<EnrichStatus> {
  const details = await withRetry(() => getAppDetails(appId));
  // No store page / not a game (DLC, video, etc.) — nothing useful to cache.
  if (!details || details.type !== "game") return "no-store-page";

  const spy = await withRetry(() => getSteamSpyAppDetails(appId));
  const now = new Date().toISOString();

  const gameRow = {
    app_id: appId,
    name: details.name,
    short_desc: details.shortDesc,
    header_image: details.headerImage,
    release_date: details.releaseDate,
    price_cents: details.priceCents,
    is_free: details.isFree,
    metacritic: details.metacritic,
    total_reviews: spy?.totalReviews ?? 0,
    positive_ratio: spy?.positiveRatio ?? 0,
    median_playtime: spy?.medianForever ?? null,
    platform_windows: details.platforms.windows,
    platform_mac: details.platforms.mac,
    platform_linux: details.platforms.linux,
    updated_at: now,
    enriched_at: now,
  };
  const up = await admin.from("games").upsert(gameRow, { onConflict: "app_id" });
  if (up.error) throw new Error(`games upsert: ${up.error.message}`);

  // Dedupe on the primary-key column: Steam can repeat a genre/category
  // description, which would violate the (app_id, <col>) PK on insert.
  const uniqueGenres = [...new Set(details.genres)];
  const uniqueCategories = [...new Set(details.categories)];
  const uniqueTags = [...new Map((spy?.tags ?? []).map((t) => [t.tag, t.votes])).entries()];

  await replaceChildren(
    admin,
    "game_genres",
    uniqueGenres.map((genre) => ({ app_id: appId, genre })),
    appId,
  );
  await replaceChildren(
    admin,
    "game_categories",
    uniqueCategories.map((category) => ({ app_id: appId, category })),
    appId,
  );
  await replaceChildren(
    admin,
    "game_tags",
    uniqueTags.map(([tag, votes]) => ({ app_id: appId, tag, votes })),
    appId,
  );

  return "enriched";
}

/**
 * Enrich the given app ids into the shared catalog. Skips ids enriched within
 * `ttlDays`. Throttles `delayMs` between apps and backs off on 429. Per-app
 * errors are counted and logged but don't abort the whole run.
 */
export async function enrichGames(opts: EnrichOptions): Promise<EnrichSummary> {
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const admin = createAdminClient();

  const uniqueIds = [...new Set(opts.appIds)];
  const fresh = await freshAppIds(admin, uniqueIds, ttlDays);
  const summary: EnrichSummary = {
    total: uniqueIds.length,
    enriched: 0,
    skippedFresh: 0,
    noStorePage: 0,
    errors: 0,
  };

  let done = 0;
  for (const appId of uniqueIds) {
    done++;
    if (fresh.has(appId)) {
      summary.skippedFresh++;
      opts.onProgress?.(done, summary.total, appId, "skipped-fresh");
      continue;
    }

    let status: EnrichStatus;
    try {
      status = await enrichOne(admin, appId);
      if (status === "enriched") summary.enriched++;
      else summary.noStorePage++;
    } catch (e) {
      summary.errors++;
      status = "error";
      console.error(`enrich ${appId} failed:`, e instanceof Error ? e.message : e);
    }

    opts.onProgress?.(done, summary.total, appId, status);
    await sleep(delayMs); // throttle the two upstream APIs
  }

  return summary;
}
