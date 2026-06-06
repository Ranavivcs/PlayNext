import { test } from "node:test";
import assert from "node:assert/strict";

import { MinHeap } from "../../lib/reco/heap.ts";
import {
  buildSimilarityGraph,
  dijkstra,
  kruskalMST,
  mstClusters,
  DSU,
  type SimGraph,
  type SimEdge,
} from "../../lib/reco/graph.ts";
import { buildIdf } from "../../lib/reco/vectorize.ts";
import { buildCatalog } from "./fixtures.ts";

/** Build a SimGraph from an undirected weighted edge list (for algorithm tests). */
function makeGraph(n: number, edges: [number, number, number][]): SimGraph {
  const adj: { to: number; weight: number }[][] = Array.from({ length: n }, () => []);
  const edgeList: SimEdge[] = edges.map(([a, b, weight]) => ({
    a: Math.min(a, b),
    b: Math.max(a, b),
    weight,
  }));
  for (const { a, b, weight } of edgeList) {
    adj[a].push({ to: b, weight });
    adj[b].push({ to: a, weight });
  }
  const appIds = Array.from({ length: n }, (_, i) => i);
  const indexByApp = new Map(appIds.map((id, i) => [id, i] as const));
  return { n, appIds, indexByApp, adj, edges: edgeList };
}

// 0-1:1, 1-2:2, 0-2:4, 2-3:1, 3-4:3
const EDGES: [number, number, number][] = [
  [0, 1, 1],
  [1, 2, 2],
  [0, 2, 4],
  [2, 3, 1],
  [3, 4, 3],
];

test("MinHeap pops in ascending key order", () => {
  const h = new MinHeap<string>();
  const data: [number, string][] = [
    [5, "e"],
    [1, "a"],
    [4, "d"],
    [2, "b"],
    [3, "c"],
  ];
  for (const [k, v] of data) h.push(k, v);
  const out: string[] = [];
  while (!h.isEmpty()) out.push(h.pop()!.value);
  assert.deepEqual(out, ["a", "b", "c", "d", "e"]);
});

test("Dijkstra computes correct single-source shortest paths", () => {
  const g = makeGraph(5, EDGES);
  const dist = dijkstra(g, new Map([[0, 0]]));
  // 0; 0-1=1; 0-1-2=3 (< direct 4); 0-1-2-3=4; +3 = 7
  assert.deepEqual([...dist], [0, 1, 3, 4, 7]);
});

test("Dijkstra multi-source takes the nearest source", () => {
  const g = makeGraph(5, EDGES);
  const dist = dijkstra(g, new Map([[0, 0], [4, 0]]));
  // node 3 is 1 hop from 4 (w3) vs 4 from 0 → 3; node 2 is min(3 via 0, 4 via 4) = 3
  assert.equal(dist[3], 3);
  assert.equal(dist[2], 3);
  assert.equal(dist[4], 0);
});

test("DSU union/find tracks components", () => {
  const d = new DSU(4);
  assert.equal(d.components, 4);
  assert.equal(d.union(0, 1), true);
  assert.equal(d.union(1, 0), false); // already joined
  assert.equal(d.components, 3);
  d.union(2, 3);
  assert.equal(d.find(0), d.find(1));
  assert.notEqual(d.find(0), d.find(2));
});

test("Kruskal builds the MST, excluding the cycle edge", () => {
  const g = makeGraph(5, EDGES);
  const mst = kruskalMST(g);
  assert.equal(mst.length, 4); // n-1 for a connected graph
  const total = mst.reduce((s, e) => s + e.weight, 0);
  assert.equal(total, 1 + 1 + 2 + 3); // = 7
  // The heavy 0-2 (weight 4) closes a cycle and must be excluded.
  const has02 = mst.some((e) => e.a === 0 && e.b === 2);
  assert.equal(has02, false);
});

test("MST single-linkage clustering cuts the heaviest edges", () => {
  const g = makeGraph(5, EDGES);
  const mst = kruskalMST(g);

  const two = mstClusters(mst, 5, 2);
  // Cutting the heaviest edge (3-4, w3) isolates node 4.
  assert.equal(two[0], two[1]);
  assert.equal(two[1], two[2]);
  assert.equal(two[2], two[3]);
  assert.notEqual(two[4], two[0]);

  const three = mstClusters(mst, 5, 3);
  // Cut the two heaviest (3-4 w3, 1-2 w2) → {0,1} {2,3} {4}.
  assert.equal(three[0], three[1]);
  assert.equal(three[2], three[3]);
  assert.notEqual(three[0], three[2]);
  assert.notEqual(three[4], three[0]);
  assert.notEqual(three[4], three[2]);
});

test("buildSimilarityGraph links same-genre games and is well-formed", () => {
  const catalog = buildCatalog();
  const idf = buildIdf(catalog);
  const g = buildSimilarityGraph(catalog, idf, 6);

  assert.equal(g.n, catalog.length);
  // Edges are deduped (a < b) and weights are valid distances in (0, 1].
  for (const e of g.edges) {
    assert.ok(e.a < e.b);
    assert.ok(e.weight > 0 && e.weight <= 1, `weight ${e.weight}`);
  }

  // The nearest neighbour (lightest edge) of an Action game shares its genre.
  const actionIdx = catalog.findIndex((c) => c.genres.includes("Action"));
  const neighbours = g.adj[actionIdx];
  assert.ok(neighbours.length > 0);
  const nearest = neighbours.reduce((a, b) => (b.weight < a.weight ? b : a));
  assert.ok(catalog[nearest.to].genres.includes("Action"));
});
