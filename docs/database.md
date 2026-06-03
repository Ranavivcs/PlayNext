# Database

- Schema = migrations only. Add new numbered file in `supabase/migrations/`; never edit an applied one.
- Current schema: `0001_initial_schema.sql`. Read it before assuming a table exists.
- `public` schema, snake_case, `timestamptz default now()`. Playtime in **minutes**. `positive_ratio` is 0..1.
- Per-user tables: RLS on, owner-only (`auth.uid() = user_id`). Add policy in the same migration.
- Catalog tables (`games`, `game_genres`, `game_tags`, `game_embeddings`): public-read; writes via service role only. Never disable RLS.
- One embedding per game (`game_embeddings`) serves both reco similarity and RAG. HNSW cosine index; query with `<=>`. Dimension locked in Phase 4.
