// Bridge-layer types. This folder is the impure "fetch(db)" stage that turns
// Supabase rows into the pure inputs lib/reco expects. Relative `.ts` imports
// (no `@/`) so a plain-Node script and Next can resolve the chain identically.

import type { GameFeatures } from "../reco/types.ts";

export interface PlatformFlags {
  windows: boolean;
  mac: boolean;
  linux: boolean;
}

/**
 * One catalog row: the pure `GameFeatures` handed to the scoring core, plus
 * filter-only metadata (PC platforms, Steam gameplay categories) that the
 * hard-filter layer reads but the engine never sees. Keeping these off
 * `GameFeatures` is what lets `lib/reco` stay pure.
 */
export interface CatalogEntry {
  features: GameFeatures;
  platforms: PlatformFlags;
  categories: string[];
}
