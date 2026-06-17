import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdf } from "../../lib/reco/vectorize.ts";
import { analyzeTasteDiversity, describeStyles } from "../../lib/reco/recommend.ts";
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
  // Both styles are named; the generic "Anime" tag is excluded from labels.
  assert.ok(d.labels.includes("JRPG"), `expected a JRPG label, got ${d.labels.join(",")}`);
  assert.ok(
    d.labels.some((l) => ["FPS", "Shooter"].includes(l)),
    `expected a shooter label, got ${d.labels.join(",")}`,
  );
  assert.ok(!d.labels.includes("Anime"), "generic 'Anime' tag should not be a label");
});

test("tiny library (<2 games) → single, no clusters", () => {
  const owned = [game(1, ["Shooter"])];
  const d = analyzeTasteDiversity(owned, buildIdf(owned));
  assert.equal(d.mode, "single");
  assert.equal(d.multiGameClusters, 0);
  // One game has no RECURRING style (count ≥ 2), so there's nothing to name.
  assert.deepEqual(d.labels, []);
});

test("describeStyles: distinctive recurring style beats common one; drops one-offs + generic", () => {
  // A common non-generic tag ("RPG", low idf) vs a rare one ("Roguelike", high idf).
  const filler: GameFeatures[] = Array.from({ length: 30 }, (_, i) => game(1000 + i, ["RPG"]));
  const owned = [
    game(1, ["RPG", "Roguelike"]),
    game(2, ["RPG", "Roguelike"]),
    game(3, ["RPG", "Roguelike"]),
    game(4, ["RPG", "Multiplayer"]), // Multiplayer = generic → dropped
    game(5, ["RPG", "Multiplayer"]),
    game(6, ["RPG", "Cooking"]), // count 1 → dropped (must recur)
  ];
  const idf = buildIdf([...filler, ...owned]);
  // Roguelike (×3, rare) outranks RPG (×6, common); Multiplayer/Cooking excluded.
  assert.deepEqual(describeStyles(owned, idf), ["Roguelike", "RPG"]);
});
