// Load the enriched shared catalog from Supabase into CatalogEntry[].
// The Supabase client is INJECTED so the same code runs under a service-role
// script (bypasses RLS) and a user-scoped server action (catalog is public-read
// either way). PostgREST caps a plain select at 1000 rows, so every table is
// paged with .range() — game_tags alone is ~6k rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameFeatures } from "../reco/types.ts";
import type { CatalogEntry } from "./types.ts";

const PAGE = 1000;

// The catalog is a SHARED, public, rarely-changing dataset (changes only when
// enrichment runs), and loading it is the dominant cost of a recommendation run
// (~thousands of rows over the network). Cache it in-process with a short TTL so
// repeat runs on a warm server skip the fetch; enrichment shows up after the TTL.
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; data: CatalogEntry[] } | null = null;

/** Page through a table/select, returning every row. */
async function loadAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  // Supabase's query-builder generics are impractical to spell out for a
  // pass-through refine callback (a hand-written type trips TS2589 "excessively
  // deep"), so scope a single `any` to this internal helper parameter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(columns).range(from, from + PAGE - 1);
    if (refine) q = refine(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} load: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface GameRow {
  app_id: number;
  name: string;
  total_reviews: number | null;
  positive_ratio: number | null;
  release_date: string | null;
  median_playtime: number | null;
  platform_windows: boolean;
  platform_mac: boolean;
  platform_linux: boolean;
}

const GAME_COLUMNS =
  "app_id,name,total_reviews,positive_ratio,release_date,median_playtime,platform_windows,platform_mac,platform_linux";

/** Group child rows (genre/tag/category) by app_id into string arrays. */
function groupBy<T extends { app_id: number }>(
  rows: T[],
  pick: (r: T) => string,
): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const r of rows) {
    const arr = m.get(r.app_id);
    if (arr) arr.push(pick(r));
    else m.set(r.app_id, [pick(r)]);
  }
  return m;
}

/**
 * Load every enriched game (enriched_at not null) as a CatalogEntry: pure
 * GameFeatures + platform/category filter metadata. This is the full candidate
 * universe; hard filters narrow it, then the engine re-scores (cheap at ~300).
 */
export async function loadCatalog(client: SupabaseClient): Promise<CatalogEntry[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.data;
  }

  const [games, genreRows, tagRows, categoryRows] = await Promise.all([
    loadAll<GameRow>(client, "games", GAME_COLUMNS, (q) => q.not("enriched_at", "is", null)),
    loadAll<{ app_id: number; genre: string }>(client, "game_genres", "app_id,genre"),
    loadAll<{ app_id: number; tag: string }>(client, "game_tags", "app_id,tag"),
    loadAll<{ app_id: number; category: string }>(
      client,
      "game_categories",
      "app_id,category",
    ),
  ]);

  const genresByApp = groupBy(genreRows, (r) => r.genre);
  const tagsByApp = groupBy(tagRows, (r) => r.tag);
  const categoriesByApp = groupBy(categoryRows, (r) => r.category);

  const entries: CatalogEntry[] = games.map((g) => {
    const features: GameFeatures = {
      appId: g.app_id,
      name: g.name,
      genres: genresByApp.get(g.app_id) ?? [],
      tags: tagsByApp.get(g.app_id) ?? [],
      totalReviews: g.total_reviews ?? 0,
      positiveRatio: g.positive_ratio ?? 0,
      releaseDate: g.release_date,
      medianPlaytimeMinutes: g.median_playtime,
    };
    return {
      features,
      platforms: {
        windows: g.platform_windows,
        mac: g.platform_mac,
        linux: g.platform_linux,
      },
      categories: categoriesByApp.get(g.app_id) ?? [],
    };
  });

  catalogCache = { at: Date.now(), data: entries };
  return entries;
}

/**
 * Load GameFeatures for a specific set of app_ids (the user's owned games), so
 * the taste vector has features even when an owned game isn't in the candidate
 * slice. Returns only the ones present in the enriched catalog.
 */
export async function loadFeaturesFor(
  client: SupabaseClient,
  appIds: number[],
): Promise<GameFeatures[]> {
  if (appIds.length === 0) return [];
  const ids = [...new Set(appIds)];

  const [games, genreRows, tagRows] = await Promise.all([
    loadAll<GameRow>(client, "games", GAME_COLUMNS, (q) => q.in("app_id", ids)),
    loadAll<{ app_id: number; genre: string }>(client, "game_genres", "app_id,genre", (q) =>
      q.in("app_id", ids),
    ),
    loadAll<{ app_id: number; tag: string }>(client, "game_tags", "app_id,tag", (q) =>
      q.in("app_id", ids),
    ),
  ]);

  const genresByApp = groupBy(genreRows, (r) => r.genre);
  const tagsByApp = groupBy(tagRows, (r) => r.tag);

  return games.map((g) => ({
    appId: g.app_id,
    name: g.name,
    genres: genresByApp.get(g.app_id) ?? [],
    tags: tagsByApp.get(g.app_id) ?? [],
    totalReviews: g.total_reviews ?? 0,
    positiveRatio: g.positive_ratio ?? 0,
    releaseDate: g.release_date,
    medianPlaytimeMinutes: g.median_playtime,
  }));
}
