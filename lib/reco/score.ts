// Scalar scoring terms. Pure: each returns a value in [0, 1].

import type { GameFeatures } from "./types.ts";

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Damped popularity, gated by quality. log(1+reviews) is normalized by the
 * corpus max so the busiest game maps to ~1, then scaled by positiveRatio.
 * Caller weights this modestly so popularity never dominates the final score.
 */
export function popularityScore(
  totalReviews: number,
  positiveRatio: number,
  maxLogReviews: number,
): number {
  if (maxLogReviews <= 0) return 0;
  const popNorm = Math.log(1 + Math.max(0, totalReviews)) / maxLogReviews;
  return clamp01(popNorm) * clamp01(positiveRatio);
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const HALF_LIFE_YEARS = 2;

/**
 * Exponential recency decay with a ~2-year half-life. Unreleased/future games
 * score 1 (fully fresh); missing/unparseable dates score 0 (no signal).
 */
export function recencyScore(releaseDate: string | null | undefined, now: Date): number {
  if (!releaseDate) return 0;
  const released = Date.parse(releaseDate);
  if (Number.isNaN(released)) return 0;
  const ageYears = (now.getTime() - released) / MS_PER_YEAR;
  if (ageYears <= 0) return 1;
  return clamp01(Math.pow(0.5, ageYears / HALF_LIFE_YEARS));
}

/**
 * Fraction of the user's stated preferences (genres + tags) that this game
 * matches. Denominator is the total number of preferences so a game matching
 * all of them scores 1; no preferences → 0.
 */
export function preferenceScore(
  game: GameFeatures,
  preferredGenres: string[] = [],
  preferredTags: string[] = [],
): number {
  const total = preferredGenres.length + preferredTags.length;
  if (total === 0) return 0;
  const genres = new Set(game.genres);
  const tags = new Set(game.tags);
  let hits = 0;
  for (const g of preferredGenres) if (genres.has(g)) hits++;
  for (const t of preferredTags) if (tags.has(t)) hits++;
  return clamp01(hits / total);
}
