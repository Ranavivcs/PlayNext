// Load the enriched shared catalog from Supabase into CatalogEntry[].
// The Supabase client is INJECTED so the same code runs under a service-role
// script (bypasses RLS) and a user-scoped server action (catalog is public-read
// either way). PostgREST caps a plain select at 1000 rows, so every table is
// paged with .range() — and the pages are fetched concurrently, because
// game_tags alone is ~49k rows (~50 pages) and sequential paging was the
// dominant latency of a recommendation run.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameFeatures } from "../reco/types.ts";
import type { CatalogEntry } from "./types.ts";

const PAGE = 1000;
// PostgREST caps a select at 1000 rows, and game_tags alone is ~50 pages, so
// fetching pages one-after-another dominated the load. Fetch a table's pages
// CONCURRENTLY (bounded, to not overwhelm the connection pool) instead.
const PAGE_CONCURRENCY = 8;

// The catalog is a SHARED, public, rarely-changing dataset (changes only when
// enrichment runs), and loading it is the dominant cost of a recommendation run
// (~tens of thousands of rows over the network). Cache it in-process so repeat
// runs on a warm server skip the fetch; new enrichment shows up after the TTL.
const CATALOG_TTL_MS = 30 * 60 * 1000;
let catalogCache: { at: number; data: CatalogEntry[] } | null = null;

/**
 * Page through a table/select, returning every row. Pages are fetched with
 * bounded concurrency. A deterministic ORDER BY (over the selected columns, a
 * stable key) makes the offset-based `.range()` pages consistent even when
 * requested in parallel.
 */
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
  const orderCols = columns.split(",").map((c) => c.trim());

  // How many pages? A filtered exact count (head → no rows transferred).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countQ: any = client.from(table).select(columns, { count: "exact", head: true });
  if (refine) countQ = refine(countQ);
  const { count, error: countErr } = await countQ;
  if (countErr) throw new Error(`${table} count: ${countErr.message}`);
  const pages = Math.ceil((count ?? 0) / PAGE);
  if (pages === 0) return [];

  const fetchPage = async (p: number): Promise<T[]> => {
    let q = client.from(table).select(columns).range(p * PAGE, p * PAGE + PAGE - 1);
    for (const col of orderCols) q = q.order(col, { ascending: true });
    if (refine) q = refine(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} load: ${error.message}`);
    return (data ?? []) as T[];
  };

  const out: T[] = [];
  for (let start = 0; start < pages; start += PAGE_CONCURRENCY) {
    const batch = Array.from({ length: Math.min(PAGE_CONCURRENCY, pages - start) }, (_, k) =>
      fetchPage(start + k),
    );
    for (const rows of await Promise.all(batch)) out.push(...rows);
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
