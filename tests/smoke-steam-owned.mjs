// Live smoke test: read a linked steamid from steam_accounts, then confirm
// Steam's GetOwnedGames returns that library. Read-only; writes nothing.
// Run: node --env-file=.env.local tests/smoke-steam-owned.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const steamKey = process.env.STEAM_API_KEY;

if (!steamKey) {
  console.error("FAIL: STEAM_API_KEY not set");
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: accounts, error } = await admin
  .from("steam_accounts")
  .select("steam_id, persona_name")
  .limit(1);

if (error || !accounts?.length) {
  console.error("FAIL: no linked steam_accounts row found", error?.message ?? "");
  process.exit(1);
}

const { steam_id, persona_name } = accounts[0];
console.log(`Found linked account: ${persona_name ?? "(no persona)"} (${steam_id})`);

const api =
  `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamKey}` +
  `&steamid=${steam_id}&include_appinfo=1&include_played_free_games=1&format=json`;

const res = await fetch(api);
if (!res.ok) {
  console.error(`FAIL: GetOwnedGames HTTP ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const games = json?.response?.games;

if (!Array.isArray(games)) {
  console.log("RESULT: library is PRIVATE (no games array) — app will cold-start.");
  process.exit(0);
}

console.log(`PASS: ${games.length} games visible.`);
const top = [...games]
  .sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0))
  .slice(0, 5);
for (const g of top) {
  console.log(`  - ${g.name} (${((g.playtime_forever ?? 0) / 60).toFixed(1)} h)`);
}
process.exit(0);
