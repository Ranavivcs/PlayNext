// Synthetic-user evaluation harness (Phase: step 2a, de-biased).
//
//   node --env-file=.env.local scripts/eval-synth.ts
//
// The single real user (Ran) has a hyper-diverse, popularity-biased library, so
// real-user LOO can't fairly show "engine beats popularity" (see eval-reco.ts).
// This harness generates MANY synthetic users, each with a COHERENT taste, then
// runs the same hold-out test at scale.
//
// COHERENT TASTE = a single community tag (e.g. "Roguelike", "JRPG"): a
// human-meaningful grouping that is INDEPENDENT of the engine's composite score.
// A user "owns" a sample of games carrying that tag; we hold out a few and ask
// each scorer to rank them among all 2533 candidates. The engine must use its
// FULL TF-IDF + Dijkstra-graph machinery over the whole tag/genre vocabulary —
// not just the grouping tag — so this is not grading the engine on its own
// output. The popularity baseline sees the same candidates without taste, so the
// comparison is fair, and because users are defined by THEME (not popularity) the
// targets aren't systematically popular → the real-user popularity bias is gone.
//
// Read-only; pure engine. Relative `.ts` imports so plain Node resolves them.

import { createAdminClient } from "../lib/supabase/admin.ts";
import { loadCatalog } from "../lib/reco-data/catalog.ts";
import { recommend } from "../lib/reco/recommend.ts";
import type { GameFeatures, OwnedGame, Weights } from "../lib/reco/types.ts";
import { ndcgAtK, recallAtK, reciprocalRank, averagePrecision } from "../lib/reco/metrics.ts";

const K = 10;
const EVAL_DEPTH = 100; // relevant set has several items; rank beyond = miss
const OWNED_PER_USER = 12; // taste + held-out
const HELDOUT_PER_USER = 4; // relevant targets per user
const USERS_PER_THEME = 6;
const MIN_POOL = 25; // theme must have enough games to sample distinct users
const MAX_POOL = 800;
const MAX_THEMES = 28;
const NOW = new Date("2026-06-06T00:00:00Z");
const SEED = 20260606;

// Broad / descriptive / technical tags that don't define a coherent GAME taste.
const GENERIC = new Set([
  "Singleplayer", "Multiplayer", "Co-op", "Online Co-Op", "Local Co-Op", "PvP", "PvE",
  "Indie", "Casual", "Action", "Adventure", "Free to Play", "Early Access",
  "Great Soundtrack", "Atmospheric", "Story Rich", "Open World", "Difficult", "Funny",
  "Relaxing", "Family Friendly", "Controller", "Steam Achievements", "2D", "3D",
  "Pixel Graphics", "Colorful", "Cute", "Masterpiece", "Classic", "Moddable",
  "Massively Multiplayer", "Online", "Multiple Endings", "Choices Matter", "Nudity",
  "Sexual Content", "Violent", "Gore", "Anime", "Cinematic", "Soundtrack", "Memes",
]);

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
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

interface SynthUser {
  theme: string;
  owned: OwnedGame[];
  ownedFeat: GameFeatures[];
  heldout: Set<number>;
}

interface Config {
  label: string;
  weights?: Weights; // omit = random baseline
  taste?: "single" | "clustered";
}

function w(p: Partial<Weights>): Weights {
  return { content: 0, preference: 0, popularity: 0, recency: 0, collab: 0, graph: 0, ...p };
}
const PRESET_BALANCED = w({ content: 0.4, graph: 0.25, preference: 0.25, popularity: 0.15, recency: 0.1 });

const CONFIGS: Config[] = [
  { label: "Random (floor)" },
  { label: "Popularity-only", weights: w({ popularity: 1 }) },
  { label: "Recency-only", weights: w({ recency: 1 }) },
  { label: "Content-only [single]", weights: w({ content: 1 }) },
  { label: "Content+Graph [single]", weights: w({ content: 1, graph: 1 }) },
  { label: "Content-only [clustered]", weights: w({ content: 1 }), taste: "clustered" },
  { label: "Content+Graph [clustered]", weights: w({ content: 1, graph: 1 }), taste: "clustered" },
  { label: "Balanced [clustered]", weights: PRESET_BALANCED, taste: "clustered" },
];

async function main(): Promise<void> {
  const client = createAdminClient();
  const rng = mulberry32(SEED);

  const catalog = await loadCatalog(client);
  const candidates: GameFeatures[] = catalog.map((c) => c.features);
  const featById = new Map(candidates.map((f) => [f.appId, f]));

  // Build tag → appIds pools.
  const pools = new Map<string, number[]>();
  for (const f of candidates) {
    for (const t of f.tags) {
      if (GENERIC.has(t)) continue;
      const arr = pools.get(t);
      if (arr) arr.push(f.appId);
      else pools.set(t, [f.appId]);
    }
  }
  let themes = [...pools.entries()]
    .filter(([, ids]) => ids.length >= MIN_POOL && ids.length <= MAX_POOL);
  themes = shuffled(themes, rng).slice(0, MAX_THEMES);

  // Generate synthetic users.
  const users: SynthUser[] = [];
  for (const [theme, pool] of themes) {
    for (let u = 0; u < USERS_PER_THEME; u++) {
      const sample = shuffled(pool, rng).slice(0, OWNED_PER_USER);
      if (sample.length < OWNED_PER_USER) break;
      const heldout = new Set(sample.slice(0, HELDOUT_PER_USER));
      const tasteIds = sample.slice(HELDOUT_PER_USER);
      const owned: OwnedGame[] = tasteIds.map((id) => ({
        appId: id,
        playtimeMinutes: Math.floor(60 + rng() * 6000),
      }));
      const ownedFeat = tasteIds
        .map((id) => featById.get(id))
        .filter((f): f is GameFeatures => !!f);
      users.push({ theme, owned, ownedFeat, heldout });
    }
  }

  console.log(`Catalog: ${candidates.length} candidates`);
  console.log(`Themes (${themes.length}): ${themes.map(([t, ids]) => `${t}(${ids.length})`).join(", ")}`);
  console.log(`Synthetic users: ${users.length}  (${OWNED_PER_USER} owned = ${OWNED_PER_USER - HELDOUT_PER_USER} taste + ${HELDOUT_PER_USER} held-out)`);
  console.log(`Metrics averaged over users @K=${K}\n`);

  function rankEngine(user: SynthUser, weights: Weights, taste: "single" | "clustered"): number[] {
    const results = recommend({
      candidates,
      owned: user.owned,
      ownedFeatures: user.ownedFeat,
      weights,
      tasteMode: taste,
      topK: EVAL_DEPTH,
      mmrLambda: 1,
      diversify: "mmr",
      now: NOW,
    });
    return results.map((r) => r.appId);
  }
  function rankRandom(user: SynthUser, seed: number): number[] {
    const ownedIds = new Set(user.owned.map((o) => o.appId));
    return shuffled(candidates.filter((c) => !ownedIds.has(c.appId)).map((c) => c.appId), mulberry32(seed));
  }

  // Per-user NDCG arrays so we can compute head-to-head win-rate vs popularity.
  const results: { cfg: Config; ndcg: number[]; recall: number[]; mrr: number[]; map: number[] }[] = [];
  for (const cfg of CONFIGS) {
    const t0 = Date.now();
    process.stderr.write(`  running: ${cfg.label} ... `);
    const ndcg: number[] = [], recall: number[] = [], mrr: number[] = [], map: number[] = [];
    let seed = 7;
    for (const user of users) {
      const ranked = cfg.weights ? rankEngine(user, cfg.weights, cfg.taste ?? "single") : rankRandom(user, seed++);
      ndcg.push(ndcgAtK(ranked, user.heldout, K));
      recall.push(recallAtK(ranked, user.heldout, K));
      mrr.push(reciprocalRank(ranked, user.heldout));
      map.push(averagePrecision(ranked, user.heldout));
    }
    results.push({ cfg, ndcg, recall, mrr, map });
    process.stderr.write(`done (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  const popNdcg = results.find((r) => r.cfg.label === "Popularity-only")!.ndcg;
  const head = ["Config", `NDCG@${K}`, `Recall@${K}`, "MRR", "MAP", "win%vsPop"];
  const rows = results.map((r) => {
    const wins = r.ndcg.filter((v, i) => v > popNdcg[i]).length;
    return [
      r.cfg.label,
      mean(r.ndcg).toFixed(3),
      mean(r.recall).toFixed(3),
      mean(r.mrr).toFixed(3),
      mean(r.map).toFixed(3),
      `${((100 * wins) / r.ndcg.length).toFixed(0)}%`,
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(fmt(head));
  console.log(widths.map((wd) => "-".repeat(wd)).join("  "));
  for (const r of rows) console.log(fmt(r));
}

main().catch((e) => {
  console.error("[eval-synth] fatal:", e);
  process.exit(1);
});
