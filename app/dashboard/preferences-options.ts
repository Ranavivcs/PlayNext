// Curated soft-preference vocabulary for the dashboard. Values are EXACT
// catalog strings (verified present in game_tags with good coverage) because
// the engine's preferenceScore matches by exact, case-sensitive set membership.
//
// IMPORTANT: every option here is a Steam *community tag*, so they all save into
// `user_preferences.preferred_tags` (matched against game.tags). We deliberately
// do NOT use Steam's coarse store-"genre" field. `preferred_genres` stays empty.
//
// Control model:
//  - Genres: MULTI-select, capped at MAX_GENRE_PICKS (the only capped control).
//    preferenceScore is hits ÷ picks, so a few sharp picks rank better than many.
//  - Vibe & theme: SINGLE-select (prevents opposing picks like Sci-fi + Fantasy).
//  - Difficulty: SINGLE-select (Challenging vs Relaxing are mutually exclusive).
//  Vibe + Difficulty are always available and do NOT count toward the cap.
//
// Shared by page.tsx + preference-chips.tsx + actions.ts. Kept out of actions.ts
// because a "use server" module may only export async functions.

// Cap on GENRE picks only. Both a UX guardrail and an algorithmic one.
export const MAX_GENRE_PICKS = 5;

// ~16 recognizable headliner genres (community tags). Multi-select, capped.
export const GENRE_OPTIONS = [
  "Shooter",
  "FPS",
  "RPG",
  "Action RPG",
  "JRPG",
  "Strategy",
  "RTS",
  "Simulation",
  "Massively Multiplayer",
  "MOBA",
  "Rogue-like",
  "Metroidvania",
  "Platformer",
  "Open World",
  "Horror",
  "Survival",
] as const;

// Feel + theme. Single-select.
export const VIBE_OPTIONS = ["Atmospheric", "Funny", "Story Rich", "Sci-fi", "Fantasy"] as const;

// Difficulty is NOT a real Steam rating — only two community tags back it.
// Single-select (label ≠ tag value for "Challenging").
export const DIFFICULTY_OPTIONS: { value: string; label: string }[] = [
  { value: "Difficult", label: "Challenging" },
  { value: "Relaxing", label: "Relaxing" },
];

// Per-field validation sets (server side).
export const GENRE_OPTION_SET: ReadonlySet<string> = new Set(GENRE_OPTIONS);
export const VIBE_OPTION_SET: ReadonlySet<string> = new Set(VIBE_OPTIONS);
export const DIFFICULTY_VALUE_SET: ReadonlySet<string> = new Set(
  DIFFICULTY_OPTIONS.map((d) => d.value),
);

// Weight components exposed in the UI. `collab` is intentionally omitted: the
// engine multiplies it by 0 until collaborative filtering ships, so tuning it
// would do nothing. Its stored value is preserved untouched on save.
export const WEIGHT_FIELDS = [
  { key: "content", label: "Content (similar to what you play)" },
  { key: "preference", label: "Preference (your genres & tags)" },
  { key: "popularity", label: "Popularity" },
  { key: "recency", label: "Recency (newer games)" },
] as const;

export type WeightKey = (typeof WEIGHT_FIELDS)[number]["key"];
