-- Game-length soft preference (Phase 3 follow-up).
-- median_playtime = SteamSpy median_forever (minutes): the median total playtime
-- across owners, used as a proxy for game length / time investment. Nullable —
-- unknown for games SteamSpy has no playtime data for.
alter table public.games
  add column if not exists median_playtime integer;

-- A user's preferred game length. Soft preference (folded into the engine's
-- preference score), single value or null = "Any".
alter table public.user_preferences
  add column if not exists preferred_length text
  check (preferred_length is null or preferred_length in ('short', 'medium', 'long'));
