// Offline evaluation harness for the recommendation engine (Phase: step 2a).
//
//   node --env-file=.env.local scripts/eval-reco.ts [steamId]
//
// Leave-one-out (LOO) protocol on REAL data: for each of the user's
// played+enriched games, hold it out, build the taste vector from the rest,
// rank the FULL catalog, and record where the held-out game lands. Average the
// ranking metrics across folds. Compares baselines (random / popularity /
// recency) against the engine and runs the Dijkstra-graph ablation.
//
// Read-only: loads from Supabase (admin client) and calls the PURE engine. No
// writes, no AI. Relative `.ts` imports (no `@/`) so plain Node resolves them.

import { createAdminClient } from "../lib/supabase/admin.ts";
import { loadCatalog, loadFeaturesFor } from "../lib/reco-data/catalog.ts";
import { recommend } from "../lib/reco/recommend.ts";
import type { GameFeatures, OwnedGame, Weights } from "../lib/reco/types.ts";
import { ndcgAtK, recallAtK, reciprocalRank } from "../lib/reco/metrics.ts";

const DEFAULT_STEAM_ID = "76561198137404352"; // linked test account "Ran"
const NOW = new Date("2026-06-06T00:00:00Z"); // fixed so recency is deterministic
const K = 10;
// Evaluation depth: we ask the engine for the top-EVAL_DEPTH with mmrLambda=1
// (pure relevance = exact score order), so NDCG@10/Recall@10/MRR are exact.
// A held-out game beyond this depth is a "miss" (rank capped at EVAL_DEPTH+1).
// Bounded so MMR's O(k^2) sim pairs stay cheap (full-size topK is ~O(n^3)).
const EVAL_DEPTH = 50;

const steamId = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DEFAULT_STEAM_ID;

// Full weight set helper (collab always 0 — CF deferred).
function w(p: Partial<Weights>): Weights {
  return {
    content: 0,
    preference: 0,
    popularity: 0,
    recency: 0,
    collab: 0,
    graph: 0,
    ...p,
  };
}

// Preset weights mirror app/dashboard/preferences-options.ts WEIGHT_PRESETS
// (inlined to keep the script free of Next app/server-only imports).
const PRESET_BALANCED = w({ content: 0.4, graph: 0.25, preference: 0.25, popularity: 0.15, recency: 0.1 });
const PRESET_MORE_LIKE = w({ content: 0.6, graph: 0.45, preference: 0.2, popularity: 0.05, recency: 0.05 });
const PRESET_POPULAR_NEW = w({ content: 0.25, graph: 0.15, preference: 0.2, popularity: 0.5, recency: 0.4 });

interface Config {
  label: string;
  /** Engine weights; omit for the special random baseline. */
  weights?: Weights;
  taste?: "single" | "clustered";
}

const CONFIGS: Config[] = [
  { label: "Random (floor)" },
  { label: "Popularity-only", weights: w({ popularity: 1 }) },
  { label: "Recency-only", weights: w({ recency: 1 }) },
  { label: "Content-only", weights: w({ content: 1 }) },
  { label: "Content+Graph", weights: w({ content: 1, graph: 1 }) },
  { label: "Balanced", weights: PRESET_BALANCED },
  { label: "Balanced - graph (ablation)", weights: w({ ...PRESET_BALANCED, graph: 0 }) },
  { label: "More like my games", weights: PRESET_MORE_LIKE },
  { label: "Popular & new (current)", weights: PRESET_POPULAR_NEW },
  // Multi-centroid (clustered) taste — the fix under test.
  { label: "Content-only [clustered]", weights: w({ content: 1 }), taste: "clustered" },
  { label: "Content+Graph [clustered]", weights: w({ content: 1, graph: 1 }), taste: "clustered" },
  { label: "Balanced [clustered]", weights: PRESET_BALANCED, taste: "clustered" },
  { label: "More like my games [clustered]", weights: PRESET_MORE_LIKE, taste: "clustered" },
];

// Deterministic PRNG (mulberry32) for the random baseline.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Agg {
  ndcg: number;
  recall: number;
  mrr: number;
  ranks: number[];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(): Promise<void> {
  const client = createAdminClient();

  // Resolve user from the linked Steam id.
  const { data: acct, error: e1 } = await client
    .from("steam_accounts")
    .select("user_id,persona_name")
    .eq("steam_id", steamId)
    .maybeSingle();
  if (e1) throw new Error(`steam_accounts: ${e1.message}`);
  if (!acct) throw new Error(`no linked account for steam_id ${steamId}`);
  const userId = acct.user_id as string;

  // Load owned games (+ playtime) and preferred tags.
  const { data: ownedRows } = await client
    .from("user_games")
    .select("app_id,playtime_forever")
    .eq("user_id", userId);
  const { data: prefRow } = await client
    .from("user_preferences")
    .select("preferred_tags,preferred_genres")
    .eq("user_id", userId)
    .maybeSingle();
  const preferredTags: string[] = prefRow?.preferred_tags ?? [];
  const preferredGenres: string[] = prefRow?.preferred_genres ?? [];

  const owned: OwnedGame[] = (ownedRows ?? []).map((r) => ({
    appId: r.app_id as number,
    playtimeMinutes: (r.playtime_forever as number) ?? 0,
  }));

  // Catalog = full candidate universe.
  const catalog = await loadCatalog(client);
  const candidates: GameFeatures[] = catalog.map((c) => c.features);
  const catalogIds = new Set(candidates.map((c) => c.appId));

  // Owned features (taste source) for owned games present in the catalog.
  const ownedFeatures = await loadFeaturesFor(
    client,
    owned.map((o) => o.appId),
  );
  const ownedFeatById = new Map(ownedFeatures.map((f) => [f.appId, f]));

  // LOO targets = PLAYED (playtime > 0) AND enriched (in catalog), so they can
  // be both a taste source and a rankable candidate.
  const targets = owned
    .filter((o) => o.playtimeMinutes > 0 && catalogIds.has(o.appId))
    .map((o) => o.appId);

  console.log(`User ${userId} (steam "${acct.persona_name}")`);
  console.log(`Catalog: ${candidates.length} enriched candidates`);
  console.log(`Owned: ${owned.length} | LOO targets (played & enriched): ${targets.length}`);
  console.log(`Preferred tags: [${preferredTags.join(", ")}]`);
  console.log(`Metrics averaged over ${targets.length} leave-one-out folds @K=${K}\n`);

  // Rank the full catalog for one LOO fold under the given weights.
  function rankEngine(
    targetId: number,
    weights: Weights,
    taste: "single" | "clustered" = "single",
  ): number[] {
    const ownedForRun = owned.filter((o) => o.appId !== targetId);
    const ownedFeatForRun = ownedForRun
      .map((o) => ownedFeatById.get(o.appId))
      .filter((f): f is GameFeatures => !!f);
    const results = recommend({
      candidates,
      owned: ownedForRun,
      ownedFeatures: ownedFeatForRun,
      preferredGenres,
      preferredTags,
      weights,
      tasteMode: taste,
      topK: EVAL_DEPTH, // bounded; mmrLambda=1 makes this the exact top-N by score
      mmrLambda: 1, // pure relevance order (no diversity reordering)
      diversify: "mmr",
      now: NOW,
    });
    return results.map((r) => r.appId);
  }

  // Random baseline: shuffle the candidate pool (minus owned) per fold.
  function rankRandom(targetId: number, seed: number): number[] {
    const ownedIds = new Set(owned.filter((o) => o.appId !== targetId).map((o) => o.appId));
    const pool = candidates.filter((c) => !ownedIds.has(c.appId)).map((c) => c.appId);
    return shuffled(pool, mulberry32(seed));
  }

  const table: { label: string; agg: Agg }[] = [];
  for (const cfg of CONFIGS) {
    const t0 = Date.now();
    process.stderr.write(`  running: ${cfg.label} ... `);
    const agg: Agg = { ndcg: 0, recall: 0, mrr: 0, ranks: [] };
    let seed = 1337;
    for (const t of targets) {
      const ranked = cfg.weights
        ? rankEngine(t, cfg.weights, cfg.taste ?? "single")
        : rankRandom(t, seed++);
      const rel = new Set([t]);
      agg.ndcg += ndcgAtK(ranked, rel, K);
      agg.recall += recallAtK(ranked, rel, K);
      agg.mrr += reciprocalRank(ranked, rel);
      const idx = ranked.indexOf(t);
      // Uniform cap so engine (depth EVAL_DEPTH) and random are comparable.
      agg.ranks.push(idx >= 0 && idx < EVAL_DEPTH ? idx + 1 : EVAL_DEPTH + 1);
    }
    const n = targets.length;
    agg.ndcg /= n;
    agg.recall /= n;
    agg.mrr /= n;
    table.push({ label: cfg.label, agg });
    process.stderr.write(`done (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  // Print comparison table.
  const head = ["Config", `NDCG@${K}`, `Recall@${K}`, "MRR", "MeanRank", "MedRank"];
  const rows = table.map((r) => [
    r.label,
    r.agg.ndcg.toFixed(3),
    r.agg.recall.toFixed(3),
    r.agg.mrr.toFixed(3),
    mean(r.agg.ranks).toFixed(0),
    median(r.agg.ranks).toFixed(0),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(fmt(head));
  console.log(widths.map((wd) => "-".repeat(wd)).join("  "));
  for (const r of rows) console.log(fmt(r));

  // Per-target ranks under the best content config, to see what the engine
  // recovers well vs poorly.
  console.log(`\nPer-target rank (Content+Graph [clustered]), by held-out game:`);
  const nameById = new Map(candidates.map((c) => [c.appId, c.name]));
  const perTarget = targets
    .map((t) => {
      const ranked = rankEngine(t, w({ content: 1, graph: 1 }), "clustered");
      const idx = ranked.indexOf(t);
      return { name: nameById.get(t) ?? String(t), rank: idx >= 0 ? idx + 1 : ranked.length + 1 };
    })
    .sort((a, b) => a.rank - b.rank);
  for (const p of perTarget) console.log(`  #${String(p.rank).padStart(4)}  ${p.name}`);
}

main().catch((e) => {
  console.error("[eval] fatal:", e);
  process.exit(1);
});
