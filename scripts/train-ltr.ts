// Learning-to-rank training + held-out eval on a MIXED population (step 2b).
//
//   node --env-file=.env.local scripts/train-ltr.ts
//
// Why mixed: on a homogeneous coherent-taste population a single content-heavy
// weighting already fits everyone, so LTR can't beat hand-tuning. Real users
// vary — some have a focused taste, some a diverse multi-genre library. Here we
// generate BOTH (coherent: 1 tag; diverse: 2–3 blended tags) and give the learner
// both SINGLE-centroid and CLUSTERED content as separate features, so it can
// learn that focused tastes want single content while diverse tastes want
// clustered content + graph. On a mixed population no fixed weight is best for
// all → the learned blend should win, shown via a per-segment breakdown.
//
// Read-only DB; pure engine + pure learner. Relative `.ts` imports.

import { createAdminClient } from "../lib/supabase/admin.ts";
import { loadCatalog } from "../lib/reco-data/catalog.ts";
import { recommend } from "../lib/reco/recommend.ts";
import type { GameFeatures, OwnedGame, Weights } from "../lib/reco/types.ts";
import { trainPairwiseLogistic, type RankQuery } from "../lib/reco/learn.ts";
import { ndcgAtK, recallAtK, reciprocalRank } from "../lib/reco/metrics.ts";

const K = 10;
const OWNED_PER_USER = 12;
const HELDOUT_PER_USER = 4;
const COHERENT_PER_THEME = 5;
const DIVERSE_USERS = 100;
const MIN_POOL = 25;
const MAX_POOL = 800;
const MAX_THEMES = 24;
const TRAIN_FRAC = 0.7;
const NOW = new Date("2026-06-06T00:00:00Z");
const SEED = 20260606;

// Feature order for the learned weight vector.
const FEATURES = ["content_single", "content_clustered", "graph", "preference", "popularity", "recency"] as const;
const DIM = FEATURES.length;
const ALL_ONES: Weights = { content: 1, graph: 1, preference: 1, popularity: 1, recency: 1, collab: 0 };

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
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

interface RawUser {
  kind: "coherent" | "diverse";
  owned: OwnedGame[];
  ownedFeatures: GameFeatures[];
  heldout: Set<number>;
}
interface UserData extends RawUser {
  items: { appId: number; features: number[]; label: 0 | 1 }[];
}

async function main(): Promise<void> {
  const client = createAdminClient();
  const rng = mulberry32(SEED);

  const catalog = await loadCatalog(client);
  const candidates: GameFeatures[] = catalog.map((c) => c.features);
  const featById = new Map(candidates.map((f) => [f.appId, f]));

  const pools = new Map<string, number[]>();
  for (const f of candidates) {
    for (const t of f.tags) {
      if (GENERIC.has(t)) continue;
      (pools.get(t) ?? pools.set(t, []).get(t)!).push(f.appId);
    }
  }
  let themes = [...pools.entries()].filter(([, ids]) => ids.length >= MIN_POOL && ids.length <= MAX_POOL);
  themes = shuffled(themes, rng).slice(0, MAX_THEMES);

  const mkOwned = (ids: number[]): RawUser["owned"] =>
    ids.map((id) => ({ appId: id, playtimeMinutes: Math.floor(60 + rng() * 6000) }));
  const featsFor = (ids: number[]): GameFeatures[] =>
    ids.map((id) => featById.get(id)).filter((f): f is GameFeatures => !!f);

  const raw: RawUser[] = [];

  // Coherent users: one theme each.
  for (const [, pool] of themes) {
    for (let u = 0; u < COHERENT_PER_THEME; u++) {
      const sample = shuffled(pool, rng).slice(0, OWNED_PER_USER);
      if (sample.length < OWNED_PER_USER) break;
      const heldout = new Set(sample.slice(0, HELDOUT_PER_USER));
      const taste = sample.slice(HELDOUT_PER_USER);
      raw.push({ kind: "coherent", owned: mkOwned(taste), ownedFeatures: featsFor(taste), heldout });
    }
  }

  // Diverse users: blend 2–3 themes, hold out games from each constituent theme.
  for (let u = 0; u < DIVERSE_USERS; u++) {
    const nThemes = 2 + Math.floor(rng() * 2); // 2 or 3
    const chosen = shuffled(themes, rng).slice(0, nThemes);
    const perTheme = Math.floor(OWNED_PER_USER / nThemes);
    const owned: number[] = [];
    const heldout = new Set<number>();
    const seen = new Set<number>();
    for (const [, pool] of chosen) {
      const pick = shuffled(pool, rng).filter((id) => !seen.has(id)).slice(0, perTheme);
      pick.forEach((id) => seen.add(id));
      // hold out 1 per theme
      if (pick.length > 0) heldout.add(pick[0]);
      owned.push(...pick);
    }
    if (owned.length < nThemes + 1) continue;
    const taste = owned.filter((id) => !heldout.has(id));
    raw.push({ kind: "diverse", owned: mkOwned(taste), ownedFeatures: featsFor(taste), heldout });
  }

  // Extract features: one engine pass per taste mode (graph/pop/recency/pref are
  // mode-independent; only content differs), merged per candidate.
  process.stderr.write(`  extracting features for ${raw.length} users `);
  const users: UserData[] = [];
  for (const r of raw) {
    const common = { candidates, owned: r.owned, ownedFeatures: r.ownedFeatures, weights: ALL_ONES, topK: candidates.length, mmrLambda: 1, diversify: "mmr" as const, now: NOW };
    const single = recommend({ ...common, tasteMode: "single" });
    const clustered = recommend({ ...common, tasteMode: "clustered" });
    const clusteredContent = new Map(clustered.map((r2) => [r2.appId, r2.breakdown.content]));
    const items = single.map((g) => ({
      appId: g.appId,
      features: [
        g.breakdown.content, // content_single
        clusteredContent.get(g.appId) ?? 0, // content_clustered
        g.breakdown.graph,
        g.breakdown.preference,
        g.breakdown.popularity,
        g.breakdown.recency,
      ],
      label: (r.heldout.has(g.appId) ? 1 : 0) as 0 | 1,
    }));
    users.push({ ...r, items });
    if (users.length % 20 === 0) process.stderr.write(".");
  }
  process.stderr.write(" done\n");

  const shuffledUsers = shuffled(users, mulberry32(SEED + 1));
  const nTrain = Math.floor(shuffledUsers.length * TRAIN_FRAC);
  const train = shuffledUsers.slice(0, nTrain);
  const test = shuffledUsers.slice(nTrain);

  const trainQueries: RankQuery[] = train.map((u) => u.items.map((it) => ({ features: it.features, label: it.label })));
  const learned = trainPairwiseLogistic(trainQueries, DIM, { seed: 1 });

  const nCoh = users.filter((u) => u.kind === "coherent").length;
  console.log(`Catalog ${candidates.length} | users ${users.length} (coherent ${nCoh}, diverse ${users.length - nCoh}) | train ${train.length}/test ${test.length}`);
  console.log(`\nLearned weights (pairwise-logistic LTR, normalized):`);
  FEATURES.forEach((f, i) => console.log(`  ${f.padEnd(17)} ${learned[i].toFixed(3)}`));

  const VECTORS: { label: string; w: number[] }[] = [
    { label: "Learned (LTR)", w: learned },
    { label: "Content single-only", w: [1, 0, 0, 0, 0, 0] },
    { label: "Content clustered-only", w: [0, 1, 0, 0, 0, 0] },
    { label: "Content+Graph (single)", w: [1, 0, 1, 0, 0, 0] },
    { label: "Balanced (hand)", w: [0.4, 0, 0.25, 0.25, 0.15, 0.1] },
    { label: "Popularity-only", w: [0, 0, 0, 0, 1, 0] },
  ];

  const ndcgFor = (w: number[], pool: UserData[]): number =>
    mean(
      pool.map((u) => {
        const ranked = u.items
          .map((it) => ({ appId: it.appId, s: dot(w, it.features) }))
          .sort((a, b) => b.s - a.s)
          .map((x) => x.appId);
        return ndcgAtK(ranked, u.heldout, K);
      }),
    );
  const metricsFor = (w: number[], pool: UserData[]) => {
    const nd: number[] = [], rc: number[] = [], mr: number[] = [];
    for (const u of pool) {
      const ranked = u.items.map((it) => ({ appId: it.appId, s: dot(w, it.features) })).sort((a, b) => b.s - a.s).map((x) => x.appId);
      nd.push(ndcgAtK(ranked, u.heldout, K));
      rc.push(recallAtK(ranked, u.heldout, K));
      mr.push(reciprocalRank(ranked, u.heldout));
    }
    return { ndcg: mean(nd), recall: mean(rc), mrr: mean(mr) };
  };

  const testCoh = test.filter((u) => u.kind === "coherent");
  const testDiv = test.filter((u) => u.kind === "diverse");

  console.log(`\nHeld-out TEST (${test.length} users: ${testCoh.length} coherent, ${testDiv.length} diverse) @K=${K}:`);
  const head = ["Weights", "NDCG(all)", "Recall", "MRR", "NDCG coh", "NDCG div"];
  const rows = VECTORS.map((v) => {
    const m = metricsFor(v.w, test);
    return [v.label, m.ndcg.toFixed(3), m.recall.toFixed(3), m.mrr.toFixed(3), ndcgFor(v.w, testCoh).toFixed(3), ndcgFor(v.w, testDiv).toFixed(3)];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(fmt(head));
  console.log(widths.map((wd) => "-".repeat(wd)).join("  "));
  for (const r of rows) console.log(fmt(r));
}

main().catch((e) => {
  console.error("[train-ltr] fatal:", e);
  process.exit(1);
});
