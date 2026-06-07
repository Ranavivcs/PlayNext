# PlayNext — Algorithm & Evaluation Writeup

**A Steam game recommendation engine: a real ranking algorithm, with an AI layer that only explains.**

This document is the algorithmic core of the PlayNext final project. It (1) maps the classic
computer-science algorithms we implemented to where they live in the code, (2) describes the
recommendation pipeline, and (3) presents an honest offline evaluation — including the results that
did *not* go our way, because the negative results are part of the science.

The guiding architectural rule: **the algorithm ranks; the AI explains, and never ranks.** The pure
engine (`lib/reco/`) imports no database, network, or LLM code. The AI layer (`lib/ai/`) consumes the
ranked output and produces natural-language justifications grounded only in the facts it is handed.

---

## 1. Problem & approach

A user has a Steam library: a set of owned games and how long they have played each (implicit
feedback). From a catalog of **2,533 enriched games** (genres, community tags, review counts, release
dates), rank the games the user does not own by how likely they are to enjoy them — and show *why*.

We use **content-based ranking** (item features + the user's taste), deliberately *not* leading with
collaborative filtering, which needs a large multi-user base we do not have. The score is a
transparent linear combination of interpretable terms, so every recommendation comes with a
breakdown that sums exactly to its score.

---

## 2. The classic algorithms (the CS core)

| Algorithm | Where | Role |
|---|---|---|
| **TF-IDF + cosine similarity** | `lib/reco/vectorize.ts` | Represent games as feature vectors; measure taste similarity |
| **Binary min-heap (priority queue)** | `lib/reco/heap.ts` | Backs Dijkstra |
| **Dijkstra's shortest path (multi-source)** | `lib/reco/graph.ts` | Transitive "graph similarity" from owned games to candidates |
| **k-nearest-neighbour graph** | `lib/reco/graph.ts` | Builds the game-similarity graph the above run on |
| **Kruskal's MST + union-find (DSU)** | `lib/reco/graph.ts` | Single-linkage clustering → diversity & multi-centroid taste |
| **MMR (maximal marginal relevance)** | `lib/reco/mmr.ts` | Diversity re-ranking |
| **Pairwise-logistic learning-to-rank** | `lib/reco/learn.ts` | Learn the score weights from feedback |

### 2.1 TF-IDF feature vectors & cosine similarity
Each game becomes a sparse vector over namespaced terms (`g:<genre>`, `t:<tag>`). Term weights use
smoothed inverse document frequency over the catalog,

```
idf(t) = ln((1 + N) / (1 + df(t))) + 1
```

so rare, discriminative tags (e.g. *Souls-like*) count for more than ubiquitous ones (e.g.
*Singleplayer*). Vectors are L2-normalized; similarity is the standard cosine. (`buildIdf`,
`gameVector`, `cosine`.)

### 2.2 Taste vector (implicit feedback)
The user's taste is a **playtime-weighted centroid** of their owned-game vectors, with
weight `= log(1 + minutes)` — heavily played games dominate, but lightly played ones still count, and
the diminishing returns of `log` stop a single 1,700-hour game from drowning everything else
(`tasteVector`). This is the implicit-feedback signal: *time played* is a stronger, more honest
preference signal than any star rating the user never gave.

### 2.3 The game-similarity graph + Dijkstra
We build a **k-nearest-neighbour graph** over game vectors: each game links to its `k` most-similar
games, with edge weight `= 1 − cosine` (a *distance*: similar games are close). Edges are
symmetrised (`buildSimilarityGraph`).

We then run **multi-source Dijkstra** from all of the user's owned games at once (each a source at
distance 0), using a **binary min-heap** with lazy deletion as the priority queue. The shortest-path
distance to each candidate becomes a "graph similarity" score, `graphScore(d) = exp(−d)`. This
captures *transitive* taste: "you like A, A is similar to B, B is similar to C ⇒ C is worth a look,"
even when C shares no tags directly with anything you own.

Complexity: the kNN build is O(n²) in similarity computations, so it is capped at the top
`GRAPH_MAX_NODES = 800` candidates by base score (the final top-K always comes from that head).
Dijkstra itself is O(E log V) with the heap.

### 2.4 Kruskal's MST, union-find, and single-linkage clustering
We compute a **minimum spanning tree** of the similarity graph with **Kruskal's algorithm**: sort
edges ascending by weight, add an edge iff its endpoints are not already connected. Connectivity is
tracked with a **disjoint-set (union-find)** structure using *path compression* + *union by rank*
(`DSU`, `kruskalMST`). Cutting the heaviest MST edges yields **single-linkage clusters**
(`mstClusters`) — used two ways:

- **Diversity:** spread the final list across clusters so the user does not get ten near-identical
  games.
- **Multi-centroid taste** (see §3.2): cluster the *user's own* games so a diverse library is not
  averaged into a single muddy centroid.

### 2.5 Learning-to-rank
Because the score is linear in its component terms, "training the engine" reduces to *learning the
weights*. `trainPairwiseLogistic` (`lib/reco/learn.ts`) is a **RankNet-style pairwise-logistic**
learner: for each (relevant, irrelevant) pair it pushes `w·feat(rel) > w·feat(irrel)` by minimizing
`log(1 + exp(−(w·Δ)))` with stochastic gradient descent, L2 regularization, and a non-negativity
clamp (component scores are similarities; only positive contributions make sense). Weights are
normalized to sum 1 (ranking is invariant to positive scaling).

---

## 3. The ranking pipeline (`recommend()`)

The orchestrator runs in three phases (`lib/reco/recommend.ts`):

1. **Cheap per-candidate scoring** (no O(n²) work): for every candidate compute
   `content`, `preference`, `popularity`, `recency`.
2. **Graph phase** (only if needed): build the similarity graph over the top-800 head, run
   multi-source Dijkstra for the graph term, and Kruskal-MST for clustering.
3. **Assemble & diversify:** fold the graph term in, sort by score, then re-rank a shortlist for
   diversity (MMR or MST single-linkage) and take the top-K.

The final score is a weighted sum whose breakdown sums *exactly* to the score:

```
score = w_content·content + w_graph·graph + w_pref·preference
      + w_pop·popularity + w_recency·recency   (+ w_collab·0, CF deferred)
```

### 3.1 The component terms (`lib/reco/score.ts`)
- **content** = cosine(taste, game) — the core personalization signal.
- **graph** = `exp(−dijkstraDistance)` — transitive similarity.
- **preference** = fraction of the user's explicitly chosen genres/tags the game matches.
- **popularity** = a *damped*, *quality-gated* function of review count (log-scaled, gated by the
  positive-review ratio) — popularity is deliberately never allowed to dominate.
- **recency** = exponential decay on release date (≈2-year half-life).

### 3.2 Multi-centroid taste (an evaluation-driven upgrade)
The default taste is a single centroid. Evaluation (§5) showed this fails on *diverse* libraries: a
user who plays basketball sims **and** roguelikes **and** shooters averages into a centroid that
points at nothing. The `tasteMode: "clustered"` option clusters the user's owned games (reusing the
MST/union-find machinery) and scores a candidate by its **nearest cluster**, not the blurry average
(`buildTasteCentroids`). It is kept behind a flag — see the honest trade-off in §5.

---

## 4. Evaluation methodology

Measuring a recommender without thousands of users is hard, so we use the user's *own* engagement as
ground truth via **leave-one-out (LOO)**: hide a game the user actually plays, rank the catalog from
the rest, and see where the hidden game lands. A good engine ranks it high.

Metrics (all in `lib/reco/metrics.ts`, binary relevance): **NDCG@10**, **Recall@10**, **MRR**, **MAP**.

We evaluate on two populations, for two different reasons:

- **Real user (`scripts/eval-reco.ts`)** — the honest anchor. One user (Steam "Ran", 15
  played+enriched games), LOO over each.
- **Synthetic users (`scripts/eval-synth.ts`)** — for statistical power and to remove the single
  user's biases. Each synthetic user is defined by **one community tag** (e.g. *RTS*, *CRPG*,
  *Survival Horror*), owns a sample of games carrying it, and we hold out a few.
  - **Circularity guard:** users are grouped by a single human-meaningful tag — independent of the
    engine's composite score. The engine must still rank correctly among all 2,533 candidates using
    its *full* TF-IDF+graph machinery (the whole tag/genre vocabulary), and the popularity baseline
    sees the same candidates without taste. So it is a fair head-to-head, not the engine grading its
    own output. Because users are defined by *theme*, not popularity, the targets are not
    systematically popular — which neutralizes the real-user popularity bias (below).

---

## 5. Results

### 5.1 Headline: content beats popularity ~85× (synthetic, 168 users, 28 themes)

```
Config                     NDCG@10  Recall@10    MRR    MAP
Random (floor)               0.001      0.003  0.008  0.004
Popularity-only              0.002      0.004  0.005  0.001
Recency-only                 0.001      0.001  0.009  0.003
Content-only [single]        0.172      0.238  0.234  0.132   ← best
Content+Graph [single]       0.135      0.173  0.213  0.107
Content-only [clustered]     0.160      0.220  0.224  0.124
Content+Graph [clustered]    0.134      0.171  0.209  0.105
Balanced [clustered]         0.134      0.167  0.218  0.110
```

The content-based engine scores **NDCG@10 0.172 vs popularity 0.002** — roughly **85× better**.
Popularity-only and recency-only are statistically indistinguishable from random for *personalized*
recommendation. This is the project's central claim, demonstrated quantitatively on a de-biased,
multi-user evaluation.

### 5.2 The real-user anchor, and the limits of single-user offline evaluation

On the one real user, LOO told a subtler story:

```
Config                       NDCG@10  Recall@10    MRR
Popularity-only                0.090      0.133  0.093
Content+Graph [single]         0.029      0.067  0.027
Content+Graph [clustered]      0.045      0.133  0.026
```

Here popularity *appears* to win — but this is a known **offline-evaluation artifact**, not evidence
that popularity is better:

1. **Popularity bias in the answer key.** Ran's played games (CS2, Dota, Apex, Hades) are themselves
   massively popular, so "recommend popular games" scores well on Ran's *own* library.
2. **The genre-orphan ceiling.** 12 of Ran's 15 games are the *only* game of their kind in the
   library. Hide the lone roguelike and there is nothing similar left to anchor it — *no* content
   method can recover a taste with one example.

The recoverable case proves the engine works: with three NBA 2K games owned, holding one out ranks it
at **#5 / #10 / #12 out of 2,533** (top 0.5%). And **multi-centroid taste doubled Recall@10**
(0.067 → 0.133) on this diverse library by un-blurring the averaged centroid.

### 5.3 What the graph and clustering actually buy (honest ablation)

The Dijkstra graph term and MST clustering are **diversity/discovery mechanisms, not universal wins**:

- On *diverse* libraries (real Ran) clustering helps (recall doubled).
- On *focused* tastes (synthetic, one tag) they slightly *hurt* — the single centroid is already
  sharp, so clustering fragments it and the graph drags in off-taste neighbours.

So the optimal configuration is **taste-dependent**. This is why `tasteMode: "single"` remains the
live default (it wins where we have statistical power) while clustered stays available for the
diverse case.

### 5.4 Learning-to-rank: what the machine learned

`scripts/train-ltr.ts` extracts the raw component scores per candidate (one engine pass per user),
splits users 70/30, learns weights on train, and evaluates on unseen test users.

On a **coherent** population the learner converged to:

```
content 0.853 · graph 0.143 · preference 0.000 · popularity 0.004 · recency 0.000
```

**The machine independently discovered the thesis:** weight content highest, popularity ≈ zero — the
opposite of a popularity-led mix. On a **mixed** coherent+diverse population (with both single- and
clustered-content features) it learned a sensible blend
(`content_single 0.41 · content_clustered 0.35 · graph 0.16 · recency 0.08 · popularity 0.00`).

Honest negative result: LTR **did not beat the simple content-only baseline** on these populations
(e.g. mixed test NDCG: Learned 0.121 vs Content-only 0.134). Content similarity is simply a very
strong, robust signal, and where a recoverable signal exists, content already captures it. LTR's
value is (a) *confirming* the weighting from data rather than by hand, and (b) a foundation for
*per-user adaptive* weighting — its real payoff needs a genuinely heterogeneous population where no
single weight is optimal.

### 5.5 Shipped improvement
Every experiment agrees the optimum is content-dominant with popularity ≈ 0. The live default weights
were re-tuned accordingly (Balanced: content .4→.5, popularity .15→.05, recency .1→.05), keeping
small popularity/recency only as quality-signal and discovery tie-breakers.

---

## 6. The AI layer (and why it never ranks)
After ranking, `lib/ai/explain.ts` asks an LLM for a one-line "why this matches you," grounded
strictly in the passed facts (the game's genres/tags/reviews, the user's taste summary, and *which
score term drove the rank*). It cannot invent game details, and it cannot change the order. This
separation — `lib/reco` never imports `lib/ai` — is the architectural backbone: a real, explainable
algorithm makes the decision; the AI only translates the decision into English.

---

## 7. Limitations & future work
- **Single real user.** Robust aggregate numbers need more real libraries; synthetic users bridge the
  gap but are idealized.
- **Genre orphans are unrecoverable** by any content method — a fundamental limit, not a bug.
- **Per-user adaptive weighting** (choose single vs clustered, content vs graph, by the user's taste
  diversity) is the natural next algorithmic step, now motivated by evidence.
- **Collaborative filtering** stays a stretch (needs many users).
- **Semantic RAG chat** (embeddings + pgvector) would extend the *explanation* layer — strictly
  scoped to discuss the recs the algorithm already chose, never to rank.

---

## 8. Reproducibility
```
# Unit tests (TF-IDF, graph, heap, MST, metrics, learner): 24/24
node --test "tests/reco/**/*.test.ts"

# Real-user leave-one-out evaluation
node --env-file=.env.local scripts/eval-reco.ts

# Synthetic de-biased evaluation (the beats-popularity result)
node --env-file=.env.local scripts/eval-synth.ts

# Learning-to-rank training + held-out evaluation
node --env-file=.env.local scripts/train-ltr.ts
```
All evaluation is read-only; the engine in `lib/reco/` is pure and deterministic.
