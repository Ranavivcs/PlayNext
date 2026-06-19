import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdf } from "../../lib/reco/vectorize.ts";
import { analyzeTasteDiversity } from "../../lib/reco/recommend.ts";
import { ADAPTIVE_WEIGHTS } from "../../lib/reco-data/user.ts";
import { presetFromStored } from "../../app/dashboard/preferences-options.ts";
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

test("adaptive profiles: diverse leans graph, focused leans content, both popularity≈0", () => {
  assert.ok(ADAPTIVE_WEIGHTS.clustered.graph > ADAPTIVE_WEIGHTS.single.graph);
  assert.ok(ADAPTIVE_WEIGHTS.single.content > ADAPTIVE_WEIGHTS.clustered.content);
  assert.ok(ADAPTIVE_WEIGHTS.single.popularity <= 0.05);
  assert.ok(ADAPTIVE_WEIGHTS.clustered.popularity <= 0.05);
});

test("adaptive picks the focused profile for a coherent library", () => {
  const owned = [
    game(1, ["Shooter", "FPS", "Arena"]),
    game(2, ["Shooter", "FPS", "Arena"]),
    game(3, ["Shooter", "FPS", "Combat"]),
    game(4, ["Shooter", "FPS", "Combat"]),
  ];
  const mode = analyzeTasteDiversity(owned, buildIdf(owned)).mode;
  assert.equal(mode, "single");
  assert.equal(ADAPTIVE_WEIGHTS[mode], ADAPTIVE_WEIGHTS.single);
});

test("adaptive picks the diverse profile for a multi-style library", () => {
  const owned = [
    game(1, ["Shooter", "FPS", "Arena"]),
    game(2, ["Shooter", "FPS", "Combat"]),
    game(3, ["Shooter", "FPS", "Arena"]),
    game(11, ["JRPG", "Turnbased", "Story"]),
    game(12, ["JRPG", "Turnbased", "Story"]),
    game(13, ["JRPG", "Anime", "Story"]),
  ];
  const mode = analyzeTasteDiversity(owned, buildIdf(owned)).mode;
  assert.equal(mode, "clustered");
  assert.equal(ADAPTIVE_WEIGHTS[mode], ADAPTIVE_WEIGHTS.clustered);
});

test("presetFromStored: adaptive is the default and is sentinel-aware", () => {
  assert.equal(presetFromStored(null), "adaptive"); // no row → adaptive (new default)
  assert.equal(presetFromStored(undefined), "adaptive");
  assert.equal(presetFromStored({ adaptive: true, collab: 0.1 }), "adaptive");
  // A stored numeric set pre-selects its closest named preset, never "adaptive".
  assert.equal(
    presetFromStored({ content: 0.5, graph: 0.25, preference: 0.2, popularity: 0.05, recency: 0.05 }),
    "balanced",
  );
});
