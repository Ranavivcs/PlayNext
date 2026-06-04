// Curated soft-preference vocabulary for the dashboard. Values are EXACT
// catalog strings (verified present in game_tags with good coverage) because
// the engine's preferenceScore matches by exact, case-sensitive set membership.
//
// IMPORTANT: every option here is a Steam *community tag*, so they all save into
// `user_preferences.preferred_tags` (matched against game.tags). We deliberately
// do NOT use Steam's coarse store-"genre" field. `preferred_genres` stays empty.
//
// Trimmed to ~16 headliner genres (flat, not grouped) + a few vibe/difficulty
// leans. Selections are CAPPED (see MAX_PICKS): the engine's preference score is
// hits ÷ (picks), so a handful of sharp picks ranks far better than many — and
// the cap keeps the UI from becoming a wall.
//
// Shared by app/dashboard/page.tsx + preference-chips.tsx + actions.ts. Kept out
// of actions.ts because a "use server" module may only export async functions.

// The most-picked soft prefs we let a user select at once. Both a UX guardrail
// and an algorithmic one (more picks dilute the preference signal).
export const MAX_PICKS = 5;

// ~16 recognizable headliner genres (community tags, flat).
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

// Genuinely-not-genre leanings (feel + theme).
export const VIBE_TAGS: string[] = ["Atmospheric", "Funny", "Story Rich", "Sci-fi", "Fantasy"];

// Difficulty is NOT a real Steam rating — only these two community tags back it,
// so we expose two honest leans (label ≠ tag value for "Challenging").
export const DIFFICULTY_OPTIONS: { value: string; label: string }[] = [
  { value: "Difficult", label: "Challenging" },
  { value: "Relaxing", label: "Relaxing" },
];

// Every selectable tag value, for server-side validation.
export const TAG_OPTION_SET: ReadonlySet<string> = new Set([
  ...GENRE_OPTIONS,
  ...VIBE_TAGS,
  ...DIFFICULTY_OPTIONS.map((d) => d.value),
]);

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
