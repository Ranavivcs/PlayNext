// Graph algorithms over the game-similarity graph. Pure: deterministic, no
// DB/network/LLM/random. Nodes are games; an edge connects similar games with
// weight = (1 - cosine) = a DISTANCE (closer games = smaller weight).
//
// Provides three classic algorithms (CS-syllabus):
//   - Multi-source Dijkstra (+ a binary heap, heap.ts): shortest-path similarity
//     from the user's owned/seed games to every candidate (transitive taste).
//   - Kruskal MST (sorted edges + union-find): minimum spanning tree.
//   - Single-linkage clustering: cut the heaviest MST edges into K clusters,
//     used for recommendation diversity.

import type { GameFeatures } from "./types.ts";
import { gameVector, cosine, type SparseVector } from "./vectorize.ts";
import { MinHeap } from "./heap.ts";

export interface SimEdge {
  a: number; // node index
  b: number; // node index
  weight: number; // distance in [0, 1]
}

export interface SimGraph {
  n: number;
  /** node index → appId */
  appIds: number[];
  /** appId → node index */
  indexByApp: Map<number, number>;
  /** adjacency list for traversal/Dijkstra */
  adj: { to: number; weight: number }[][];
  /** unique undirected edges (a < b) for MST */
  edges: SimEdge[];
}

const MIN_WEIGHT = 1e-4; // keep edge weights strictly positive for Dijkstra

/**
 * Build a k-nearest-neighbour similarity graph from game feature vectors.
 * Each node links to its `k` most-similar games; edges are made undirected
 * (union of both directions). Edge weight = 1 - cosine, clamped > 0.
 */
export function buildSimilarityGraph(
  features: GameFeatures[],
  idf: Map<string, number>,
  k: number,
): SimGraph {
  const n = features.length;
  const appIds = features.map((f) => f.appId);
  const indexByApp = new Map<number, number>();
  appIds.forEach((id, i) => indexByApp.set(id, i));

  const vectors: SparseVector[] = features.map((f) => gameVector(f, idf));

  // For each node, keep its top-k neighbours by cosine similarity.
  const neighbours: { to: number; weight: number }[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const sims: { j: number; sim: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const sim = cosine(vectors[i], vectors[j]);
      if (sim > 0) sims.push({ j, sim });
    }
    sims.sort((x, y) => y.sim - x.sim);
    for (const { j, sim } of sims.slice(0, k)) {
      neighbours[i].push({ to: j, weight: Math.max(MIN_WEIGHT, 1 - sim) });
    }
  }

  // Symmetrise: an edge exists if either endpoint lists the other. Build the
  // adjacency list (both directions) and a deduped undirected edge list.
  const adj: { to: number; weight: number }[][] = Array.from({ length: n }, () => []);
  const edgeMap = new Map<string, SimEdge>();
  for (let i = 0; i < n; i++) {
    for (const { to, weight } of neighbours[i]) {
      adj[i].push({ to, weight });
      adj[to].push({ to: i, weight });
      const a = Math.min(i, to);
      const b = Math.max(i, to);
      const key = `${a}-${b}`;
      const existing = edgeMap.get(key);
      if (!existing || weight < existing.weight) edgeMap.set(key, { a, b, weight });
    }
  }

  return { n, appIds, indexByApp, adj, edges: [...edgeMap.values()] };
}

/**
 * Multi-source Dijkstra: shortest-path distance from any source node to every
 * node. `sources` maps a node index to its initial distance (0 = a pure source).
 * Uses a binary min-heap with lazy deletion (push duplicates, skip stale pops).
 */
export function dijkstra(graph: SimGraph, sources: Map<number, number>): Float64Array {
  const dist = new Float64Array(graph.n).fill(Infinity);
  const heap = new MinHeap<number>();
  for (const [node, d] of sources) {
    if (d < dist[node]) {
      dist[node] = d;
      heap.push(d, node);
    }
  }

  while (!heap.isEmpty()) {
    const top = heap.pop()!;
    const u = top.value;
    if (top.key > dist[u]) continue; // stale entry
    for (const { to, weight } of graph.adj[u]) {
      const nd = dist[u] + weight;
      if (nd < dist[to]) {
        dist[to] = nd;
        heap.push(nd, to);
      }
    }
  }
  return dist;
}

/** Union-find (disjoint set) with path compression + union by rank. */
export class DSU {
  private parent: number[];
  private rank: number[];
  components: number;

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
    this.components = n;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  /** Returns true if x and y were in different sets (a union happened). */
  union(x: number, y: number): boolean {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;
    if (this.rank[rx] < this.rank[ry]) {
      this.parent[rx] = ry;
    } else if (this.rank[rx] > this.rank[ry]) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]++;
    }
    this.components--;
    return true;
  }
}

/**
 * Kruskal's minimum spanning tree (forest, if the graph is disconnected):
 * sort edges ascending by weight, then union endpoints that aren't yet
 * connected. Returns the chosen edges (≤ n-1), in ascending weight order.
 */
export function kruskalMST(graph: SimGraph): SimEdge[] {
  const sorted = [...graph.edges].sort((a, b) => a.weight - b.weight);
  const dsu = new DSU(graph.n);
  const tree: SimEdge[] = [];
  for (const e of sorted) {
    if (dsu.union(e.a, e.b)) {
      tree.push(e);
      if (tree.length === graph.n - 1) break;
    }
  }
  return tree;
}

/**
 * Threshold single-linkage clustering: build the kNN similarity graph over the
 * given feature vectors, take its MST, and union only edges with distance
 * ≤ `maxDist` (i.e. cosine ≥ 1 − maxDist). Games less similar than that split
 * into separate clusters; orphans become singletons. Returns groups of node
 * indices (into `features`). Used to cluster a user's OWN games — both to build
 * per-cluster taste centroids and to measure taste diversity.
 */
export function clusterByMst(
  features: GameFeatures[],
  idf: Map<string, number>,
  k: number,
  maxDist: number,
): number[][] {
  if (features.length === 0) return [];
  const graph = buildSimilarityGraph(features, idf, Math.min(k, features.length - 1));
  const dsu = new DSU(graph.n);
  for (const e of kruskalMST(graph)) {
    if (e.weight <= maxDist) dsu.union(e.a, e.b);
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < graph.n; i++) {
    const root = dsu.find(i);
    const arr = byRoot.get(root);
    if (arr) arr.push(i);
    else byRoot.set(root, [i]);
  }
  return [...byRoot.values()];
}

/**
 * Single-linkage clustering via the MST: keep the lightest MST edges and drop
 * the heaviest, leaving `numClusters` connected components. Returns a cluster id
 * (0..C-1) per node. Cutting an MST's heaviest edge is exactly single-linkage.
 */
export function mstClusters(
  mstEdges: SimEdge[],
  n: number,
  numClusters: number,
): Int32Array {
  const dsu = new DSU(n);
  const target = Math.max(1, Math.min(numClusters, n));
  // mstEdges are ascending; union the lightest, stopping once we'd drop below
  // `target` components (i.e. leave the heaviest target-1 edges cut).
  const sorted = [...mstEdges].sort((a, b) => a.weight - b.weight);
  for (const e of sorted) {
    if (dsu.components <= target) break;
    dsu.union(e.a, e.b);
  }

  // Normalise roots to dense cluster ids 0..C-1.
  const ids = new Int32Array(n);
  const idByRoot = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = dsu.find(i);
    let id = idByRoot.get(root);
    if (id === undefined) {
      id = idByRoot.size;
      idByRoot.set(root, id);
    }
    ids[i] = id;
  }
  return ids;
}
