// One-off catalog enrichment runner (Phase 3, Step C).
//
//   node --env-file=.env.local scripts/enrich-catalog.ts [catalogSize] [playedCap]
//
// Enriches the SHARED candidate catalog (top-N most-owned PC games from
// SteamSpy) plus each user's most-PLAYED games (playtime > 0, capped). Unplayed
// owned games are intentionally NOT enriched — they contribute nothing to the
// taste vector (weight = log(1+minutes)) and are excluded from recs by app_id
// alone. Idempotent + skip-if-fresh, so re-runs are cheap.
//
// Relative `.ts` imports (no `@/`) so plain Node can resolve the chain.

import { getSteamSpyTop } from "../lib/steam/api.ts";
import { enrichGames, type EnrichStatus } from "../lib/steam/enrich.ts";
import { createAdminClient } from "../lib/supabase/admin.ts";

const CATALOG_SIZE = Number(process.argv[2] ?? 300);
const PLAYED_CAP = Number(process.argv[3] ?? 50);

async function playedAppIds(cap: number): Promise<number[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_games")
    .select("app_id, playtime_forever")
    .gt("playtime_forever", 0)
    .order("playtime_forever", { ascending: false })
    .limit(cap);
  if (error) throw new Error(`played lookup: ${error.message}`);
  return (data ?? []).map((r) => r.app_id as number);
}

async function main(): Promise<void> {
  console.log(`[enrich] catalog top ${CATALOG_SIZE} + top ${PLAYED_CAP} played games`);

  const [catalog, played] = await Promise.all([
    getSteamSpyTop(CATALOG_SIZE),
    playedAppIds(PLAYED_CAP),
  ]);
  console.log(`[enrich] catalog=${catalog.length} played=${played.length}`);

  const appIds = [...new Set([...catalog.map((c) => c.appId), ...played])];
  console.log(`[enrich] ${appIds.length} unique app ids to process (skips fresh)`);

  const counts: Record<EnrichStatus, number> = {
    enriched: 0,
    "skipped-fresh": 0,
    "no-store-page": 0,
    error: 0,
  };

  const summary = await enrichGames({
    appIds,
    onProgress: (done, total, appId, status) => {
      counts[status]++;
      if (status === "enriched" || done % 25 === 0 || done === total) {
        console.log(`[enrich] ${done}/${total} app ${appId} → ${status}`);
      }
    },
  });

  console.log("[enrich] done:", JSON.stringify(summary));
}

main().catch((e) => {
  console.error("[enrich] fatal:", e);
  process.exit(1);
});
