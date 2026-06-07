import { test } from "node:test";
import assert from "node:assert/strict";
import { trainPairwiseLogistic, type RankQuery } from "../../lib/reco/learn.ts";

// Build queries where feature index `signal` perfectly separates relevant from
// irrelevant items, and the other features are pure noise.
function makeQueries(dim: number, signal: number, nQueries: number, seed = 7): RankQuery[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const noisy = (val: number) => {
    const f = Array.from({ length: dim }, () => rnd());
    f[signal] = val;
    return f;
  };
  const queries: RankQuery[] = [];
  for (let q = 0; q < nQueries; q++) {
    const items = [];
    for (let i = 0; i < 3; i++) items.push({ features: noisy(0.9 + rnd() * 0.1), label: 1 as const });
    for (let i = 0; i < 10; i++) items.push({ features: noisy(rnd() * 0.1), label: 0 as const });
    queries.push(items);
  }
  return queries;
}

test("learns to concentrate weight on the predictive feature", () => {
  const dim = 5;
  const signal = 2;
  const w = trainPairwiseLogistic(makeQueries(dim, signal, 30), dim, { seed: 1 });
  // The signal feature should dominate the normalized weights.
  assert.ok(w[signal] > 0.6, `expected dominant weight on feature ${signal}, got ${JSON.stringify(w)}`);
  for (let d = 0; d < dim; d++) {
    if (d !== signal) assert.ok(w[d] < w[signal], `feature ${d} should be below the signal`);
  }
});

test("weights are non-negative and normalized to sum 1", () => {
  const dim = 5;
  const w = trainPairwiseLogistic(makeQueries(dim, 0, 20), dim, { seed: 2 });
  for (const x of w) assert.ok(x >= 0, "weights must be non-negative");
  const sum = w.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights should sum to 1, got ${sum}`);
});

test("returns all-zeros when there are no usable pairs", () => {
  const dim = 3;
  // Queries with only positives (no negatives) → no pairs.
  const queries: RankQuery[] = [[{ features: [1, 2, 3], label: 1 }]];
  const w = trainPairwiseLogistic(queries, dim, {});
  assert.deepEqual(w, [0, 0, 0]);
});
