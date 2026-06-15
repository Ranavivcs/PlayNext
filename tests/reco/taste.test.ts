import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdf } from "../../lib/reco/vectorize.ts";
import { analyzeTasteDiversity } from "../../lib/reco/recommend.ts";
import type { GameFeatures } from "../../lib/reco/types.ts";

function game(appId: number, tags: string[]): GameFeatures {
  return {
    appId,
    name: `G${appId}`,
    genres: [],
    tags,
    totalReviews: 100,
    positiveRatio: 0.8,
    releaseDate: "2024-01-01",
  };
}

test("focused library (one coherent group) → single centroid", () => {
  const owned = [
    game(1, ["Shooter", "FPS", "Arena"]),
    game(2, ["Shooter", "FPS", "Arena"]),
    game(3, ["Shooter", "FPS", "Combat"]),
    game(4, ["Shooter", "FPS", "Combat"]),
  ];
  const d = analyzeTasteDiversity(owned, buildIdf(owned));
  assert.equal(d.mode, "single");
  assert.equal(d.multiGameClusters, 1);
});

test("diverse library (two distinct groups) → clustered", () => {
  const owned = [
    game(1, ["Shooter", "FPS", "Arena"]),
    game(2, ["Shooter", "FPS", "Combat"]),
    game(3, ["Shooter", "FPS", "Arena"]),
    game(11, ["JRPG", "Turnbased", "Story"]),
    game(12, ["JRPG", "Turnbased", "Story"]),
    game(13, ["JRPG", "Anime", "Story"]),
  ];
  const d = analyzeTasteDiversity(owned, buildIdf(owned));
  assert.equal(d.mode, "clustered");
  assert.ok(d.multiGameClusters >= 2, `expected ≥2 multi-game clusters, got ${d.multiGameClusters}`);
});

test("tiny library (<2 games) → single, no clusters", () => {
  const owned = [game(1, ["Shooter"])];
  const d = analyzeTasteDiversity(owned, buildIdf(owned));
  assert.equal(d.mode, "single");
  assert.equal(d.multiGameClusters, 0);
});
