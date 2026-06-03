-- ============================================================================
-- PlayNext — metadata enrichment additions (Phase 3, Step C)
-- Adds PC platform flags and Steam store categories used for hard filters
-- (platform / multiplayer / co-op). These are FILTER fields applied during
-- candidate generation; they are deliberately NOT part of GameFeatures so the
-- pure lib/reco scoring core stays unchanged. Catalog tables: public read,
-- service-role writes (no write policy, matching games/game_genres/game_tags).
-- ============================================================================

-- PC platform availability (Steam appdetails.platforms). Steam-only scope ⇒
-- these three booleans are sufficient; consoles deferred.
alter table public.games
  add column platform_windows boolean not null default false,
  add column platform_mac     boolean not null default false,
  add column platform_linux   boolean not null default false,
  -- Set when full metadata (genres/tags/categories/reviews) has been fetched.
  -- Distinguishes a thin ingest row (name only) from an enriched one, so the
  -- enrichment job can skip rows that are already fresh.
  add column enriched_at      timestamptz;

-- Steam store "categories" — e.g. Single-player, Multi-player, Co-op,
-- Online Co-op, Shared/Split Screen, Cross-Platform Multiplayer. Distinct from
-- community tags (game_tags) and genres (game_genres). Powers the multiplayer /
-- co-op / "play with friend" filters.
create table public.game_categories (
  app_id   integer not null references public.games (app_id) on delete cascade,
  category text not null,
  primary key (app_id, category)
);

create index game_categories_category_idx on public.game_categories (category);

alter table public.game_categories enable row level security;
create policy "categories readable" on public.game_categories for select using (true);
