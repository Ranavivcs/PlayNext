-- ----------------------------------------------------------------------------
-- Graded review score (1–10) on tried games. Replaces the binary like/dislike
-- for NEW reviews; the legacy `rating` column is kept for backward-compat (old
-- rows keep their like/dislike, mapped to a score at read time).
--
-- How it feeds the engine (lib/reco stays pure — this only shapes its INPUTS):
--   score >= 6  -> the game is folded into the taste vector as a positive
--                  example, with synthetic playtime that grows with the score
--                  (higher score pulls taste harder, via log(1+minutes)).
--   score <= 5  -> no taste boost.
--   any score   -> the game stays excluded from results (the user has played it).
-- The engine has no negative-taste vector, so a low score means "don't learn
-- positively from this", not "recommend the opposite".
-- ----------------------------------------------------------------------------
alter table public.user_tried_games
  add column if not exists score smallint
    check (score is null or (score between 1 and 10));
