-- ============================================================================
-- PlayNext — initial schema
-- Postgres + pgvector. Run against your Supabase project.
-- ============================================================================

create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- User profile (extends Supabase auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Linked Steam account
-- ----------------------------------------------------------------------------
create table public.steam_accounts (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  steam_id       text not null unique,
  persona_name   text,
  avatar_url     text,
  profile_public boolean not null default false,
  linked_at      timestamptz not null default now(),
  last_synced_at timestamptz
);

-- ----------------------------------------------------------------------------
-- Game catalog (cached Steam metadata) — public read, service-role writes
-- ----------------------------------------------------------------------------
create table public.games (
  app_id         integer primary key,
  name           text not null,
  short_desc     text,
  header_image   text,
  release_date   date,
  price_cents    integer,
  is_free        boolean not null default false,
  metacritic     integer,
  total_reviews  integer,
  positive_ratio real,            -- 0..1 share of positive reviews
  updated_at     timestamptz not null default now()
);

create table public.game_genres (
  app_id integer not null references public.games (app_id) on delete cascade,
  genre  text not null,
  primary key (app_id, genre)
);

create table public.game_tags (
  app_id integer not null references public.games (app_id) on delete cascade,
  tag    text not null,
  votes  integer not null default 0,   -- community weight for the tag
  primary key (app_id, tag)
);

-- Semantic embedding per game. Powers BOTH content-based cosine similarity
-- and RAG retrieval. Dimension is a placeholder — finalized in Phase 4 once
-- the embedding model is chosen.
create table public.game_embeddings (
  app_id    integer primary key references public.games (app_id) on delete cascade,
  embedding vector(1536),
  model     text,
  updated_at timestamptz not null default now()
);

create index game_embeddings_hnsw
  on public.game_embeddings
  using hnsw (embedding vector_cosine_ops);

create index game_genres_genre_idx on public.game_genres (genre);
create index game_tags_tag_idx on public.game_tags (tag);

-- ----------------------------------------------------------------------------
-- Per-user owned games / playtime (cached from Steam)
-- ----------------------------------------------------------------------------
create table public.user_games (
  user_id          uuid not null references auth.users (id) on delete cascade,
  app_id           integer not null references public.games (app_id) on delete cascade,
  playtime_forever integer not null default 0,  -- minutes
  playtime_2weeks  integer not null default 0,  -- minutes
  last_played      timestamptz,
  primary key (user_id, app_id)
);

create index user_games_user_idx on public.user_games (user_id);

-- ----------------------------------------------------------------------------
-- Explicit preferences + tunable algorithm weights
-- ----------------------------------------------------------------------------
create table public.user_preferences (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  preferred_genres text[] not null default '{}',
  preferred_tags   text[] not null default '{}',
  mood             text,
  -- weights w1..w5 for the scoring components; jsonb so the UI can tune them
  weights          jsonb not null default
    '{"content":0.4,"preference":0.25,"popularity":0.15,"recency":0.1,"collab":0.1}'::jsonb,
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Recommendation history
-- ----------------------------------------------------------------------------
create table public.recommendations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  params     jsonb,                       -- snapshot of weights/filters used
  created_at timestamptz not null default now()
);

create index recommendations_user_idx on public.recommendations (user_id, created_at desc);

create table public.recommendation_items (
  rec_id          uuid not null references public.recommendations (id) on delete cascade,
  app_id          integer not null references public.games (app_id) on delete cascade,
  rank            integer not null,
  score           real not null,
  score_breakdown jsonb,                  -- per-component contribution for the UI
  ai_explanation  text,
  primary key (rec_id, app_id)
);

-- ----------------------------------------------------------------------------
-- User feedback / interaction signals (also future collaborative-filtering fuel)
-- ----------------------------------------------------------------------------
create table public.user_feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  app_id     integer not null references public.games (app_id) on delete cascade,
  action     text not null,               -- 'clicked' | 'liked' | 'dismissed' | 'hidden'
  created_at timestamptz not null default now()
);

create index user_feedback_user_idx on public.user_feedback (user_id, created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Per-user tables: owner-only access.
alter table public.profiles         enable row level security;
alter table public.steam_accounts   enable row level security;
alter table public.user_games       enable row level security;
alter table public.user_preferences enable row level security;
alter table public.recommendations  enable row level security;
alter table public.recommendation_items enable row level security;
alter table public.user_feedback    enable row level security;

create policy "own profile"        on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own steam account"  on public.steam_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own games"          on public.user_games
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own preferences"    on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recommendations" on public.recommendations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recommendation items" on public.recommendation_items
  for all using (
    exists (
      select 1 from public.recommendations r
      where r.id = recommendation_items.rec_id and r.user_id = auth.uid()
    )
  );

create policy "own feedback"       on public.user_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Catalog tables: readable by everyone, writes only via service role
-- (the service role bypasses RLS, so no write policy is defined).
alter table public.games           enable row level security;
alter table public.game_genres     enable row level security;
alter table public.game_tags       enable row level security;
alter table public.game_embeddings enable row level security;

create policy "catalog readable" on public.games           for select using (true);
create policy "genres readable"  on public.game_genres     for select using (true);
create policy "tags readable"    on public.game_tags       for select using (true);
create policy "embeddings readable" on public.game_embeddings for select using (true);
