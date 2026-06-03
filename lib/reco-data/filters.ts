// Hard-filter layer: narrows the candidate catalog by platform and gameplay
// mode BEFORE scoring. These are constraints ("must run on Linux", "must be
// co-op"), not preferences — so they live here, not in the pure scoring core.
// Soft leanings (genre/difficulty) go to recommend()'s preferredGenres/Tags.

import type { CatalogEntry } from "./types.ts";

/**
 * Steam "categories" mix gameplay modes with noise (Trading Cards, Remote Play,
 * VAC, accessibility). We WHITELIST the gameplay-mode ones so a "multiplayer"
 * or "co-op" filter keys off real signal, not arbitrary strings.
 */
const MULTIPLAYER_CATEGORIES = new Set<string>([
  "Multi-player",
  "Online PvP",
  "PvP",
  "Cross-Platform Multiplayer",
  "MMO",
  "Co-op",
  "Online Co-op",
  "Shared/Split Screen Co-op",
  "Shared/Split Screen PvP",
  "Shared/Split Screen",
]);

const COOP_CATEGORIES = new Set<string>([
  "Co-op",
  "Online Co-op",
  "Shared/Split Screen Co-op",
]);

const SINGLE_PLAYER_CATEGORY = "Single-player";

export interface HardFilters {
  /** Require the game to run on these platforms (all listed must be true). */
  platforms?: Array<"windows" | "mac" | "linux">;
  /** Gameplay mode constraint. */
  mode?: "single-player" | "multiplayer" | "co-op";
}

function matchesPlatforms(entry: CatalogEntry, want: HardFilters["platforms"]): boolean {
  if (!want || want.length === 0) return true;
  return want.every((p) => entry.platforms[p]);
}

function matchesMode(entry: CatalogEntry, mode: HardFilters["mode"]): boolean {
  if (!mode) return true;
  const cats = new Set(entry.categories);
  if (mode === "single-player") return cats.has(SINGLE_PLAYER_CATEGORY);
  const wanted = mode === "co-op" ? COOP_CATEGORIES : MULTIPLAYER_CATEGORIES;
  for (const c of cats) if (wanted.has(c)) return true;
  return false;
}

/** Apply hard constraints; entries that fail any are dropped. */
export function applyHardFilters(
  catalog: CatalogEntry[],
  filters: HardFilters = {},
): CatalogEntry[] {
  return catalog.filter(
    (e) => matchesPlatforms(e, filters.platforms) && matchesMode(e, filters.mode),
  );
}
