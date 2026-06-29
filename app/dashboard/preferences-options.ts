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

// Game length (time investment). Single-select; stored in its OWN column
// (user_preferences.preferred_length), NOT preferred_tags — it's a numeric
// bucket from SteamSpy median playtime, not a community tag.
export const LENGTH_OPTIONS: { value: string; label: string }[] = [
  { value: "short", label: "Short (≤5h)" },
  { value: "medium", label: "Medium (5–20h)" },
  { value: "long", label: "Long (20h+)" },
];
export const LENGTH_VALUE_SET: ReadonlySet<string> = new Set(LENGTH_OPTIONS.map((o) => o.value));

// Per-field validation sets (server side).
export const GENRE_OPTION_SET: ReadonlySet<string> = new Set(GENRE_OPTIONS);
export const VIBE_OPTION_SET: ReadonlySet<string> = new Set(VIBE_OPTIONS);
export const DIFFICULTY_VALUE_SET: ReadonlySet<string> = new Set(
  DIFFICULTY_OPTIONS.map((d) => d.value),
);

// Recommendation "style" presets. Instead of exposing five raw 0–1 weights
// (which users can't reason about), we offer a few friendly modes that each map
// to a full weight set under the hood. `collab` is preserved separately (engine
// multiplies it by 0 until CF ships).
//
// "adaptive" is special: it has NO static weights — the engine tunes them per
// run from the user's library shape (focused → content-heavy, diverse → more
// graph). It's the DEFAULT for users who never pick a style; the resolved
// weights are computed in lib/reco-data/run.ts (ADAPTIVE_WEIGHTS).
export type PresetKey = "adaptive" | "balanced" | "similar" | "hidden" | "popular";

interface PresetWeights {
  content: number;
  graph: number;
  preference: number;
  popularity: number;
  recency: number;
}

export const WEIGHT_PRESETS: {
  value: PresetKey;
  label: string;
  description: string;
  /** Static weights, or undefined for "adaptive" (tuned per run). */
  weights?: PresetWeights;
}[] = [
  {
    value: "adaptive",
    label: "Adaptive",
    description: "Auto-tunes to your library — sharper focus for a niche taste, more discovery for a varied one.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Mostly your taste, with a touch of popular & new.",
    weights: { content: 0.5, graph: 0.25, preference: 0.2, popularity: 0.05, recency: 0.05 },
  },
  {
    value: "similar",
    label: "More like my games",
    description: "Lean hard into games similar to what you play.",
    weights: { content: 0.6, graph: 0.45, preference: 0.2, popularity: 0.05, recency: 0.05 },
  },
  {
    value: "hidden",
    label: "Discover hidden gems",
    description: "Surface lesser-known games that still fit your taste.",
    weights: { content: 0.5, graph: 0.4, preference: 0.2, popularity: 0.0, recency: 0.15 },
  },
  {
    value: "popular",
    label: "Popular & new",
    description: "Favor well-reviewed and recently released hits.",
    weights: { content: 0.25, graph: 0.15, preference: 0.2, popularity: 0.5, recency: 0.4 },
  },
];

export const WEIGHT_PRESET_MAP = Object.fromEntries(
  WEIGHT_PRESETS.filter((p) => p.weights).map((p) => [p.value, p.weights]),
) as Record<Exclude<PresetKey, "adaptive">, PresetWeights>;

export const PRESET_VALUE_SET: ReadonlySet<string> = new Set(WEIGHT_PRESETS.map((p) => p.value));
// The product default for users who never pick a style: tune weights per library.
export const DEFAULT_PRESET: PresetKey = "adaptive";
// Fallback when a STORED numeric weight set matches no preset (a real manual set,
// so pick the safe numeric default — not "adaptive", which has no static weights).
const NUMERIC_FALLBACK_PRESET: PresetKey = "balanced";

/** True when a stored `weights` jsonb is the "adaptive" sentinel (no static weights). */
function isAdaptiveWeights(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as Record<string, unknown>).adaptive === true;
}

/** Best-matching preset for a stored numeric weight set (so the UI can pre-select it). */
function presetFromWeights(w: Partial<PresetWeights> | null | undefined): PresetKey {
  if (!w) return NUMERIC_FALLBACK_PRESET;
  let best: PresetKey = NUMERIC_FALLBACK_PRESET;
  let bestDiff = Infinity;
  for (const p of WEIGHT_PRESETS) {
    if (!p.weights) continue;
    const d =
      Math.abs((w.content ?? 0) - p.weights.content) +
      Math.abs((w.graph ?? 0) - p.weights.graph) +
      Math.abs((w.preference ?? 0) - p.weights.preference) +
      Math.abs((w.popularity ?? 0) - p.weights.popularity) +
      Math.abs((w.recency ?? 0) - p.weights.recency);
    if (d < bestDiff) {
      bestDiff = d;
      best = p.value;
    }
  }
  return bestDiff <= 0.02 ? best : NUMERIC_FALLBACK_PRESET;
}

/** Pre-select the right chip from the RAW stored weights jsonb: the adaptive
 *  sentinel → "adaptive"; nothing stored → the default ("adaptive"); a numeric
 *  set → its closest preset. */
export function presetFromStored(raw: unknown): PresetKey {
  if (isAdaptiveWeights(raw)) return "adaptive";
  if (!raw) return DEFAULT_PRESET;
  return presetFromWeights(raw as Partial<PresetWeights>);
}
