import { test } from "node:test";
import assert from "node:assert/strict";

import { recommend } from "../../lib/reco/recommend.ts";
import { ndcgAtK } from "../../lib/reco/metrics.ts";
import type { Weights } from "../../lib/reco/types.ts";
import { buildCatalog, actionLover } from "./fixtures.ts";

const NOW = new Date("2026-05-29");

const CONTENT_ONLY: Weights = {
  content: 1,
  preference: 0,
  popularity: 0,
  recency: 0,
  collab: 0,
};

const BALANCED: Weights = {
  content: 1,
  preference: 0.5,
  popularity: 0.3,
  recency: 0.2,
  collab: 0,
};

test("breakdown sums to score for every result", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const results = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    preferredGenres: ["Action"],
    weights: BALANCED,
    now: NOW,
  });
  assert.ok(results.length > 0);
  for (const r of results) {
    const sum =
      r.breakdown.content +
      r.breakdown.preference +
      r.breakdown.popularity +
      r.breakdown.recency +
      r.breakdown.collab +
      r.breakdown.graph;
    assert.ok(Math.abs(sum - r.score) < 1e-9, `breakdown ${sum} != score ${r.score}`);
  }
});

test("owned and dismissed games are excluded", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const dismissed = user.relevantAppIds[0]; // dismiss one otherwise-relevant game
  const results = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    dismissedAppIds: [dismissed],
    weights: BALANCED,
    now: NOW,
    topK: 50,
  });
  const ids = new Set(results.map((r) => r.appId));
  for (const o of user.owned) assert.ok(!ids.has(o.appId), "owned leaked into results");
  assert.ok(!ids.has(dismissed), "dismissed leaked into results");
});

test("cold start returns results from preference + popularity", () => {
  const catalog = buildCatalog();
  const results = recommend({
    candidates: catalog,
    owned: [],
    preferredGenres: ["Puzzle"],
    weights: BALANCED,
    now: NOW,
    topK: 10,
  });
  assert.equal(results.length, 10, "cold start must not be empty");
  for (const r of results) {
    assert.equal(r.breakdown.content, 0, "no taste vector ⇒ content term is 0");
  }
});

test("MMR with lambda < 1 is more genre-diverse than lambda = 1", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const genreOf = new Map(catalog.map((g) => [g.appId, g.genres[0]]));
  const distinctGenres = (lambda: number) => {
    const res = recommend({
      candidates: catalog,
      owned: user.owned,
      ownedFeatures: user.ownedFeatures,
      weights: CONTENT_ONLY,
      mmrLambda: lambda,
      now: NOW,
      topK: 10,
    });
    return new Set(res.map((r) => genreOf.get(r.appId))).size;
  };
  assert.ok(
    distinctGenres(0.3) > distinctGenres(1),
    "diversity re-ranking should increase distinct genres",
  );
});

test("graph (Dijkstra) term contributes and breakdown still sums to score", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const withGraph: Weights = { ...CONTENT_ONLY, content: 0, graph: 1 };
  const results = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    weights: withGraph,
    mmrLambda: 1,
    now: NOW,
    topK: 10,
  });
  assert.ok(results.length > 0);
  // At least one result has a positive graph contribution (reachable in the graph).
  assert.ok(results.some((r) => r.breakdown.graph > 0), "graph term never fired");
  for (const r of results) {
    const sum =
      r.breakdown.content +
      r.breakdown.preference +
      r.breakdown.popularity +
      r.breakdown.recency +
      r.breakdown.collab +
      r.breakdown.graph;
    assert.ok(Math.abs(sum - r.score) < 1e-9);
  }
});

test("graph similarity ranks same-genre games near the user's taste", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog); // plays Action games
  const relevant = new Set(user.relevantAppIds); // held-out Action games
  const results = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    weights: { ...CONTENT_ONLY, content: 0, graph: 1 },
    mmrLambda: 1,
    now: NOW,
    topK: 5,
  });
  const ndcg = ndcgAtK(results.map((r) => r.appId), relevant, 5);
  assert.ok(ndcg > 0, `graph-only NDCG@5 should be > 0, got ${ndcg}`);
});

test("MST diversification yields at least as many genres as pure relevance", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const genreOf = new Map(catalog.map((g) => [g.appId, g.genres[0]]));
  const distinct = (results: { appId: number }[]) =>
    new Set(results.map((r) => genreOf.get(r.appId))).size;

  const relevanceOnly = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    weights: CONTENT_ONLY,
    mmrLambda: 1,
    now: NOW,
    topK: 10,
  });
  const mst = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    weights: CONTENT_ONLY,
    diversify: "mst",
    now: NOW,
    topK: 10,
  });
  assert.equal(mst.length, 10);
  assert.ok(
    distinct(mst) >= distinct(relevanceOnly),
    `MST diversity (${distinct(mst)}) should be >= relevance-only (${distinct(relevanceOnly)})`,
  );
});

test("content ranking beats popularity baseline on NDCG@10", () => {
  const catalog = buildCatalog();
  const user = actionLover(catalog);
  const relevant = new Set(user.relevantAppIds);

  // Content ranking: pure relevance (mmrLambda=1) so MMR doesn't reorder.
  const content = recommend({
    candidates: catalog,
    owned: user.owned,
    ownedFeatures: user.ownedFeatures,
    weights: CONTENT_ONLY,
    mmrLambda: 1,
    now: NOW,
    topK: 10,
  });
  const contentNdcg = ndcgAtK(content.map((r) => r.appId), relevant, 10);

  // Popularity baseline: sort non-owned candidates by total reviews.
  const ownedIds = new Set(user.owned.map((o) => o.appId));
  const popRanked = catalog
    .filter((g) => !ownedIds.has(g.appId))
    .sort((a, b) => b.totalReviews - a.totalReviews)
    .map((g) => g.appId);
  const popNdcg = ndcgAtK(popRanked, relevant, 10);

  assert.ok(
    contentNdcg > popNdcg,
    `content NDCG@10 (${contentNdcg.toFixed(3)}) should beat popularity (${popNdcg.toFixed(3)})`,
  );
});
