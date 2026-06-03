# Recommendation Engine (`lib/reco/`)

Scope: content-based now, CF deferred. TypeScript only. ANN via pgvector. Latency SLAs / Redis / A/B = stretch, not blockers.

## Pipeline
1. Steam playtime = implicit feedback (more playtime = stronger positive).
2. Game vector from tags/genres (TF-IDF, rare tags weigh more) + semantic embedding.
3. Taste vector = playtime-weighted centroid of owned games, `weight = log(1 + minutes)`.
4. Score: `w_content·cosine + w_pref·prefMatch + w_pop·popNorm + w_recency·trend + w_collab·collab`. Weights from `user_preferences.weights`; `w_collab=0` until CF ships.
5. Cold start: no games → preferences + popularity. Never return empty.
6. Two-stage: pgvector candidates → full re-score shortlist.
7. Post-process: drop owned + dismissed; MMR diversity `λ·Score − (1−λ)·maxSim`.
8. Save run to `recommendations`/`recommendation_items` with `score_breakdown`.

## Rules
- Pure module (no DB/network/LLM/unseeded random).
- Evaluate with temporal splits; report NDCG/MAP/MRR + precision/recall@K.
- Measure & damp popularity bias — popularity is never the dominant term.

Check: beats popularity baseline on NDCG@10; `score_breakdown` sums to `score`; unit-tested with fixtures.
