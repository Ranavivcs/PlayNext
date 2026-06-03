import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dcgAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  averagePrecision,
  reciprocalRank,
} from "../../lib/reco/metrics.ts";

const relevant = new Set([1, 2, 3]);

test("ndcg is 1 for a perfect ranking and 0 with no relevant items", () => {
  assert.equal(ndcgAtK([1, 2, 3, 4, 5], relevant, 3), 1);
  assert.equal(ndcgAtK([1, 2, 3], new Set<number>(), 3), 0);
});

test("ndcg rewards relevant items ranked higher", () => {
  const good = ndcgAtK([1, 9, 2, 9, 3], relevant, 5);
  const bad = ndcgAtK([9, 9, 1, 2, 3], relevant, 5);
  assert.ok(good > bad);
  assert.ok(good <= 1 && bad >= 0);
});

test("dcg accumulates discounted gains", () => {
  // hits at ranks 1 and 3: 1/log2(2) + 1/log2(4) = 1 + 0.5
  assert.ok(Math.abs(dcgAtK([1, 9, 2], relevant, 3) - 1.5) < 1e-12);
});

test("precision and recall at k", () => {
  assert.equal(precisionAtK([1, 2, 9, 9], relevant, 4), 0.5); // 2 of top 4
  assert.equal(recallAtK([1, 2, 9, 9], relevant, 4), 2 / 3); // 2 of 3 relevant
  assert.equal(recallAtK([1, 2, 3], relevant, 3), 1);
});

test("average precision", () => {
  // hits at ranks 1,2,3 → (1/1 + 2/2 + 3/3)/3 = 1
  assert.equal(averagePrecision([1, 2, 3], relevant), 1);
  // hits at ranks 1,3 only, relevant size 3 → (1/1 + 2/3)/3
  assert.ok(Math.abs(averagePrecision([1, 9, 2], new Set([1, 2])) - (1 + 2 / 3) / 2) < 1e-12);
});

test("reciprocal rank is 1/firstHit and 0 when absent", () => {
  assert.equal(reciprocalRank([9, 9, 1], relevant), 1 / 3);
  assert.equal(reciprocalRank([9, 8, 7], relevant), 0);
});
