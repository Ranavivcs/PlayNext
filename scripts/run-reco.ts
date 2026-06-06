// One-off live runner for the recommendation engine (Phase 3, Step D).
//
//   node --env-file=.env.local scripts/run-reco.ts [steamId] [--mode=co-op] [--platform=windows,linux]
//
// Resolves the auth user from a linked Steam id (default = test account "Ran"),
// runs the full DB→filter→engine→persist path with the service-role client
// (bypasses RLS for the script), and prints the ranked result + breakdown.
// Optional --mode / --platform flags exercise the hard-filter layer on live data
// (the UI passes the same HardFilters via the dashboard form).
//
// Relative `.ts` imports (no `@/`) so plain Node resolves the chain.

import { createAdminClient } from "../lib/supabase/admin.ts";
import { generateRecommendations } from "../lib/reco-data/run.ts";
import type { HardFilters } from "../lib/reco-data/filters.ts";

const DEFAULT_STEAM_ID = "76561198137404352"; // linked test account "Ran"

const args = process.argv.slice(2);
const steamId = args.find((a) => !a.startsWith("--")) ?? DEFAULT_STEAM_ID;

function parseFlags(): HardFilters {
  const filters: HardFilters = {};
  for (const a of args) {
    if (a.startsWith("--mode=")) {
      filters.mode = a.slice("--mode=".length) as HardFilters["mode"];
    } else if (a.startsWith("--platform=")) {
      filters.platforms = a
        .slice("--platform=".length)
        .split(",")
        .filter(Boolean) as NonNullable<HardFilters["platforms"]>;
    }
  }
  return filters;
}

async function resolveUserId(client: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data, error } = await client
    .from("steam_accounts")
    .select("user_id,persona_name")
    .eq("steam_id", steamId)
    .maybeSingle();
  if (error) throw new Error(`steam_accounts lookup: ${error.message}`);
  if (!data) throw new Error(`no linked account for steam_id ${steamId}`);
  console.log(`[reco] user ${data.user_id} (steam "${data.persona_name}")`);
  return data.user_id as string;
}

async function main(): Promise<void> {
  const client = createAdminClient();
  const userId = await resolveUserId(client);
  const filters = parseFlags();
  if (Object.keys(filters).length > 0) {
    console.log(`[reco] filters: ${JSON.stringify(filters)}`);
  }

  const { results, candidateCount, recId } = await generateRecommendations({
    client,
    userId,
    filters,
    persist: true,
  });

  console.log(`[reco] candidates after filters: ${candidateCount}`);
  console.log(`[reco] persisted recommendations.id = ${recId}`);
  console.log(`[reco] top ${results.length}:`);
  results.forEach((r, i) => {
    const b = r.breakdown;
    console.log(
      `  ${String(i + 1).padStart(2)}. ${r.name}  score=${r.score.toFixed(4)}  ` +
        `[content=${b.content.toFixed(3)} graph=${b.graph.toFixed(3)} ` +
        `pref=${b.preference.toFixed(3)} pop=${b.popularity.toFixed(3)} ` +
        `rec=${b.recency.toFixed(3)}]`,
    );
  });
}

main().catch((e) => {
  console.error("[reco] fatal:", e);
  process.exit(1);
});
