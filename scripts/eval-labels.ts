// Label-recovery harness for the "detected styles" feature (step A2 part 2).
//
//   node --env-file=.env.local scripts/eval-labels.ts
//
// Validates describeStyles() across MANY synthetic libraries built from KNOWN
// themes (community tags), not just Ran's one library. For a user assembled from
// theme tag(s) T, a correct labeler should name T back. We measure:
//   - coherent users (one theme): is T the top label (@1)? in the top 3 (@3)?
//   - diverse users (2–3 blended themes): what fraction of the themes land in
//     the top labels?
// and compare three candidate heuristics head-to-head so the choice is evidenced.
//
// Read-only; reuses eval-synth's generation. Relative `.ts` imports.

import { createAdminClient } from "../lib/supabase/admin.ts";
import { loadCatalog } from "../lib/reco-data/catalog.ts";
import { buildIdf } from "../lib/reco/vectorize.ts";
import { describeStyles } from "../lib/reco/recommend.ts";
import type { GameFeatures } from "../lib/reco/types.ts";

const OWNED_COHERENT = 10;
const USERS_PER_THEME = 8;
const DIVERSE_USERS = 120;
const GAMES_PER_SUBTHEME = 4; // diverse user: this many games per blended theme
const MIN_POOL = 25;
const MAX_POOL = 800;
const MAX_THEMES = 40;
const TOP_N = 3; // labels the UI shows
const SEED = 20260616;

// Same broad/descriptive tags eval-synth excludes as theme definers.
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
function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(0)}%` : "—";
}

// --- candidate heuristics (the shipped one is imported as describeStyles) ----
function byCountIdf(feats: GameFeatures[], idf: Map<string, number>): string[] {
  const count = new Map<string, number>();
  for (const f of feats) for (const t of f.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .map(([tag, c]) => ({ tag, c, s: c * (idf.get(`t:${tag}`) ?? 0) }))
    .sort((a, b) => b.s - a.s || b.c - a.c || a.tag.localeCompare(b.tag))
    .map((x) => x.tag);
}
function byCountIdfNoGeneric(feats: GameFeatures[], idf: Map<string, number>): string[] {
  return byCountIdf(feats, idf).filter((t) => !GENERIC.has(t));
}
function byIdfNoGeneric(feats: GameFeatures[], idf: Map<string, number>): string[] {
  return describeStyles(feats, idf).filter((t) => !GENERIC.has(t));
}
function byCount(feats: GameFeatures[]): string[] {
  const count = new Map<string, number>();
  for (const f of feats) for (const t of f.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

type Heuristic = { name: string; fn: (f: GameFeatures[], idf: Map<string, number>) => string[] };
const HEURISTICS: Heuristic[] = [
  { name: "distinctiveness-first (idf, ≥2)", fn: describeStyles },
  { name: "idf, ≥2, no-generic", fn: byIdfNoGeneric },
  { name: "count·idf (≥2)", fn: byCountIdf },
  { name: "count·idf, ≥2, no-generic", fn: byCountIdfNoGeneric },
  { name: "count (≥2)", fn: byCount },
];

async function main(): Promise<void> {
  const client = createAdminClient();
  const rng = mulberry32(SEED);
  const catalog = await loadCatalog(client);
  const candidates: GameFeatures[] = catalog.map((c) => c.features);
  const featById = new Map(candidates.map((f) => [f.appId, f]));
  const idf = buildIdf(candidates); // catalog-wide rarity (as run.ts uses, sans filters)

  const pools = new Map<string, number[]>();
  for (const f of candidates) {
    for (const t of f.tags) {
      if (GENERIC.has(t)) continue;
      (pools.get(t) ?? pools.set(t, []).get(t)!).push(f.appId);
    }
  }
  let themes = [...pools.entries()].filter(([, ids]) => ids.length >= MIN_POOL && ids.length <= MAX_POOL);
  themes = shuffled(themes, rng).slice(0, MAX_THEMES);
  const themeNames = themes.map(([t]) => t);

  // Coherent users: all games carry one theme tag.
  interface Coh { theme: string; feats: GameFeatures[] }
  const coherent: Coh[] = [];
  for (const [theme, pool] of themes) {
    for (let u = 0; u < USERS_PER_THEME; u++) {
      const ids = shuffled(pool, rng).slice(0, OWNED_COHERENT);
      if (ids.length < OWNED_COHERENT) break;
      coherent.push({ theme, feats: ids.map((id) => featById.get(id)!).filter(Boolean) });
    }
  }

  // Diverse users: blend 2–3 themes, a few games from each.
  interface Div { themes: string[]; feats: GameFeatures[] }
  const diverse: Div[] = [];
  for (let u = 0; u < DIVERSE_USERS; u++) {
    const k = 2 + (rng() < 0.5 ? 0 : 1);
    const picked = shuffled(themeNames, rng).slice(0, k);
    const ids = new Set<number>();
    for (const t of picked) {
      for (const id of shuffled(pools.get(t)!, rng).slice(0, GAMES_PER_SUBTHEME)) ids.add(id);
    }
    diverse.push({ themes: picked, feats: [...ids].map((id) => featById.get(id)!).filter(Boolean) });
  }

  console.log(`Catalog ${candidates.length} games · ${themes.length} themes`);
  console.log(`Coherent users: ${coherent.length} · Diverse users: ${diverse.length} (2–3 themes each)\n`);

  const head = ["Heuristic", "coh@1", "coh@3", `div recall@${TOP_N}`, "div all-in-top"];
  const rows: string[][] = [];
  for (const h of HEURISTICS) {
    let c1 = 0, c3 = 0;
    for (const u of coherent) {
      const labels = h.fn(u.feats, idf);
      if (labels[0] === u.theme) c1++;
      if (labels.slice(0, TOP_N).includes(u.theme)) c3++;
    }
    let recHits = 0, recTotal = 0, allIn = 0;
    for (const u of diverse) {
      const top = new Set(h.fn(u.feats, idf).slice(0, TOP_N));
      const hit = u.themes.filter((t) => top.has(t)).length;
      recHits += hit; recTotal += u.themes.length;
      if (hit === u.themes.length) allIn++;
    }
    rows.push([h.name, pct(c1, coherent.length), pct(c3, coherent.length), pct(recHits, recTotal), pct(allIn, diverse.length)]);
  }
  const widths = head.map((hh, i) => Math.max(hh.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(fmt(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmt(r));

  // Eyeball a few "count·idf, no-generic" outputs (the leading candidate).
  console.log(`\nSample "count·idf, no-generic" labels (top ${TOP_N}):`);
  const rng2 = mulberry32(SEED + 1);
  for (const u of shuffled(coherent, rng2).slice(0, 6)) {
    console.log(`  coherent "${u.theme}" → ${JSON.stringify(byCountIdfNoGeneric(u.feats, idf).slice(0, TOP_N))}`);
  }
  for (const u of shuffled(diverse, rng2).slice(0, 6)) {
    console.log(`  diverse  [${u.themes.join(" + ")}] → ${JSON.stringify(byCountIdfNoGeneric(u.feats, idf).slice(0, TOP_N))}`);
  }
}

main().catch((e) => {
  console.error("[eval-labels] fatal:", e);
  process.exit(1);
});
