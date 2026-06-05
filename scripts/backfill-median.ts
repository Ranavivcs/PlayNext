// One-off backfill of games.median_playtime (SteamSpy median_forever, minutes).
// Reads it from SteamSpy's `all` pages — which already include median_forever
// per app — so we touch ~3 pages instead of making one call per game. Only
// UPDATES rows that already exist in `games` (never inserts), so it can't add
// junk catalog rows.
//
// Run: node --env-file=.env.local scripts/backfill-median.ts [pages=3]
// Relative `.ts` imports (no `@/` alias) so plain Node can resolve the chain.

import { createAdminClient } from "../lib/supabase/admin.ts";

const PAGE_WAIT_MS = 61_000; // SteamSpy throttles `all` to ~1 req/min

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const pages = Math.max(1, parseInt(process.argv[2] ?? "3", 10));
  const admin = createAdminClient();

  // 1. Existing enriched app_ids (paged past the 1000-row cap).
  const existing = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("games")
      .select("app_id")
      .not("enriched_at", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`games load: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) existing.add(r.app_id as number);
    if (rows.length < 1000) break;
  }
  console.log(`Enriched games in catalog: ${existing.size}`);

  // 2. median_forever per app from SteamSpy `all` pages.
  const median = new Map<number, number>();
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAGE_WAIT_MS);
    const res = await fetch(`https://steamspy.com/api.php?request=all&page=${page}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`SteamSpy all page ${page}: ${res.status}`);
    const json = (await res.json()) as Record<string, { appid: number; median_forever?: number }>;
    let added = 0;
    for (const g of Object.values(json)) {
      if (typeof g?.appid !== "number") continue;
      const m = Number(g.median_forever);
      if (Number.isFinite(m) && m > 0 && existing.has(g.appid)) {
        median.set(g.appid, m);
        added++;
      }
    }
    console.log(`page ${page}: matched ${added} catalog games (running total ${median.size})`);
  }

  // 3. Update only existing rows, in batches (upsert = UPDATE path since they exist).
  const rows = [...median.entries()].map(([app_id, median_playtime]) => ({
    app_id,
    median_playtime,
  }));
  let updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await admin.from("games").upsert(batch, { onConflict: "app_id" });
    if (error) throw new Error(`median upsert: ${error.message}`);
    updated += batch.length;
  }

  console.log(
    `Backfilled median_playtime for ${updated} games (of ${existing.size} enriched; ` +
      `${existing.size - updated} had no SteamSpy median in the fetched pages).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
