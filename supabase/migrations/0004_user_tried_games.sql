-- ----------------------------------------------------------------------------
-- "My games": games the user decided to try from their recommendations, plus
-- their feedback on each. This is the explicit-feedback loop that feeds the
-- ranking engine (liked/more -> taste boosters; disliked/less -> excluded) and,
-- over time, real training labels for learning-to-rank.
--
-- One row per (user, game) = current state (upsertable), distinct from the
-- append-only event log in user_feedback. rating is null until the user rates.
-- ----------------------------------------------------------------------------
create table public.user_tried_games (
  user_id    uuid not null references auth.users (id) on delete cascade,
  app_id     integer not null references public.games (app_id) on delete cascade,
  rating     text check (rating in ('like', 'dislike', 'more', 'less')), -- null = tried, not yet rated
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, app_id)
);

create index user_tried_games_user_idx on public.user_tried_games (user_id, updated_at desc);

alter table public.user_tried_games enable row level security;

-- Owner-only: a user can only see and modify their own tried-games rows.
create policy "own tried games" on public.user_tried_games
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
