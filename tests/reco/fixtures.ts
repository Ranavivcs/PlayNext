// Deterministic catalog for reco unit tests. Seeded RNG only — no Math.random.
// Layout: 5 genres × 10 games. Tags are genre-specific so genre/tag content
// signal is clean, while popularity (reviews) is drawn independently of genre
// so a popularity baseline cannot exploit genre membership.

import type { GameFeatures, OwnedGame } from "../../lib/reco/types.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENRES = ["Action", "RPG", "Strategy", "Puzzle", "Racing"] as const;

const TAGS_BY_GENRE: Record<string, string[]> = {
  Action: ["Shooter", "FastPaced", "Combat", "Gore", "Arena", "Bullet"],
  RPG: ["Story", "Fantasy", "Loot", "Leveling", "OpenWorld", "Party"],
  Strategy: ["Turnbased", "Economy", "Tactics", "Base", "Grand", "Hex"],
  Puzzle: ["Logic", "Match", "Relaxing", "Brain", "Minimal", "Tiles"],
  Racing: ["Cars", "Drift", "Arcade", "Sim", "Track", "Speed"],
};

const GAMES_PER_GENRE = 10;

/** Build the 50-game catalog deterministically from a seed. */
export function buildCatalog(seed = 1337): GameFeatures[] {
  const rng = mulberry32(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const games: GameFeatures[] = [];
  const baseTime = Date.parse("2026-05-29");
  const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;

  GENRES.forEach((genre, gi) => {
    const pool = TAGS_BY_GENRE[genre];
    for (let i = 0; i < GAMES_PER_GENRE; i++) {
      // 3–4 distinct genre-specific tags per game.
      const tagCount = 3 + Math.floor(rng() * 2);
      const tags = new Set<string>();
      while (tags.size < tagCount) tags.add(pick(pool));

      const releasedMs = baseTime - Math.floor(rng() * fiveYearsMs);
      const releaseDate = new Date(releasedMs).toISOString().slice(0, 10);

      games.push({
        appId: gi * 100 + i,
        name: `${genre} Game ${i}`,
        genres: [genre],
        tags: [...tags],
        // Popularity drawn independently of genre.
        totalReviews: 50 + Math.floor(rng() * 200_000),
        positiveRatio: 0.5 + rng() * 0.5,
        releaseDate,
      });
    }
  });
  return games;
}

export interface UserScenario {
  owned: OwnedGame[];
  ownedFeatures: GameFeatures[];
  /** Held-out games that *should* be recommended (ground truth). */
  relevantAppIds: number[];
}

/**
 * A user who heavily plays 5 Action games. The other 5 Action games are held
 * out as the relevant set: a genre/tag-aware ranker should surface them.
 */
export function actionLover(catalog: GameFeatures[]): UserScenario {
  const action = catalog.filter((g) => g.genres.includes("Action"));
  const ownedFeatures = action.slice(0, 5);
  const heldOut = action.slice(5);

  const owned: OwnedGame[] = ownedFeatures.map((g, idx) => ({
    appId: g.appId,
    playtimeMinutes: 6000 - idx * 500, // all high, lightly varied
  }));

  return {
    owned,
    ownedFeatures,
    relevantAppIds: heldOut.map((g) => g.appId),
  };
}
