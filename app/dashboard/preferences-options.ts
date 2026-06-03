// Curated soft-preference vocabulary for the dashboard. Values are EXACT
// catalog strings (verified present in game_genres / game_tags) because the
// engine's preferenceScore matches by exact, case-sensitive set membership.
// Anything offered here that the catalog lacks would simply never match — so
// every option below was confirmed present before being added.
//
// Shared by app/dashboard/page.tsx (rendering) and actions.ts (validation).
// Kept out of actions.ts because a "use server" module may only export async
// functions.

export const GENRE_OPTIONS = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Indie",
  "Casual",
  "Massively Multiplayer",
  "Free To Play",
  "Sports",
  "Racing",
] as const;

export interface TagGroup {
  label: string;
  tags: string[];
}

// "Difficulty" leads, since it was the user's explicit ask; difficulty is a
// soft lean (community tags), never a hard guarantee.
export const TAG_GROUPS: TagGroup[] = [
  { label: "Difficulty", tags: ["Difficult", "Souls-like", "Relaxing", "Family Friendly"] },
  {
    label: "Playstyle",
    tags: ["Open World", "Story Rich", "Exploration", "Sandbox", "Stealth", "Tactical", "Turn-Based", "Choices Matter"],
  },
  { label: "Mood", tags: ["Atmospheric", "Funny", "Dark", "Horror", "Great Soundtrack", "Cute"] },
  { label: "Theme", tags: ["Sci-fi", "Fantasy", "Post-apocalyptic", "Zombies", "Space", "Anime"] },
];

export const TAG_OPTIONS: string[] = TAG_GROUPS.flatMap((g) => g.tags);

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

export const GENRE_OPTION_SET: ReadonlySet<string> = new Set(GENRE_OPTIONS);
export const TAG_OPTION_SET: ReadonlySet<string> = new Set(TAG_OPTIONS);
