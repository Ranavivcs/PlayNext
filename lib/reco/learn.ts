// Learning-to-rank: learn the linear score weights from feedback. Pure +
// deterministic (no DB/network/LLM; seeded PRNG only).
//
// The engine score is already a linear model over the per-component scores:
//   score = w · [content, graph, preference, popularity, recency]
// so "training the engine" = learning `w` from data where we know which items a
// user engaged with. We use PAIRWISE LOGISTIC ranking (RankNet-style): for every
// (relevant, irrelevant) pair we want w·feat(rel) > w·feat(irrel); the logistic
// loss log(1 + exp(-(w·Δ))) is minimized by gradient descent. Ranking is
// invariant to positive scaling of w, so the result is normalized to sum 1 for
// interpretability.

/** One candidate's component features + binary relevance label (1 = engaged). */
export interface RankItem {
  features: number[];
  label: 0 | 1;
}

/** All candidates shown for one user/query (a ranking group). */
export type RankQuery = RankItem[];

export interface LtrOptions {
  epochs?: number; // passes over the data (default 40)
  learningRate?: number; // SGD step (default 0.3)
  l2?: number; // L2 regularization strength (default 1e-3)
  negPerPos?: number; // negatives sampled per positive per epoch (default 20)
  seed?: number; // PRNG seed (default 1)
  /** Clamp weights ≥ 0 (component scores are similarities → only positive
   *  contributions make sense). Default true. */
  nonNegative?: boolean;
}

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

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Train pairwise-logistic ranking weights over the given queries.
 * Returns a `dim`-length weight vector normalized to sum 1 (or all-zeros if no
 * usable pairs exist). Deterministic for a fixed seed.
 */
export function trainPairwiseLogistic(
  queries: RankQuery[],
  dim: number,
  opts: LtrOptions = {},
): number[] {
  const epochs = opts.epochs ?? 40;
  const lr = opts.learningRate ?? 0.3;
  const l2 = opts.l2 ?? 1e-3;
  const negPerPos = opts.negPerPos ?? 20;
  const nonNegative = opts.nonNegative ?? true;
  const rng = mulberry32(opts.seed ?? 1);

  // Pre-split each query into positives and negatives; keep only usable queries.
  const split = queries
    .map((q) => ({
      pos: q.filter((it) => it.label === 1),
      neg: q.filter((it) => it.label === 0),
    }))
    .filter((s) => s.pos.length > 0 && s.neg.length > 0);

  const w = new Array<number>(dim).fill(0);
  if (split.length === 0) return w;

  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle query order each epoch (Fisher–Yates).
    for (let i = split.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [split[i], split[j]] = [split[j], split[i]];
    }

    for (const { pos, neg } of split) {
      for (const p of pos) {
        for (let s = 0; s < negPerPos; s++) {
          const n = pick(neg);
          // Δ = feat(pos) − feat(neg); want score margin w·Δ > 0.
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += w[d] * (p.features[d] - n.features[d]);
          const g = sigmoid(dot) - 1; // dLoss/d(margin) for log(1+exp(-margin))
          for (let d = 0; d < dim; d++) {
            const delta = p.features[d] - n.features[d];
            w[d] -= lr * (g * delta + l2 * w[d]);
            if (nonNegative && w[d] < 0) w[d] = 0;
          }
        }
      }
    }
  }

  // Normalize to sum 1 (ranking is invariant to positive scaling).
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let d = 0; d < dim; d++) w[d] /= sum;
  return w;
}
