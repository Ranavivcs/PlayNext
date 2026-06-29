# Progress

Running log of what's done. Update after each meaningful step. Newest phase at bottom.

## Phase 1 — Foundation ✅ (LIVE-VERIFIED against Supabase project omrxytvshnuugnhusneh)
- Scaffold: Next.js 16 + React 19 + TS + Tailwind, App Router.
- Folders: `lib/{supabase,steam,reco,ai,types}`, `components`, `supabase/migrations`, `tests`.
- Supabase clients: `lib/supabase/{client,server,admin}.ts` + `middleware.ts` (`updateSession`).
- Auth refresh + route guard in `proxy.ts` (Next 16: renamed from `middleware.ts`).
- `.env.local.example` with all keys (Supabase, Steam, Anthropic).
- Schema: `supabase/migrations/0001_initial_schema.sql` — pgvector, all tables, RLS.
- Auth UI: `app/login`, `app/signup`, `app/login/actions.ts`; protected `app/dashboard` shell; landing `app/page.tsx`.
- Docs system: `CLAUDE.md` router + `docs/*.md` guides.
- shadcn/ui initialized (`components.json`, `lib/utils.ts`, `components/ui/button.tsx`).
- Supabase CLI workflow: `supabase init` done (`supabase/config.toml`). Migration applied via `supabase db push` after linking.

- Migration applied to remote DB via `supabase db push --db-url`.
- Live smoke test `tests/smoke-auth.mjs` passes: signup → profile trigger → RLS block → cleanup.
- Dev server boots; `/`=200, `/dashboard`→307 `/login` (proxy guard works).

## Notes
- Email confirmation is now OFF in Supabase (Auth → Email → Confirm email). Signup returns a session immediately and lands on `/dashboard`. (Was ON; default built-in email sender is rate-limited and threw "email rate limit exceeded" during repeated test signups.)
- `tests/smoke-auth.mjs` RLS check now uses a separate never-authenticated client: with confirmation off, `signUp` returns a session so the signup client is logged in and can read its own profile. All 4 checks pass live.
- Supabase rejects `@example.com` emails; use real-ish domains for tests.

## Phase 2 — Steam integration
### Step A — OpenID linking ✅ (built; type-check clean, routes guarded; awaiting live browser click-through)
- `lib/steam/openid.ts` — build login URL + verify assertion (re-POST `check_authentication`, validate `return_to`, extract 17-digit steamid).
- `lib/steam/api.ts` — server-only Steam Web API wrapper; `getPlayerSummary` (persona/avatar/visibility). Throws if `STEAM_API_KEY` missing.
- `app/api/steam/link/route.ts` — GET, auth-required → redirect to Steam.
- `app/api/steam/callback/route.ts` — GET → verify, fetch summary, upsert `steam_accounts` (user-scoped client, respects RLS), redirect to `/dashboard?steam_linked=1` or `?steam_error=`.
- `app/dashboard/page.tsx` — queries `steam_accounts`; shows persona/avatar or "Link Steam account" button + success/error banners.
- STEAM_API_KEY set in `.env.local`; validated live (GetPlayerSummaries HTTP 200). Next auto-reloaded env.
- Verified: `npx tsc --noEmit` clean; `/api/steam/link` + `/callback` 307→/login when unauthenticated (proxy guard).

### Step A live-verified ✅
- Browser click-through succeeded: persona "ranaviv.cs", public profile, green banner. `steam_accounts` row written.

### Phase 2 COMPLETE ✅ — LIVE-VERIFIED end-to-end
- Linked public account "Ran" (76561198137404352), clicked Sync: UI shows "Imported 19 games" + top-5 by playtime + last-synced.
- DB confirmed via admin query: `games`=19 rows, `user_games`=19 for this user, `steam_accounts.profile_public=true` + `last_synced_at` set, joined sample correct (CS2 1700.6h etc.).
- Re-link works: dashboard "Change account" link re-runs OpenID; upsert onConflict user_id swapped ranaviv.cs → Ran cleanly.
- Minor: `last_played` is null (Steam omitted `rtime_last_played`); playtime is intact, not a blocker.

### Step B — ingest ✅ (built; type-check clean)
- `lib/steam/api.ts` — added `getOwnedGames` (GetOwnedGames + appinfo + free games); no `games` array ⇒ `private:true` (don't error).
- `lib/steam/ingest.ts` — `ingestLibrary(userId, steamId)`: upsert `games` (admin, minimal: name + CDN header_image) → `user_games` (playtime, last_played) → set `last_synced_at`; private ⇒ mark + cold-start. Batched (500). Rich metadata (genres/tags/desc/reviews via appdetails) deferred to a later enrichment step needed by the algorithm.
- `app/dashboard/actions.ts` — `syncSteamLibrary` server action; redirects with `?sync_msg`/`?sync_error`.
- `app/dashboard/page.tsx` — Sync/Re-sync button, game count, top-5 by playtime, last-synced; sync banners.
- `tests/smoke-steam-owned.mjs` — read-only live check (steam_id from DB → GetOwnedGames).

### KEY FINDING — Steam "Game details" privacy is separate from profile visibility
- ranaviv.cs (76561198747970567): profile is Public (persona/avatar read fine) BUT **Game details = private**, so GetOwnedGames returns no list → ingest correctly degrades to private/cold-start.
- To import: Steam → Edit Profile → Privacy → set **Game details = Public** (and optionally unhide total playtime), then Sync. Re-run `tests/smoke-steam-owned.mjs` to confirm.

### Step C — metadata enrichment (LATER, when algorithm needs it)
- `appdetails` for genres/tags/short_desc/price/metacritic/reviews; rate-limited (~1/sec) → batch + 429 backoff.

## Phase 3 — Recommendation engine (`lib/reco/`) — IN PROGRESS ⏳
Decision (confirmed with user): **algorithm core FIRST** — build `lib/reco/` as a PURE module (no DB/network/LLM/unseeded random) with fixtures + unit tests, then enrich metadata + wire to live recs. Read `docs/recommendation-engine.md` before continuing.

### Setup already done this session
- `tsconfig.json`: added `"allowImportingTsExtensions": true`. Rationale: Node v22.18.0 strips TS types at runtime, but its ESM loader needs explicit file extensions. So inside `lib/reco/` and `tests/reco/`, relative imports use explicit `.ts` extensions and AVOID the `@/` alias (Node can't resolve it). This keeps `tsc --noEmit` and `node --test` resolving identically.
- Run unit tests with: `node --test "tests/reco/**/*.test.ts"` (add npm script `"test:reco"`).

### Files — status — ALL CREATED ✅ (tsc clean + 11/11 tests green)
- ✅ `lib/reco/types.ts` — `Weights`, `GameFeatures` (genres, tags, totalReviews, positiveRatio, releaseDate, optional embedding), `OwnedGame`, `RecommendInput` (candidates, owned, ownedFeatures?, preferred*, dismissedAppIds, weights, topK, mmrLambda, now), `ScoreBreakdown`, `ScoredGame`.
- ✅ `lib/reco/vectorize.ts` — TF-IDF: `terms`, `buildIdf(corpus)` (smoothed idf `ln((1+N)/(1+df))+1`, rare tags weigh more), `gameVector` (L2-normalized sparse `Map`), `cosine` (true cosine, robust), `tasteVector(ownedFeatures, playtimeByApp, idf)` = playtime-weighted centroid, `weight = log(1+minutes)`, normalized.
- ✅ `lib/reco/score.ts` — `clamp01`, `popularityScore(reviews, posRatio, maxLogReviews)` (damped, gated by quality), `recencyScore(releaseDate, now)` (exp decay, 2yr half-life; future→1; missing→0), `preferenceScore(game, prefGenres, prefTags)` (hits ÷ #prefs).
- ✅ `lib/reco/mmr.ts` — `mmrRerank(items, lambda, k)`: greedy `λ·score − (1−λ)·maxSim` over content vectors; `MmrItem` interface.
- ✅ `lib/reco/recommend.ts` — orchestrator: idf over candidates+owned, taste vector, exclude owned+dismissed, per-candidate weighted score (breakdown sums to score), sort → shortlist (4×topK) → MMR → topK. Cold start (no owned ⇒ content 0) still returns via pref+popularity. `collab=0` (weights.collab*0). Defaults: topK 10, mmrLambda 0.7.
- ✅ `lib/reco/metrics.ts` — pure `dcgAtK`, `ndcgAtK`, `precisionAtK`, `recallAtK`, `averagePrecision`, `reciprocalRank` (binary relevance via `Set<number>`).
- ✅ `lib/reco/index.ts` — barrel `export *` of the above (`.ts` extensions).
- ✅ `tests/reco/fixtures.ts` — seeded (mulberry32, seed 1337) catalog: 5 genres × 10 games, genre-specific tags, reviews drawn independent of genre; `buildCatalog(seed?)`, `actionLover(catalog)` owns 5 Action games (high playtime), held-out 5 Action = relevant set.
- ✅ `tests/reco/recommend.test.ts` — 5 tests: breakdown sums to score; owned+dismissed excluded; cold-start non-empty (content term 0); MMR(λ=0.3) more genre-diverse than λ=1; **content NDCG@10 (mmrLambda:1, content-only weights) > popularity baseline**. ALL PASS.
- ✅ `tests/reco/metrics.test.ts` — 6 sanity tests for the metric fns. ALL PASS.
- ✅ `package.json` — added `"test:reco": "node --test \"tests/reco/**/*.test.ts\""`.

### Phase 3 verification target (from guide)
Beats popularity baseline on NDCG@10; `score_breakdown` sums to `score`; unit-tested with fixtures. After core: do Step C enrichment + wire `recommend()` to real data (candidate gen, then dashboard recs). Embeddings = Phase 4.

### Phase 3 CORE COMPLETE ✅ (verified this session)
- `npx tsc --noEmit` clean; `node --test "tests/reco/**/*.test.ts"` → 11/11 pass.
- Verification target met: content ranking beats popularity baseline on NDCG@10; `score_breakdown` sums to `score` (asserted per-result).
- Still PURE: no DB/network/LLM/unseeded random anywhere in `lib/reco/`.

## Product scope clarified 2026-05-30 (DECIDED with user)
- **Two entry paths:** (1) Steam users → recs from library+playtime; (2) no-Steam users → pick liked games → similar recs. Engine already supports both: seed games become the `owned` list (flat playtime still builds a taste vector); cold-start covers "no seed, filters only." Path #2 = mostly UI/input plumbing.
- **Filters:** genre, multiplayer, co-op/"play with friend", platform = HARD constraints applied in candidate generation (keep `lib/reco` pure). Genre/difficulty *lean* = soft preference via `preferredGenres`/`preferredTags`.
- **Difficulty** = best-effort from community tags (Difficult/Souls-like/Relaxing); sparse coverage, soft preference only.
- **Platform scope v1 = PC/Steam only.** Data sources: Steam `appdetails` (genres, categories, platforms Win/Mac/Linux, release date), `appreviews` (totalReviews/positiveRatio), SteamSpy (community tags). Cross-platform (RAWG/IGDB) deferred.

## Phase 3 — Step C: metadata enrichment ✅ COMPLETE & LIVE-VERIFIED (2026-05-31)
Goal: fill the SHARED `games` catalog with real `GameFeatures` so the engine can rank live.

### Final result (verified in remote DB)
- Migration 0002 applied via Supabase dashboard SQL Editor (not via `db push`, so it's NOT in Supabase migration history — the repo file is the source of truth; matches exactly).
- Full run `node --env-file=.env.local scripts/enrich-catalog.ts 300 50`: **305 games enriched**, 0 no-store-page, 0 errors (after the dedupe fix below).
- Coverage: 305 games, **305 with tags** (6071 tag rows ≈20/game), **305 with categories** (3525 rows ≈11.5/game), **304 with genres** (828 rows; 1 game legitimately has none), **0 games with total_reviews=0**.
- Platforms: windows=305, mac=109, linux=77. Gameplay categories: ~197 multiplayer-ish, ~250 single-player.
- `enriched_at` set on all 305; re-running skips them as fresh (idempotent confirmed).

### Scaling decision (DECIDED with user 2026-05-30)
- `games` is a **shared catalog** (public-read, service-role write) — enrich a game once, reuse for everyone. Job is **idempotent + skip-if-fresh**.
- **Unplayed owned games need NO enrichment**: exclusion only needs `app_id` (already in `user_games`); taste vector weight `log(1+minutes)` makes 0-playtime games contribute nothing.
- So per-user enrichment = **played games (playtime>0), capped at top ~50 by playtime**. Shared catalog = **SteamSpy top ~300**. Bounds cost regardless of library size.

### Files built (tsc clean; fetchers live-verified)
- `supabase/migrations/0002_game_metadata_enrichment.sql` — adds `games.platform_windows/mac/linux` + `games.enriched_at` (skip-if-fresh signal), and `game_categories` table (Single-player/Multi-player/Co-op…, public-read RLS). **NOT YET APPLIED to remote DB.**
- `lib/steam/api.ts` — added `getAppDetails` (Steam store: genres, categories, platforms, desc, release date→yyyy-mm-dd, price, metacritic; throws "RATE_LIMIT" on 429), `getSteamSpyAppDetails` (community tags+votes, positive/negative→total_reviews/positive_ratio), `getSteamSpyTop(n)` (catalog seed).
- `lib/steam/enrich.ts` — `enrichGames({appIds, ttlDays, delayMs, onProgress})`: skip-if-fresh, ~1.3s throttle, 429 backoff; upserts `games` + delete/insert `game_genres`/`game_categories`/`game_tags`; per-app errors counted, not fatal. Data map: Steam appdetails→genres/categories/platforms/store fields; SteamSpy→tags+reviews. Only `type==="game"` rows kept. Relative `.ts` imports so plain Node can run it.
- `scripts/enrich-catalog.ts` — runner: `node --env-file=.env.local scripts/enrich-catalog.ts [catalogSize=300] [playedCap=50]`. SteamSpy top-N + top-played `user_games` → `enrichGames`.

### KEY FINDING — SteamSpy `all` ordering gotcha
SteamSpy keys its JSON by appid. `Object.values()` returns integer-like keys in **ascending numeric order** (V8), so the naive read gave oldest/lowest appids (10, 30, 40…) not the most-owned. Fixed `getSteamSpyTop` to re-sort by total reviews (positive+negative) desc. Verified: now returns CS:GO, PUBG, GTA V, Terraria, Elden Ring…

### KEY FINDING #2 — duplicate-category PK crash + partial-enrich risk (FIXED)
Steam `appdetails.categories` can repeat a description, so the batch insert hit `game_categories_pkey` (PK = app_id, category) for 2 apps (431960 Wallpaper Engine, 620 Portal 2). Because `enrichOne` upserts `games` (sets `enriched_at`) BEFORE inserting categories, those 2 were marked enriched but left without categories/tags — and would be skipped as "fresh" on re-run. Fix: dedupe genres/categories/tags on their PK column before insert (`enrichOne` in `lib/steam/enrich.ts`). Recovery: nulled `enriched_at` for the 2 apps and re-ran (skips 303 fresh instantly, re-enriched the 2). Lesson for any future enrich step: dedupe child rows, and consider moving the `enriched_at` stamp to AFTER all child writes succeed.

### Live-verified
- `getAppDetails(730)` → name/type=game/release/free/platforms/genres/categories parse.
- `getSteamSpyAppDetails(730)` → 8.8M reviews, 0.867 ratio, tags with votes.
- `getSteamSpyTop` → correct popularity order after the ordering fix.
- Full catalog populated (numbers above).
- Verification gotcha noted: PostgREST caps plain `select` at 1000 rows — use `head:true` counts or `.range()` pagination when measuring coverage, else distinct-app counts read low.

## Phase 3 — Step D: wire the engine to live data — bridge + first live run ✅ (2026-05-31)
**MILESTONE: the engine has now run on real DB data for the first time.** Built the impure DB→engine bridge in a NEW `lib/reco-data/` folder (kept separate from pure `lib/reco/`, matching the one-way flow `route → fetch(db) → reco → ai`).

### Files built (tsc clean; live-verified end-to-end)
- `lib/reco-data/types.ts` — `CatalogEntry` = pure `GameFeatures` + filter-only metadata (`PlatformFlags`, `categories[]`). Filter metadata is deliberately OFF `GameFeatures` so `lib/reco` stays pure.
- `lib/reco-data/catalog.ts` — `loadCatalog(client)` pages all enriched games (`enriched_at not null`) + `game_genres`/`game_tags`/`game_categories` via `.range()` (defeats PostgREST 1000-row cap; game_tags ≈6k) and assembles `CatalogEntry[]`. `loadFeaturesFor(client, appIds)` loads `GameFeatures` for owned app_ids so the taste vector survives even if an owned game isn't in the candidate slice. **Supabase client is INJECTED** (service-role script vs user-scoped action).
- `lib/reco-data/filters.ts` — `applyHardFilters(catalog, {platforms, mode})`. Platform = all listed must be true. Mode whitelist: multiplayer/co-op/single-player keyed off a curated category set (avoids Steam's non-gameplay category noise). Hard constraints live HERE, not in scoring.
- `lib/reco-data/user.ts` — `loadUserContext(client, userId)`: owned (`user_games`), `weights`+`preferredGenres/Tags` (`user_preferences`, `DEFAULT_WEIGHTS` fallback mirrors 0001 jsonb), `dismissedAppIds` (`user_feedback` action in dismissed/hidden). `coerceWeights` defaults any missing field.
- `lib/reco-data/run.ts` — `generateRecommendations({client,userId,filters?,topK?,mmrLambda?,now?,persist?})`: load catalog+user (parallel) → load ownedFeatures → `applyHardFilters` → `recommend()` → persist `recommendations` (params snapshot {weights,filters,topK,mmrLambda}) + `recommendation_items` (rank, score, score_breakdown). Returns `{results, candidateCount, recId}`.
- `lib/reco-data/index.ts` — barrel.
- `scripts/run-reco.ts` (`npm run reco:run`) — plain-Node runner: resolves auth user from a linked steam_id (default test account "Ran"), admin client (bypasses RLS), persist=true, prints ranked results + breakdown.

### Live result (verified 2026-05-31)
- `node --env-file=.env.local scripts/run-reco.ts` → user "Ran", **305 candidates after filters**, persisted `recommendations.id`, top-10 printed.
- Output sane: content term dominates (Ran's CS2/FPS-heavy library → Insurgency #1), popularity present but DAMPED (never dominant, per guide), recency small, `pref=0.000` (no user_preferences row → empty preferred*). MMR (λ=0.7) reranks shortlist so printed scores aren't strictly descending — expected diversity trade-off.
- Persistence confirmed: parent row id returned from `.insert().select("id").single()`; 10 items inserted error-checked.

### DECISIONS this session (with user)
- **Verify path:** script-first (admin client + test user), THEN server action + UI. **Write client:** real app path persists via the user-scoped server client (RLS owner-only); admin only for the script.
- **RAWG reconsidered & re-deferred:** stay Steam-only for v1. A no-Steam *user* ≠ a non-Steam *game* (Steam covers ~95%+ of PC games). A Steam+RAWG *hybrid* would break the single feature space (tag-vocabulary mismatch → zero cosine overlap, polluted IDF, incomparable popularity scales). If non-Steam coverage is wanted later → RAWG as SINGLE source of truth (Phase 4+), or RAWG only feeding the RAG layer (never ranking). See memory `project-playnext`.

## Phase 3 — Step D: server action + dashboard recs UI ✅ BUILT (tsc + `next build` clean; awaiting logged-in click-through)
- `app/dashboard/actions.ts` — `generateRecs()` server action: user-scoped server client → `generateRecommendations({client, userId, persist:true})` → revalidate + redirect `?recs_msg`/`?recs_error`. try/catch so engine errors become a banner (success redirect is OUTSIDE the try so it isn't swallowed).
- `app/dashboard/page.tsx` — reads latest `recommendations` + `recommendation_items` (joined to `games`, RLS owner-only read), renders a "Recommended for you" grid of `RecCard`s: header image, rank+name, total score, and a stacked `score_breakdown` bar (content/preference/popularity/recency/collab) + a labeled legend. "Get recommendations / Refresh" button gated on gameCount>0; "Last run" timestamp. recs_msg/recs_error banners added.
- **VERIFIED:** `npx tsc --noEmit` clean; `npm run build` clean — Turbopack DOES bundle the `.ts`-extension chain (`@/lib/reco-data/run` → `../reco/recommend.ts`), so the same files run under plain Node AND Next. Dev server: `/dashboard` → 307 `/login` logged out (proxy guard intact), route compiles with the new action/query.
- **NOT yet verified (needs user):** the logged-in browser click-through — i.e. the RLS owner-only INSERT via the *user's* server client (the script used the admin/service-role client which bypasses RLS). Engine output + persistence themselves are already proven via `scripts/run-reco.ts`. To verify: log in as the PlayNext test account (ranaviv1991@gmail.com), click "Get recommendations" on /dashboard, confirm cards render + a new `recommendations` row appears for that user.

## Phase 3 — Step D: hard-filter controls (platform + mode) ✅ BUILT & LIVE-VERIFIED at engine level
- `app/dashboard/actions.ts` — `generateRecs(formData)` now parses the form into `HardFilters`: `parseFilters()` reads `platform` checkboxes (windows/mac/linux, whitelisted) + a `mode` select (single-player/multiplayer/co-op), ignores anything unrecognized, passes `filters` to `generateRecommendations`.
- `app/dashboard/page.tsx` — the Recommendations card is now a `<form action={generateRecs}>` with platform checkboxes + a mode `<select>` + submit. Controls are pre-populated from the **last run's** `recommendations.params.filters` (added `params` to the latestRec select → `appliedFilters`) so they stay in sync after submit. Server-rendered native inputs (no client component needed).
- `scripts/run-reco.ts` — added optional `--mode=` / `--platform=a,b` flags so the hard-filter path can be exercised on live data without a browser.
- **LIVE-VERIFIED (script, admin client):** no filter → **305 candidates**; `--mode=co-op --platform=linux` → **29 candidates**, and every result is genuinely co-op + Linux (Terraria, Garry's Mod, Left 4 Dead 2, Borderlands 2, Stardew Valley…). Filter narrowing + persistence confirmed. `tsc` + `npm run build` clean.
- **CLICK-THROUGH NOW VERIFIED ✅ (2026-05-31, user did it):** logged in as the PlayNext test account, /dashboard showed green "Generated 10 recommendations" banner, ranked cards rendered with score_breakdown bars, and the Linux+Co-op filters round-tripped (results were all co-op Linux games). So the RLS owner-only INSERT via the **user's** server client works. **Step D is FULLY DONE.**

## Product discussion 2026-05-31 (with user — drives next priorities)
- **"I keep getting the same games."** Two compounding causes, both expected: (1) catalog is only **305 enriched games**, and a filter like co-op+linux leaves ~**29 candidates** — small pool; (2) the engine is **deterministic by design** (pure, no randomness) so same library+filters → identical ranking each run. FIX = enlarge the catalog: `node --env-file=.env.local scripts/enrich-catalog.ts 1500 50` (catalogSize arg already supported; idempotent/skip-fresh so it only adds new games). Consider doing this early next session so recs feel fuller.
- **"Does it use my Steam games automatically?"** YES — `generateRecommendations` reads `user_games` (owned+playtime) → playtime-weighted taste vector → the per-card "Content" bar; owned games excluded. Confirmed working (CS2/multiplayer library → co-op shooters/sandbox rank high).
- **User wants to recommend by more metrics: difficulty, playtime, genre, etc.** Currently the UI only exposes the HARD filters platform + mode (any/single/multiplayer/co-op). The ask = the **soft-preference + weight-tuning** layer (roadmap item 3 below). Mapping:
  - genre/tag leanings → `preferred_genres`/`preferred_tags` (engine already consumes; raises "Preference" bar which is currently always 0 because no `user_preferences` row exists).
  - difficulty → best-effort SOFT pref from community tags (Souls-like/Difficult/Relaxing); sparse coverage, never a hard guarantee.
  - weight sliders → the `weights` jsonb (Content vs Popularity vs Recency vs Preference); engine already reads it.
  - "playtime" is AMBIGUOUS — clarify with user: filter by typical game LENGTH (needs a NEW enriched field — not stored today) vs. it already being the implicit-feedback taste signal. Don't build until clarified.

## Phase 3 — Step E: bigger catalog + soft-pref/weights UI ✅ BUILT (tsc + `next build` clean; awaiting logged-in click-through) — 2026-06-01
Tackled RESUME items 1 & 2 (user: "focus on 1-2 first").

### 1. Catalog enlarged 305 → 1003 ✅ LIVE-VERIFIED
- **KEY FINDING:** `getSteamSpyTop` only fetches SteamSpy `page=0` = top ~1000 by owners, so `enrich-catalog.ts 1500` silently caps at ~1000 (the `slice(0,1500)` has only ~1000 entries). Reaching 1500+ needs pagination across SteamSpy `all` pages with ~60s waits (throttled ~1 req/min). DECIDED with user: run at **1000** — no code change, 3.3× the pool, captures the popular head; the long tail beyond ~1000 is sparse/low-quality and mostly filtered or ranked low anyway. Paginate later only if a filter slice still feels thin.
- Ran `node --env-file=.env.local scripts/enrich-catalog.ts 1000 50`: `{total:1004, enriched:698, skippedFresh:305, noStorePage:1, errors:0}`. Verified **1003 enriched games** via `head:true` count (`.not('enriched_at','is',null)`). Idempotent skip-fresh confirmed (305 prior games skipped instantly).

### 2. Soft-preference + weights UI ✅ (NO engine changes — engine already consumes prefs/weights)
- **`app/dashboard/preferences-options.ts`** (NEW plain module — NOT `"use server"`, so it can export the constant lists shared by page + action): `GENRE_OPTIONS`, `TAG_GROUPS` (Difficulty / Playstyle / Mood / Theme), `WEIGHT_FIELDS` (content/preference/popularity/recency — **collab omitted**, engine ×0 until CF), plus `*_OPTION_SET` for validation. **Every value verified present in `game_genres`/`game_tags`** before inclusion (engine `preferenceScore` is exact, case-sensitive set membership — an absent string would silently never match). Difficulty group = Difficult / Souls-like / Relaxing / Family Friendly (the user's "recommend by difficulty" ask, as a SOFT lean).
- **`app/dashboard/actions.ts`** — `savePreferences(formData)`: whitelists genres/tags against the option sets, `parseWeight` clamps the 4 fields to [0,1] (default on NaN/blank), **preserves the hidden `collab` weight** from the existing row, upserts `user_preferences` (user-scoped client → RLS owner-only) with `updated_at`, revalidate + redirect `?prefs_msg`/`?prefs_error`.
- **`app/dashboard/page.tsx`** — new full-width "Your preferences" section (gated on `gameCount>0`): genre checkboxes + grouped tag checkboxes + 4 weight number inputs, **pre-filled from the saved `user_preferences` row** (DEFAULT_WEIGHTS fallback); prefs success/error banners. Saving doesn't auto-rerun — banner tells the user to Refresh recommendations to apply.
- **VERIFIED:** `npx tsc --noEmit` clean; `npm run build` clean (Turbopack bundles the `.ts` chain as before). **NOT yet verified (needs user):** logged-in click-through of the prefs form (save → row written via user client under RLS → next run's "Preference" bar > 0).

### Verification gotcha re-confirmed this session
- A `.in('tag', [...])` lookup to test tag presence FALSELY reported common tags (Story Rich, Open World, Sci-fi) as missing — it hit the PostgREST 1000-row cap. Use full `.range()` pagination (or `head:true` counts) to test catalog membership. The paginated check found 354 distinct tags; "Souls-like"/"Relaxing" present, "Roguelike/Roguelite/Hard" absent.

### Step E UX redesign ✅ BUILT (tsc + `next build` clean) — user feedback on first cut
User feedback on the first cut: two scattered "preference-like" panels (the Recommendations card's hard filters + the separate "Your preferences" section) read as redundant/confusing; the wall of checkboxes was tacky and pushed the actual games below the fold (games are the point). Redesigned the dashboard IA (decisions confirmed with user: ONE button; weights under Advanced):
- **Games are the hero.** "Recommended for you" grid moved to the TOP of the page (right under banners). Setup cards (Steam account + Your library) moved BELOW it (secondary). Steam sync still its own action/card.
- **One control surface.** A single collapsed `<details>` "Adjust recommendations" panel above the grid (native, no client JS; auto-open only when there's no run yet). Inside, two clearly-labeled groups disambiguate the mechanisms: **Must match** (platform + mode = hard filters, "limited to games that fit") vs **Lean toward** (genres + difficulty/tag groups = soft prefs, "nudge ranking, don't exclude"). This also resolves the MMO-genre-vs-single-player-mode confusion the user flagged.
- **Chips, not checkbox rows.** New `Chip`/`ChipGroup` server components: a visually-hidden input + `peer-checked:` pill styling (pure CSS, no client component). Platform/genres/tags = multi (checkbox chips); Mode = single (radio chips incl. "Any"=value "").
- **Weights under Advanced.** The 4 weight number inputs (content/preference/popularity/recency) live in a nested collapsed `<details>` so the common case stays simple.
- **Merged action.** `app/dashboard/actions.ts`: replaced `savePreferences` + `generateRecs` with ONE `updateRecommendations(formData)` — saves soft prefs (preserving hidden collab weight) THEN runs the engine with hard filters, all under the user-scoped client (RLS). Single success banner "Updated — N recommendations." (`prefs_msg`/`prefs_error` searchParams removed; errors flow through `recs_error`).
- Still **awaiting logged-in click-through** of the new single-form flow.

### Step E follow-up: control simplification + bigger catalog (2026-06-01) ✅ BUILT (tsc+build clean)
User feedback after seeing the redesign live: still too many options; Mood vs Theme / Genre vs Playstyle overlap; platform filter questionable for a PC-only app.
- **Platform filter REMOVED from the UI.** Data-driven: of 1003 enriched games, 100% run on Windows, only 34% Mac / 25% Linux, and **62% are Windows-only** — so the filter never excludes anything for a Windows user and only matters for Mac/Linux. Dropped the platform chips from `page.tsx` and platform parsing from `actions.ts` `parseFilters`. The engine still SUPPORTS platform filtering (`lib/reco-data/filters.ts` `applyHardFilters` unchanged) so it can return later (e.g. OS auto-detect). Mode is now the only hard filter.
- **Tag groups halved.** Playstyle/Mood/Theme were all community tags from one pool (arbitrary grouping) → merged into a single **"Vibe & style"** group (Open World, Story Rich, Atmospheric, Funny, Horror, Sci-fi, Fantasy, Stealth). Soft prefs are now just Genres (Steam taxonomy) + Difficulty + Vibe & style. (`preferences-options.ts`.)
- **Catalog 1003 → 2533.** Decided ~2500 sweet spot (user had no preference; long tail past ~1000 is niche/low-review, diminishing relevance). Required the SteamSpy pagination fix: `getSteamSpyTop` now pages the `all` endpoint (1000/page) with a ~61s wait between pages (SteamSpy throttles `all` to ~1 req/min), merges + re-sorts by reviews. Run `enrich-catalog.ts 2500 50` → `{enriched:1530, skippedFresh:966, noStorePage:5, errors:0}`; verified **2533** enriched via head:true count.

### Step E follow-up 2: soft-pref vocabulary overhaul + pick cap (2026-06-01) ✅ BUILT (tsc+build clean, user-approved live)
User (a gamer) flagged: store-genres too coarse (wanted Shooter/MMO/Rogue-like…), "Souls-like" miscategorized as difficulty, difficulty should be a scale, and later — too many options + picking many tags is self-defeating.
- **Genres now = community tags, not Steam store-genres.** The gamer-meaningful genres only exist as tags. So ALL soft-pref options are tags now → everything saves to `preferred_tags`; `preferred_genres` left empty. (`preferenceScore` matches tags exactly, so this "just works".)
- **Trimmed to ~16 headliner genres (flat list)** after an over-corrected 35-option grouped version. Plus a small Vibe & theme group + Difficulty.
- **Difficulty is honest** — no fake Easy/Med/Hard scale (Steam has no difficulty rating). Just two soft leans: Challenging (`Difficult` tag) + Relaxing (`Relaxing` tag). Souls-like moved to RPG genres.
- **Pick cap = MAX_PICKS (5).** KEY INSIGHT (drove the design): `preferenceScore = hits ÷ picks`, so many picks DILUTE the signal (a 12-tag combo matches ~nothing). New **`app/dashboard/preference-chips.tsx`** CLIENT component (first client component in the dashboard) holds selection state, greys out the rest at the cap, shows "Pick up to 5 (N/5)". Cap also enforced server-side in `updateRecommendations` (dedupe + slice) — don't trust the client.
- **Mode relabeled** to gamer terms: Solo / Multiplayer / Co-op (play with friends); section heading "How you want to play".
- Files: `preferences-options.ts` (rewritten: GENRE_OPTIONS flat 16, VIBE_TAGS, DIFFICULTY_OPTIONS, MAX_PICKS, TAG_OPTION_SET), `preference-chips.tsx` (new client comp), `page.tsx` (uses it; Mode still server-rendered Chip/ChipGroup), `actions.ts` (tag-only + cap).

### Step E follow-up 3: Mode/Difficulty/Vibe out of the cap, single-select (2026-06-01) ✅ BUILT (tsc+build clean)
User: Mode + Difficulty must always be available and NOT count toward the 5-cap; opposing tags shouldn't be co-pickable.
- **Cap now applies to GENRES ONLY** (`MAX_GENRE_PICKS=5`, multi-select). The client `GenrePicker` is genres-only now.
- **Difficulty + Vibe & theme are SINGLE-select** radio chips (Any default), always available, uncapped. Single-select inherently blocks opposing picks (Sci-fi+Fantasy, Challenging+Relaxing). Rendered server-side (no client state needed), like Mode.
- Form fields: `tag` (genres, cap 5) + `vibe` (single) + `difficulty` (single) + `mode` (hard filter). `actions.ts` validates each against its own set and merges genres+vibe+difficulty into `preferred_tags`. `page.tsx` splits saved `preferred_tags` back into genres/vibe/difficulty for pre-fill (`GENRE_OPTIONS` / `VIBE_OPTION_SET` / `DIFFICULTY_VALUE_SET`).

## Phase 3 — Step F: seed-based recommendations (no-Steam / "pick games" path) ✅ BUILT & ENGINE-VERIFIED (2026-06-01)
Completes the TWO-ENTRY-PATH product vision (Steam library OR hand-picked games). DECIDED with user: available to **logged-in users** (no anonymous/public page); seeds **replace the library** for that run (taste from seeds only).
- **Engine** (`lib/reco-data/run.ts`): `generateRecommendations` gained `seedAppIds?`. When non-empty: `owned` = seeds (flat playtime 60 → equal-weight taste centroid), and the user's REAL library is folded into `dismissedAppIds` so owned games still aren't recommended. `params.seedAppIds` persisted. Pure `lib/reco/` untouched (seeds are just an `owned` list — cold-start/seed support was always there).
- **Search** (`app/api/catalog/search/route.ts`): GET `?q=` → `games` name ILIKE, enriched-only, popularity-ordered, top 12 `{appId,name,headerImage}`. Auth-guarded (defensive 401 + proxy).
- **UI** (`app/dashboard/seed-picker.tsx`, new CLIENT comp): debounced search box → results dropdown w/ thumbnails → pick up to 5 as removable chips → hidden `seed` inputs post with the Adjust form. `actions.ts` `updateRecommendations` parses `seed` app_ids (int, dedupe, cap 5) → `seedAppIds`. `page.tsx`: SeedPicker at top of the form; the `gameCount>0` gate REMOVED so no-Steam users can use it (hint shown when no library).
- **LIVE-VERIFIED** (admin script, persist:false): seeds = Monster Hunter World / NieR:Automata / Monster Hunter Rise → top recs Elden Ring, DBZ Kakarot, Devil May Cry 5, Kingdom Hearts (content-driven, sane action-RPG/JRPG neighborhood); seeds excluded from results. `tsc` + `next build` clean.
- **NOT yet verified (needs user):** the in-browser search-dropdown UX + logged-in seed click-through.

## Phase 4 — AI explanations (lib/ai) ✅ DONE & LIVE-VERIFIED — 2026-06-01
First AI layer. Per-game "why this matches you" blurb, generated AFTER ranking. Explains, NEVER ranks (the architecture line). DECIDED with user: per-card explanations first (no embeddings); full semantic RAG/chat deferred (needs pgvector).
- **`@anthropic-ai/sdk` installed.** Built via the `claude-api` skill (current model IDs, prompt-cache the stable system prompt).
- **`lib/ai/explain.ts`** — `explainRecommendation({game, tasteSummary, breakdown})` → Anthropic SDK. Model **`claude-haiku-4-5`** (a `MODEL` const; switch to `claude-opus-4-8` for max quality). `thinking:{type:"disabled"}` (one-liner needs none), `max_tokens:200`, cached system prompt. Grounded ONLY in the passed facts (genres/tags/desc/reviews + taste + which signal drove the rank) so it can't hallucinate game details.
- **`explainRec` action** (`app/dashboard/actions.ts`) — loads the item's `score_breakdown` (RLS-owned), the game facts (games/genres/tags), and a taste summary (top-played `user_games`, else saved `preferred_tags`), calls the AI, persists `recommendation_items.ai_explanation`. try/catch → `recs_error` banner on failure (ranked list unaffected). Success → revalidate + redirect.
- **UI** (`page.tsx` RecCard) — shows saved `ai_explanation`, else a **"✨ Why this match?"** button (form posting rec_id+app_id to `explainRec`). Lazy + cached.
- **KEY / SECURITY:** user pasted a live key in chat → flagged as compromised, replaced with a placeholder in `.env.local` (`REPLACE_WITH_YOUR_NEW_ANTHROPIC_KEY`); user is rotating + will set the new one. **Gotcha:** Node's strict `--env-file` parser silently dropped vars after a comment line — normalized `.env.local` to bare `KEY=VALUE` lines (no comments). Next.js's own env loader was always fine.
- **LIVE-VERIFIED (user clicked it):** "✨ Why this match?" generates a grounded blurb, persists, and displays. Switched to Haiku after verifying.
- **CRITICAL GOTCHA — dev server env shadowing (cost us ~30 min):** the SDK threw "Could not resolve authentication method" even though `.env.local` had the key. Cause: when the dev server is launched **from inside the Claude Code agent session**, the session injects `ANTHROPIC_API_KEY=""` (empty) and `ANTHROPIC_BASE_URL=<gateway>`, and `@next/env` does NOT override an already-present process.env var → the empty key shadowed `.env.local`. Fixes: (a) **the USER running `npm run dev` in their own terminal has none of these set → just works**; (b) to run it from the agent, launch with `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN && npm run dev`. Diagnose with `node -e "...loadEnvConfig(process.cwd(),true)..."`. Also: Node's strict `--env-file` parser silently drops vars after a comment line — `.env.local` was normalized to bare KEY=VALUE.

## README refresh + UX/UI redesign (2026-06-05)
### README updated & pushed ✅
- `README.md` brought up to date: Phase 4 AI explanations marked DONE (was "planned"), added the two-entry-paths blurb (Steam vs pick-games), the seed path, ~2,500-game catalog, and bumped the RAG-chat work to "Phase 5". Committed + pushed (`6777136`).

### Visual redesign — dark + neon theme across ALL surfaces ✅ BUILT (tsc + `next build` clean)
User asked to make the site cleaner/smoother/more inviting. Showed 3 themed mockups (one mock screen re-skinned via a live switcher: Light & clean / Dark gaming / Dark + neon, all on an indigo/violet accent). **User picked "Dark + neon".** Scope = all surfaces. **Purely `app/` + `components/` + `globals.css` — `lib/reco` and `lib/ai` untouched.**
- **`app/globals.css`** — replaced the flat neutral shadcn palette with a single **dark + neon** theme (default `:root`, no light mode). Maps the neon palette onto the shadcn tokens (`--background #06060e`, `--card`, `--primary #a855f7`, `--border` violet-tinted, etc.) PLUS brand extras (`--brand #a855f7` → `--brand-2 #d946ef` gradient, `--on-brand`, `--faint`, `--glow`, `--shadow-card`, `--bar-track`). Body has fixed neon radial-glow gradients. Added `--color-brand/-2/-faint` to `@theme inline` so `text-brand`/`bg-brand`/`text-faint` utilities work. New `@layer components` set: `.brand`/`.brand-logo`/`.brand-grad`, `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-sm`, `.panel`, `.field`, `.chip`(+`.chip-on`/`.chip-disabled` and `.pn-check:checked + .chip`), `.banner-ok`/`.banner-err`.
- **`app/page.tsx`** (landing) — real hero: top nav with brand, eyebrow, big gradient headline, two CTAs, two "path" cards (Steam vs pick-games), architecture footnote.
- **`app/login/page.tsx` + `app/signup/page.tsx`** — branded logo header + `.panel` card + `.field` inputs + neon primary button + banner classes.
- **`app/dashboard/page.tsx`** — reskinned, **all logic/data/queries/form field names + server actions unchanged**. Centered max-w-5xl container; app-bar header (brand + email + Sign out); banners → `.banner-*`; Adjust `<details>` → `.panel`; chips/inputs/weights/submit restyled; RecCard now a hover-lift card with rank+score badges over the cover art, gradient placeholder when no image, neon score bar (brighter `-400/500` segment colors), brand-colored "✨ Why this match?"; DashboardCard → `.panel`.
- **`app/dashboard/preference-chips.tsx`** (GenrePicker) + **`seed-picker.tsx`** — chips use `.chip`/`.chip-on`/`.chip-disabled`; search field `.field`; dropdown `.panel`.
- **VERIFIED:** `npx tsc --noEmit` clean; `npm run build` clean (all 10 routes). Live-screenshotted landing + login in the real Next app (neon hero, glowing logo, gradient text, branded auth card all render). **NOT yet verified:** logged-in dashboard click-through (needs a session) — same pattern as prior phases; the dashboard reuses the verified component classes and built clean.
- Throwaway preview scaffolding (the 3-theme mockup HTML + a static server) was removed after the decision. A `playnext-dev` + `design-preview` config lives in the **workspace-root** `C:\The Final Project\.claude\launch.json` (outside the repo) for the Claude preview tool.

## Deploy to Vercel + account management (2026-06-05)
### Deployed to Vercel ✅ LIVE
- Live at **https://play-next-five.vercel.app** (Hobby/free plan, `*.vercel.app` domain — no custom domain needed). Project `play-next` under `rans-projects1`. Auto-deploys on push to `main`.
- **KEY FINDING — env vars need a redeploy:** first load 500'd because env vars were added *after* the initial deploy; Vercel only applies them on a NEW deploy. Fixed by setting all 6 (Supabase ×3, `STEAM_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL=https://play-next-five.vercel.app`) for Production + redeploy. Landing then 200.
- **Steam OpenID needs NO dashboard change** — OpenID 2.0 `identifier_select`; `return_to`/realm derive from `NEXT_PUBLIC_SITE_URL`. So that env var (exact prod origin, no trailing slash) is the only Steam-related step.
- Prod + dev share the SAME Supabase project (`omrxytvshnuugnhusneh`).

### Steam-library uniqueness — ALREADY enforced (no change)
- `steam_accounts.steam_id` is `not null unique` (migration 0001); the callback already maps the `23505` violation to "This Steam account is already linked to another user." So one Steam library can't be linked to two PlayNext accounts.

### Account recovery + deletion + display-name ✅ BUILT (tsc + `next build` clean)
User flagged the "stuck account" gap (link Steam → forget account → library locked by the unique constraint). Built (DECIDED with user — "both + display-name fix"):
- **Forgot-password flow.** `requestPasswordReset` / `updatePassword` actions (`app/login/actions.ts`); `app/forgot-password/page.tsx` (request, always shows neutral "sent" to avoid email enumeration); `app/auth/callback/route.ts` (GET → `exchangeCodeForSession(code)` → forward to `next`, same-site only); `app/reset-password/page.tsx` (set new password, guarded by the recovery session). "Forgot password?" link added to `/login`. `/forgot-password` added to `PUBLIC_PATHS` (`/auth` already public).
- **Delete account.** `deleteAccount` action (`app/dashboard/actions.ts`) — requires a `confirm` checkbox, uses the **admin** client `auth.admin.deleteUser(user.id)`; FK `on delete cascade` wipes steam_accounts/user_games/prefs/recs AND frees the `steam_id` for re-linking. Renders in a collapsed "Danger zone" on the dashboard; success → `/?deleted=1` banner.
- **Display name in header.** Signup already saved `user_metadata.display_name` but the dashboard showed raw email; header now shows display name + email subtitle. New `account_msg`/`account_error` dashboard banners.
- **⚠️ NEEDS A SUPABASE DASHBOARD STEP for password reset to work:** add the prod + local URLs to Supabase → Auth → URL Configuration → **Redirect URLs**: `https://play-next-five.vercel.app/auth/callback` and `http://localhost:3000/auth/callback` (and Site URL = prod). Without it Supabase rejects the `redirectTo`.
- **⚠️ Email caveat:** reset emails use Supabase's built-in sender (rate-limited — same reason email *confirmation* is off). Fine for demo; custom SMTP is the production fix later.
- **LIVE-VERIFIED (user, prod):** after sign-out → sign-in as the right account, the header shows the chosen display name and the "Danger zone" renders. Reset-email round-trip + delete click-through still to be exercised (need the Supabase redirect-URL step first).

### Wrong-email mystery — RESOLVED ✅ (stale session, not a bug)
- User signed up `ranaviv.cs@gmail.com` (verified in DB: created + signed in today, display_name "Ran-test") but the header had shown `ranaviv1991@gmail.com` (old test acct, **last sign-in May 29 — never on prod**) → a leftover/stale session in that browser. After sign-out → sign-in → refresh, the header correctly showed the picked name. No code bug.

### Password UX polish (2026-06-05) ✅ BUILT (tsc + build clean)
- **`components/password-fields.tsx`** (NEW client component) — new-password + confirm-password with a **show/hide toggle** and a dependency-free **strength meter** (0–4 from length + char-class variety → Very weak…Strong, colored bar). Posts `password` + `confirm_password`.
- Used by **signup** and **reset-password** (replaced their plain password inputs). Confirm-match is **also enforced server-side** in `signup` and `updatePassword` (don't trust the client).
- **After a reset, sign out → `/login?message=…`** (DECIDED with user) — user signs in fresh with the new password (confirms it), instead of dropping straight into the dashboard.
- **Reset flow root-cause fix shipped earlier this session:** request-origin (`lib/origin.ts`) instead of `NEXT_PUBLIC_SITE_URL` for the email link + callback redirect — `NEXT_PUBLIC_*` is baked at build time, so a stale Vercel value produced localhost links. LIVE-VERIFIED: reset email → set new password → works on prod.
- Steam linking now ALSO uses request-origin (`getOrigin()`): `buildSteamLoginUrl(origin)` + `verifySteamAssertion(query, origin)` take the origin from the route; `getSiteUrl()` removed. So neither auth-reset NOR Steam depend on `NEXT_PUBLIC_SITE_URL` anymore (it's just a no-request fallback in `lib/origin.ts`).

## Game-length soft preference (2026-06-05) 🚫 PARKED PERMANENTLY (DECIDED with user 2026-06-16)
**FINAL DECISION (2026-06-16):** game-length is **parked for good — not a future item.** No data source is worth the cost/complexity for this project (SteamSpy playtime is dead; HowLongToBeat = fuzzy name-match + slow scraping; IGDB = Twitch OAuth + another integration), and the feature adds little to the algorithm thesis. The DB columns + engine plumbing stay (harmless, backward-compatible) but the UI control stays hidden and we will NOT revive it. Removed from the roadmap.

**Original blocker (kept for the record):** SteamSpy's playtime fields are **dead** — `median_forever` / `average_forever` return **0 for every game** (verified: CS2/730 and Counter-Strike/10 both 0, in both the per-app `appdetails` AND the `all` endpoints). Valve cut SteamSpy's playtime access years ago. So the chosen source has no length data; every game buckets as "unknown" → neutral → the preference has zero effect.
**DECIDED with user: PARK it.** The UI "Game length" control is **hidden** (removed the ChipGroup from `page.tsx`); ALL other plumbing is kept and working so a real source drops straight in. To revive: feed `games.median_playtime` (or rename to hours-to-beat) from **HowLongToBeat** (fuzzy name-match, no shared app_id, slow rate-limited backfill) or **IGDB** (time-to-beat, needs Twitch OAuth), then re-add the ChipGroup. The backfill via SteamSpy `all` was removed-in-spirit (script kept but it matches 0 — don't trust it).
DECIDED with user (original design, retained): **soft preference folded into the existing Preference term** (not a new weight, not a hard filter) — median playtime is noisy, so soft is safest.
- **Migration `0003_game_length.sql`** (APPLIED via dashboard SQL editor, user confirmed): `games.median_playtime` (int, minutes = SteamSpy `median_forever`) + `user_preferences.preferred_length` (text check short/medium/long or null).
- **Engine (`lib/reco`, still pure):** `GameLength` type + `GameFeatures.medianPlaytimeMinutes` + `RecommendInput.preferredLength`. `score.ts`: `lengthBucket` (≤5h short / ≤20h medium / >20h long; null when unknown) + `lengthMatch` (graded: exact 1, adjacent 0.5, far 0; **unknown = 0.5 neutral** so missing data isn't punished). `preferenceScore` gained an optional `preferredLength` — counts as one criterion in the hits/total fraction. Backward-compatible (existing tests green).
- **Bridge:** `catalog.ts` loads `median_playtime` (shared `GAME_COLUMNS`) into `medianPlaytimeMinutes` (both loadCatalog + loadFeaturesFor); `user.ts` loads + validates `preferred_length`; `run.ts` passes it through + into persisted `params`.
- **Enrichment:** `getSteamSpyAppDetails` now returns `medianForever`; `enrich.ts` writes `median_playtime`. So future enrichment fills it automatically.
- **Backfill:** `scripts/backfill-median.ts` — reads `median_forever` from SteamSpy `all` pages (~3 calls, not 2.5k), UPDATEs existing rows only (no inserts). Run: `node --env-file=.env.local scripts/backfill-median.ts [pages=3]`.
- **UI:** `LENGTH_OPTIONS` in `preferences-options.ts`; single-select "Game length" chips (Any / Short ≤5h / Medium 5–20h / Long 20h+) in the "Lean toward" group; `actions.ts` parses `length` → `preferred_length` column (own column, NOT a tag); `page.tsx` pre-fills from saved value.
- **NOT yet verified live:** logged-in click-through (pick a length → Update → Preference bar reflects length match).

## Classic CS algorithms: Dijkstra + Kruskal MST (2026-06-06) ✅ BUILT & LIVE-VERIFIED (script)
User's degree milestone. From their syllabus (PageRank/K-Means were NOT on it) we picked **Dijkstra** (shortest-path similarity) + **Kruskal MST** (single-linkage diversity) — covers Dijkstra, a binary heap, MST, edge-sorting, and union-find. Built core-first (like Phase 3), all PURE.
### Stage 1 — pure algorithm core ✅ (commit cd07a11)
- **`lib/reco/heap.ts`** — binary min-heap (priority queue for Dijkstra; lazy deletion, no decrease-key).
- **`lib/reco/graph.ts`** — `buildSimilarityGraph` (kNN over tag-vector cosine, edge weight = 1−cosine, symmetrised), multi-source `dijkstra` (heap), `DSU` (union-find, path compression + union by rank), `kruskalMST` (sorted edges + DSU), `mstClusters` (cut heaviest MST edges → single-linkage clusters).
- **`tests/reco/graph.test.ts`** — 7 tests on known tiny graphs (heap order, Dijkstra single/multi-source distances, DSU, Kruskal excludes cycle edge, MST clustering cuts, builder links same-genre).
### Stage 2 — integration ✅
- **Dijkstra → a new `graph` scoring term.** `GameFeatures` unchanged; `Weights.graph?` (optional, default 0.25 in DEFAULT_WEIGHTS) + `ScoreBreakdown.graph`. `score.ts` `graphScore(dist)=exp(-dist)`. `recommend.ts` restructured into 3 phases: (1) cheap non-graph base scores, (2) build the graph over the **top `GRAPH_MAX_NODES=800` candidates by base score ∪ owned** (caps the O(n²) build), multi-source Dijkstra from owned (taste sources, dist 0) → `graphScore`, (3) fold the graph term in. Transitive similarity: "you like A, A~B, B~C ⇒ C".
- **Kruskal MST → diversity.** `RecommendInput.diversify?: "mmr"|"mst"` (default "mmr"; **live path uses "mst"** via run.ts). `mstDiversify` picks one best item per MST cluster first (spread), then fills by score.
- **Bridge/UI:** `coerceWeights`/`DEFAULT_WEIGHTS` include `graph`; `WEIGHT_FIELDS` adds a "Graph similarity (Dijkstra)" knob; `parseWeights` reads `w_graph`; `page.tsx` Breakdown + BREAKDOWN_PARTS add a fuchsia "Graph" segment; `run.ts` passes `diversify:"mst"`.
- **Verified:** `tsc` clean; `npm run build` clean; **21/21 reco tests** (11 original + 7 graph + 3 integration: graph term sums into score, graph-only NDCG@5 > 0, MST diversity ≥ relevance-only). **Live script run** (`run-reco.ts`, "Ran"): graph term fires strongly (Counter-Strike: Source graph=0.195, neighbours of the CS2 library rank high), scores sum, ~19s (mostly network DB load; graph build ~1s after the 800-cap). Pure `lib/reco/` intact.
- **Perf note:** `loadCatalog` (full catalog + child rows each run) dominates latency, not the algorithms; faster in-prod (function next to Supabase). Lower `GRAPH_MAX_NODES` if needed.
- **NOT yet verified:** logged-in dashboard click-through (graph bar on cards, Graph weight knob).

## Recommendation UX humanization (2026-06-06) ✅ BUILT (tsc + build clean)
User feedback after seeing the live graph term: the score-breakdown labels (content/graph/preference/popularity/recency) and the Advanced 0–1 weight inputs are dev jargon users can't understand. DECIDED with user: **plain labels + tooltips** for the breakdown, **preset modes** for the weights.
- **Preset "recommendation style"** replaces the raw weight inputs. `preferences-options.ts`: `WEIGHT_PRESETS` (Balanced / More like my games / Discover hidden gems / Popular & new) each mapping to a full weight set; `WEIGHT_PRESET_MAP`, `PRESET_VALUE_SET`, `DEFAULT_PRESET`, `presetFromWeights(weights)` (matches saved weights back to a preset for pre-fill). Removed `WEIGHT_FIELDS`/`WeightKey`.
- `actions.ts`: `weightsFromPreset(formData)` replaces `parseWeights`/`parseWeight` — reads the `preset` radio, looks up the weight set, preserves the hidden `collab`. `page.tsx`: Advanced `<details>` weight inputs replaced by a single-select "Recommendation style" chip group (pre-selected via `presetFromWeights`).
- **Plain-English card breakdown.** `BREAKDOWN_PARTS` now carries a friendly `label` + a `tip`: content→"Like your games", graph→"Linked to your favorites", preference→"Your genres", popularity→"Well-reviewed", recency→"Newer", collab→"Similar players". Legend shows the label + colored dot only (raw 0.xxx numbers moved into the hover `title`, which also explains the term); bar segments get the explanation on hover.
- README + this log updated (per the standing rule: every push updates the README).
- **NOT yet verified:** logged-in click-through of presets + tooltips.

## Landing "How it works / Why PlayNext is different" section (2026-06-06) ✅ BUILT (tsc + build clean)
User asked for a product-level trust explanation (distinct from per-card "Why this match?") — why the engine ranks differently and why to trust it, in plain words. DECIDED with user: put it on the **landing page** (fills the empty space below the two path cards; trust-building pre-signup).
- `app/page.tsx`: new "How it works" section + `FeatureCard` helper. Four points: 🧮 A real algorithm not a guess (similarity + shortest paths, no black box), ⏱️ Learns from what you actually play (playtime is the signal), 🔍 You see exactly why (the explainable score bar), ✨ AI explains never decides. Closes with "CS final project — the algorithm is ours, fully explainable." Replaced the old one-line footnote. README already conveys these points (in sync; no change needed).
- Screenshot-verified in the real Next app (renders below the path cards, on-brand neon panels).

## Pending/loading feedback on slow actions (2026-06-06) ✅ BUILT (tsc + build clean)
User: the "Update recommendations" + "Why this match?" buttons gave no sign the press worked (server actions take seconds: catalog load + engine, or the AI call).
- **`components/submit-button.tsx`** (NEW client comp) — `SubmitButton` uses React `useFormStatus()` to show a spinner + `pendingText` and disable itself while the parent form's server action runs (progressive enhancement; must live inside the form).
- Wired into `page.tsx`: **Update recommendations** ("Updating…"), per-card **✨ Why this match?** ("Thinking…"), and **Sync library** ("Syncing…"). README in sync (UI state, no documented behavior change).
- **NOT yet verified:** logged-in click-through of the spinners.

## Themed tooltips on the score-bar legend (2026-06-06) ✅ BUILT (tsc + build clean)
User: the hover explanation on the card metrics used the browser-native `title` box (white, system font) — clashes with the dark+neon theme.
- `page.tsx` RecCard: replaced the native `title` on each legend item with a **styled CSS tooltip** (`group/tip` + `group-hover/tip:block`, `.bg-card`/border/shadow, positioned `bottom-full`). Removed the native `title` from the thin bar segments too (legend tooltips cover it). To let the tooltip overflow, moved the card's `overflow-hidden` OFF the root and ONTO the image container (`rounded-t-xl overflow-hidden`) so image corners still clip.
- (Minor remaining native `title`: the preset-style chips — left as-is; descriptions also show in the panel subtext.)

## Step 2a — evaluation harness BUILT + first results (2026-06-06)
New READ-ONLY harness **`scripts/eval-reco.ts`** (`node --env-file=.env.local scripts/eval-reco.ts`): leave-one-out (LOO) on real data. For each played+enriched owned game, hold it out, build the taste vector from the rest, rank the full 2533-catalog with the PURE engine, record the held-out game's rank. Averages NDCG@10/Recall@10/MRR/mean+median rank across folds; compares baselines (random/popularity/recency) + ablations (content-only, content+graph, Balanced ± graph, presets). Calls `recommend()` with `topK=EVAL_DEPTH(50)` + `mmrLambda=1` → exact top-N relevance order (no engine change).
- **PERF GOTCHA (cost ~10 min):** first cut used `topK=candidates.length` → `mmrRerank` is O(k²) in cosine pairs (computes maxSim even when λ=1), so full-size topK ≈ O(n³) → hours. λ=1 already yields pure score order, so bounding to top-50 is exact for @10 metrics and trivially fast. Don't ask the engine for a full-size topK through the MMR path.
- **DATA REALITY:** 1 user with a library (Ran, 19 owned, **15 played+enriched = the only LOO targets**). Demonstrative, NOT statistically robust — "scales with more users" is the future-work line.

### RESULTS (15 LOO folds, K=10) — THE KEY FINDING
```
Config                       NDCG@10  Recall@10    MRR  MedRank
Random (floor)                 0.000      0.000  0.001     51
Popularity-only                0.090      0.133  0.093     38   ← best aggregate
Recency-only                   0.000      0.000  0.000     51
Content-only                   0.021      0.067  0.010     51
Content+Graph                  0.029      0.067  0.027     51
Balanced                       0.033      0.067  0.022     51
Balanced - graph (ablation)    0.042      0.067  0.033     51
More like my games             0.000      0.000  0.009     51
Popular & new (current)        0.000      0.000  0.003     51
```
Per-target rank (Content+Graph): **NBA 2K16 #4, NBA 2K18 #12, NBA 2K17 #14** (out of 2533 — top 0.5%!); ALL 12 other held-out games miss (>50).
- **INTERPRETATION (nuanced, GOOD for the writeup — not "engine is broken"):** (1) The content/graph math DEMONSTRABLY works where the user has a coherent CLUSTER — the 3 NBA 2K games rank 4/12/14 because holding one out leaves 2 strong siblings. (2) It WHIFFS on genre-orphans (Dota/CS2/Hades/Among Us… each the lone game of its kind) because the taste is a SINGLE averaged centroid over a wildly diverse library → muddy, points at nothing specific, and a held-out orphan has no sibling to anchor it. (3) Popularity "wins" the aggregate largely as an ARTIFACT: Ran's played games are themselves popular (CS2/Dota/Apex/Hades have millions of reviews), so the answer key is popularity-biased — a known offline-eval caveat. (4) Graph didn't help here (Balanced−graph ≥ Balanced) — same single-centroid root cause; Dijkstra sources are the same averaged owned set.
- **→ DRIVES the real improvement:** replace the single averaged taste centroid with a **MULTI-CENTROID / clustered taste** (cluster the user's games — we ALREADY have MST clustering in `lib/reco/graph.ts`! — and score against the NEAREST cluster, not the blurry average). This is the signature algorithmic contribution for step 2; learning-to-rank (2b) layers on top.

### Multi-centroid taste BUILT + measured (2026-06-06)
- **Engine change (pure, backward-compatible):** `RecommendInput.tasteMode?: "single"|"clustered"` (default "single" → 21/21 tests unchanged). `recommend.ts` `buildTasteCentroids()` clusters owned games via `buildSimilarityGraph`+`kruskalMST`+`DSU` (reuses the degree machinery), cutting MST edges with distance > `CLUSTER_MAX_DIST=0.8` → one playtime-weighted centroid per cluster; content score = MAX cosine over centroids (nearest cluster). Dijkstra term untouched (already multi-source). `tsc` + tests green.
- **RESULT — clustering helped where predicted but did NOT flip the headline:** Content+Graph [clustered] vs [single]: NDCG@10 0.029→**0.045**, **Recall@10 0.067→0.133 (doubled)**, NBA 2K18 climbed #12→#10 (into top-10). But it only TIES Popularity-only on Recall (0.133) and still trails it on NDCG (0.090) / MRR (0.093). The 12 genre-orphans stay at #51.
- **THE REAL DIAGNOSIS (methodological, important):** the single-user LOO metric has a **structural ceiling that no engine change can break**: (a) 12/15 held-out targets are genre-orphans — the user owns exactly one game of that kind, so once it's held out there is NOTHING similar left to anchor it; unrecoverable by ANY content method. (b) **Popularity bias in the answer key** — Ran's played games are themselves popular, so "recommend popular" scores well on Ran's own library. So tuning/learning against THIS number is chasing a rigged target.
- **⚠️ CRITICAL for learning-to-rank (2b):** if we learn weights to maximize this single-user metric, gradient descent will just crank UP the popularity weight (it scores best here) → the "learning" would turn PlayNext into a popularity recommender, sabotaging the personalization thesis. **The evaluation signal must be de-biased / multi-user BEFORE LTR is meaningful.** This reorders step 2: fix the eval (synthetic coherent-taste users and/or de-biased protocol) → THEN LTR.
- **Multi-centroid is a KEEPER** (strictly ≥ single on our data, no regression) but the live default is still "single" pending the decision to flip + wire `run.ts`.

### Step 2a — SYNTHETIC-USER eval (de-biased) — THE "BEATS POPULARITY" PROOF (2026-06-06)
DECIDED with user: get a fair, scaled measurement via synthetic coherent-taste users. New harness **`scripts/eval-synth.ts`**: generates many users each defined by ONE community tag (e.g. RTS, Survival Horror, CRPG, Dating Sim, Third-Person Shooter…), samples 12 games (8 taste + 4 held-out), ranks all 2533 with the pure engine, measures recovery of the held-out same-taste games. **Circularity guard:** users grouped by a single human-meaningful tag (independent of the engine's composite score); engine must still rank via its FULL TF-IDF+graph over the whole vocabulary; popularity sees the same candidates without taste → fair head-to-head, and theme-defined targets aren't popularity-biased.
- **RESULT (168 users, 28 themes, K=10):**
```
Config                     NDCG@10  Recall@10    MRR    MAP  win%vsPop
Random (floor)               0.001      0.003  0.008  0.004         1%
Popularity-only              0.002      0.004  0.005  0.001         0%
Recency-only                 0.001      0.001  0.009  0.003         1%
Content-only [single]        0.172      0.238  0.234  0.132        55%   ← winner
Content+Graph [single]       0.135      0.173  0.213  0.107        45%
Content-only [clustered]     0.160      0.220  0.224  0.124        51%
Content+Graph [clustered]    0.134      0.171  0.209  0.105        44%
Balanced [clustered]         0.134      0.167  0.218  0.110         40%
```
- **HEADLINE (core thesis PROVEN):** content NDCG@10 **0.172 vs popularity 0.002 (~85×)**; popularity ≈ random for personalized reco. This is the clean "beats popularity" evidence the single-user test couldn't give.
- **NUANCED FINDING (writeup gold):** on FOCUSED synthetic tastes the SIMPLEST config (content-only, single centroid) wins; graph + clustering slightly HURT — the OPPOSITE of the DIVERSE real Ran user (where clustering doubled recall). So graph (Dijkstra) + MST clustering are **diversity/discovery mechanisms**: they pay off on multi-modal libraries, cost a little precision on laser-focused ones. We've now bracketed both extremes → the optimal weighting is **taste-dependent**.
- **LTR UNBLOCKED:** popularity ≈0 on this de-biased signal, so learning-to-rank will correctly down-weight popularity / favor content (no popularity-collapse). Ideal LTR training mixes coherent (synthetic) + diverse (real) users so it doesn't strip the graph/diversity benefit.
- **PERF DEBT:** eval-synth was slow (~4–7 min/config) — `recommend()` routes through MMR even at λ=1 (computes maxSim cosines it then multiplies by 0). EVAL_DEPTH=100 → shortlist 400 → ~2M wasted cosines/user. FIX next: a λ≥1 fast-path in `mmr.ts` (skip sim, return top-k by score — identical output, also speeds the live "More like my games" path) and/or lower EVAL_DEPTH. Engine micro-opt needs the usual "ask before changing lib/reco" nod.

### Step 2 — MMR perf fix + learning-to-rank (2b) BUILT (2026-06-06→07)
- **MMR λ≥1 fast-path** (`lib/reco/mmr.ts`): when lambda≥1 (pure relevance) return top-k by score (stable sort) instead of the O(k·n) greedy sim loop. **Output verified IDENTICAL** (re-ran eval-reco — every number matched: Content+Graph[clustered] still 0.045/0.133, NBA #5/#10/#12). Also speeds the live "More like my games" path. 24/24 reco tests green.
- **Pure learner `lib/reco/learn.ts`** + `learn.test.ts` (3 tests): `trainPairwiseLogistic(queries, dim, opts)` — RankNet-style pairwise logistic LTR, SGD over (relevant,irrelevant) pairs, L2 + non-negative clamp, normalized to sum 1, deterministic. Added to `index.ts` barrel.
- **`scripts/train-ltr.ts`**: generate 168 synthetic users → extract RAW component features in ONE engine call/user (weights all=1 → breakdown = raw scores; the MMR fast-path makes topK=all cheap) → 70/30 user train/test split → learn on train → rank test by w·features for learned vs hand-tuned vectors.
- **LEARNED WEIGHTS (normalized):** content **0.853**, graph 0.143, preference 0.000, popularity **0.004**, recency 0.000. → **Data-driven confirmation of the thesis:** the optimum weights content highest and popularity ≈ ZERO — the OPPOSITE of the live "Popular & new" default (pop .5/rec .4) and even hand "Balanced". 
- **HELD-OUT TEST (51 unseen users) @10:** Learned NDCG 0.162 / Recall 0.211 / MRR 0.243; Balanced 0.165/0.201/0.256; **Content-only 0.173/0.240/0.239** (marginally best); Content+Graph 0.151; Popularity-only 0.002; Popular&new 0.054.
- **HONEST INTERPRETATION:** LTR learned a sensible, defensible weighting and CRUSHES popularity (0.16 vs 0.002), but does NOT beat the simple content-only baseline here — because the synthetic population is HOMOGENEOUS (all coherent tastes), so one weight set (content-dominant) already fits everyone and there's no heterogeneity for LTR to exploit; its small graph weight even drags it a hair below pure content-only (graph hurts focused tastes). **LTR's real value needs a MIXED population** (coherent + diverse users) where no single hand-weight is optimal → then learned (and ultimately PER-USER adaptive) weights should win. That mixed-population experiment is the natural next step to make the "self-improving" story land.

### Step 2b — MIXED-population LTR — HONEST NEGATIVE RESULT (2026-06-07)
Rewrote `scripts/train-ltr.ts`: 220 users (120 coherent 1-tag + 100 diverse 2–3-tag blends); 6 features incl. BOTH `content_single` and `content_clustered` (2 engine passes/user); 70/30 split; per-segment (coherent/diverse) NDCG reported.
- **Learned weights:** content_single 0.405, content_clustered 0.353, graph 0.159, preference 0.000, popularity 0.002, recency 0.081 — again sensible, content-dominant, popularity≈0.
- **TEST (66 users):** Learned NDCG(all) 0.121 (coh 0.184 / div 0.045); **Content single-only 0.134 (coh 0.181 / div 0.078) — STILL BEST overall AND on diverse**; Content clustered-only 0.116; Content+Graph 0.123; Balanced 0.125; Popularity 0.002.
- **WHY LTR didn't win (honest):** (1) Content (single centroid) is just a very strong, robust signal — hard to beat. (2) My synthetic "diverse" users aren't ORPHAN-diverse like real Ran — each held-out game still has remaining siblings, so single-centroid content recovers them fine and clustering/graph add little. The narrow band where clustering helps (diverse library + muddy centroid + held-out has siblings only in a sub-cluster, e.g. Ran's NBA trio) is real but narrow. (3) Pairwise-logistic loss ≠ NDCG, so the learned blend slightly dilutes the dominant content signal. **No methodological way around it: where a recoverable signal exists, content captures it; where it doesn't (orphans), nothing helps.** So LTR/clustering/graph are REFINEMENTS, not headline wins.
- **THE REAL, SHIPPABLE TAKEAWAY:** every experiment agrees the optimum is **content-dominant, popularity≈0** — which is NEITHER the live "Popular & new" default (pop .5/rec .4) NOR even hand "Balanced". So the concrete win from step 2 is to **RE-TUNE the live default weights to content-dominant** (evidence: ~80× better NDCG than the current popularity-heavy default for real personalization). That + the writeup are the deliverables; further LTR chasing is diminishing returns the data won't support.

### Step 2 — SHIPPED: default weights re-tuned content-ward (2026-06-07)
Honest scoping: the live DEFAULT was already "Balanced" (content .4/graph .25 vs pop .15) — content-led, NOT popularity-heavy; the popularity-heavy thing was the ranaviv1991 ACCOUNT having "Popular & new" selected (a user choice). So this is a modest evidence-aligned nudge, not a dramatic fix.
- `lib/reco-data/user.ts` `DEFAULT_WEIGHTS` + `preferences-options.ts` "Balanced" preset → **content .5, graph .25, preference .2, popularity .05, recency .05** (was .4/.25/.25/.15/.1). More content, less popularity/recency (small, kept only for quality signal + discovery tie-breaks).
- **tasteMode kept "single"** in the live path (run.ts unchanged): controlled synthetic eval (statistical power) favored single; clustered's win was a single-user (Ran) anecdote. Multi-centroid stays available behind the flag + documented as the evidence-backed option for diverse libraries / future per-user adaptation — not defaulted on weak evidence.
- Verified: `tsc` + 24/24 reco tests + `npm run build` (11 routes) clean. Existing users' saved prefs unchanged (only the default/fallback + the Balanced preset definition moved).

## "My games" feedback loop — BUILT (2026-06-07) — ⚠️ NEEDS MIGRATION 0004 APPLIED
The explicit-feedback feature that closes the learning loop: user adds a recommended game to "My games" (decided to try it), then rates it; ratings feed the engine. DECIDED with user: immediate/deterministic effect first (keep `lib/reco` pure), ratings Like/Dislike/More/Less, manual "I'll try this" button.
- **Migration `0004_user_tried_games.sql`** — new table `(user_id, app_id, rating check in like/dislike/more/less, created_at, updated_at)`, PK `(user_id,app_id)`, owner-only RLS. **⚠️ NOT YET APPLIED — paste into Supabase SQL editor (project omrxytvshnuugnhusneh) before testing**, else `loadUserContext`/`updateRecommendations` throw.
- **Engine wiring (pure preserved — feedback only enriches engine INPUTS):** `user.ts` `loadUserContext` loads `user_tried_games`; `likedAppIds` (rating like/more) added to `UserContext`; ALL tried games + dislike/less folded into `dismissedAppIds` (exclude). `run.ts` (non-seed mode): liked games merged into the taste `owned` list with synthetic `LIKED_TASTE_MINUTES=600` (deduped, real owned wins). Seed mode unchanged. `lib/reco` untouched.
- **Actions (`app/dashboard/actions.ts`):** `tryGame` (upsert, ignoreDuplicates so it won't clobber a rating), `rateGame` (upsert rating, validated), `untryGame` (delete) — all user-scoped client (RLS), redirect with `mygames_msg`/`mygames_error` + `#my-games` anchor.
- **UI (`page.tsx`):** RecCard got a "+ I'll try this" button (or "✓ In your games" via `triedSet`); new **"My games" section** (`id="my-games"`) listing tried games with 4 rating buttons (current highlighted) + remove; mygames banners.
- **Verified:** `tsc` + `npm run build` (11 routes) clean. **NOT yet live-verified** (needs migration applied + click-through: add a rec → rate it → Update → liked neighbours rise / disliked excluded).
- **NEXT EVOLUTION (documented, not built):** once feedback data accrues, feed it to the LTR loop (`lib/reco/learn.ts`) — aggregate across users to learn global weights (real data replacing the synthetic benchmark).

### "My games" UX revision (2026-06-08, after user click-through on prod)
Migration 0004 applied by user; feature MERGED to main (`c5f877b`) + deployed. User feedback drove these fixes (all DECIDED with user):
- **Card buttons are now real full-width buttons** (not text-link styling): "+ I'll try this" = `btn btn-primary btn-sm w-full`, "✨ Why this match?" = `btn btn-ghost btn-sm w-full`.
- **Ratings collapsed 4 → 2** (👍 Liked it / 👎 Not for me). like/more + dislike/less was false granularity — the engine only has two directions. `RATING_OPTIONS`, `VALID_RATINGS`, `user.ts` likedAppIds (now `rating==='like'`) updated. Migration CHECK still allows more/less (harmless, unused).
- **Tried games leave the grid + backfill:** `updateRecommendations` persists `topK:16` (deeper list); `page.tsx` renders `visibleRecs` = recItems minus `triedSet`, sliced to 10 — so "I'll try this" drops the card and #11 slides up (no gap, no re-run). Removed the in-grid "✓ In your games" state.
- **Apply timing:** ratings apply on the next "Update recommendations" (no per-click engine run). My games subtitle says "…then hit Update recommendations to apply."
- **KEY GOTCHA — preview deployments can't do auth:** a preview's dynamic origin isn't in Supabase's allowlisted redirect URLs, so `requestPasswordReset` (redirectTo = request-origin /auth/callback) falls back to the prod Site URL → the reset link bounces the user to PROD (skipping /reset-password), where they tested the OLD build (no feature → "no buttons"). **Test auth-touching changes on prod (no real users yet) or localhost, NOT preview deploys.**
- Verified: tsc + build clean. Live re-verify on prod pending re-deploy.

### "My games" round 2 (2026-06-08) — rating latency + Reviewed split
- **Rating delay fixed:** the 👍/👎 buttons were plain `<button>`s (no pending feedback) AND `rateGame` did a full redirect → felt like a hang. Now they're `SubmitButton`s (spinner) and `rateGame` drops the success redirect (just `revalidatePath` → in-place update, no navigation).
- **Reviewed games split:** `page.tsx` splits tried games into `toReview` (rating null → "My games" section) vs `reviewed` (rating set → new "Reviewed games" section). Rating a game moves it from My games → Reviewed (the user-requested behavior).
- **WORKFLOW CHANGE (user pref):** dropped per-change feature branches — now committing straight to `main` (push → prod). Branches only for experimental work.
- Verified tsc + build clean.

### "My games" round 3 (2026-06-08) — OPTIMISTIC UI (instant buttons)
User: every button feels slow. Root cause = each click is a server action (auth round-trip + DB write + full-page `revalidatePath` re-render). Fix = optimistic UI on the lightweight feedback actions (try/rate/remove): UI updates on click, the write runs in the background, reverts only on error.
- **`app/dashboard/actions.ts`:** `tryGame`/`rateGame`/`untryGame` now take PLAIN ARGS (not FormData), no redirect, revalidate-only (`authedClient()` helper). Callable directly from client components.
- **NEW `app/dashboard/rec-card.tsx`** (client): `RecCard` + `Breakdown`/`RecItem` types + `BREAKDOWN_PARTS` moved here. "+ I'll try this" is now a `useState`+`useTransition` button that hides the card INSTANTLY then calls `tryGame` (the explain button stays a server-action form — AI is inherently slow). 
- **NEW `app/dashboard/my-games-panel.tsx`** (client): owns BOTH "My games" + "Reviewed" sections via `useOptimistic` (reducer: rate/remove). Rating instantly moves a game between sections; remove instantly drops it; server syncs via revalidate.
- **`page.tsx`:** removed the inline `Breakdown`/`BREAKDOWN_PARTS`/`RecCard`/`RATING_OPTIONS`/`MyGameRow` + the two inline sections; now imports `RecCard` (renders the grid) and `<MyGamesPanel games={myGames} />`. Still server-computes `visibleRecs` (recItems minus triedSet, top 10). `mygames_*` banners/searchParams now dead (actions don't redirect) — left harmless.
- Note: "Update recommendations" stays inherently heavy (re-runs the engine over ~2500 games) — optimistic UI can't shortcut real results; only its progress state could improve. User chose NOT to also trim per-action auth/revalidate this round.
- Verified tsc + build (11 routes) clean. Committed straight to main.

## Adaptive taste engine — step A (2026-06-08)
The engine now auto-picks the taste representation per user from their library's structure (operationalizes the eval finding that the best config is taste-dependent). v1 = adapt the **taste mode** only; weight-preset auto-tuning deferred to step A2 (would need an "Adaptive" style option to not clash with the manual presets).
- **Pure helpers:** `lib/reco/graph.ts` `clusterByMst(features, idf, k, maxDist)` (threshold single-linkage → index groups; `buildTasteCentroids` refactored to use it, DRY). `lib/reco/recommend.ts` `analyzeTasteDiversity(ownedFeatures, idf) → {clusterCount, multiGameClusters, mode}`.
- **Heuristic:** `mode = clusterCount >= 2 ? "clustered" : "single"`. KEY TUNING FINDING: first tried `multiGameClusters >= 2` but real Ran came back `single` (clusterCount 5 but only 1 cluster ≥2 games — generic tags like Multiplayer/Action merge most games into one blob + singletons). Switched to `clusterCount >= 2` so a library with ANY distinct groupings uses clustered matching → **Ran now correctly classifies `clustered`** (which the eval showed doubled its recall). Monolithic libraries (1 cluster) stay single. Honest trade-off: clustered was marginally worse on idealized synthetic users but better on the real diverse user; favored the real-user evidence + intuitive UI.
- **Bridge (`run.ts`):** builds idf over (filtered candidates + ownedFeatures) the same way the engine does, calls `analyzeTasteDiversity`, passes `tasteMode: diversity.mode` to `recommend`, persists `{tasteMode, tasteClusters}` in `recommendations.params`.
- **UI (`page.tsx`):** explainability line under "Recommended for you" — "🧠 Adapted to your taste: your library spans N distinct clusters, so each pick is matched to your closest one" (clustered) / "a focused library, matched to your overall taste" (single). Reads from persisted params.
- **`tests/reco/taste.test.ts`** (3 tests, deterministic hand-crafted groups): focused→single, two distinct groups→clustered, <2 games→single. 27/27 reco tests green. Verified on Ran's real library via a headless script BEFORE shipping. tsc + build clean.
- **NEXT (step A2, optional):** auto-tune weights too via an "Adaptive" recommendation-style option (content-heavy for focused, graph-leaning for diverse), so it doesn't override users who pick a manual preset.

## Adaptive taste engine — step A2 part 2: name the detected styles (2026-06-15)
The dashboard taste line now names a user's ACTUAL styles instead of "a few different kinds of games." DECIDED with user: validate the labeling heuristic at SCALE before shipping — which OVERTURNED the first-pass pick.
- **Pure helper** `lib/reco/recommend.ts` `describeStyles(ownedFeatures, idf)` (exported): ranks recurring tags (on ≥2 owned games, `MIN_STYLE_COUNT`) by **count × idf**, minus a `GENERIC_STYLE_TAGS` stoplist (mirrors eval-synth's), strongest first. `analyzeTasteDiversity` now also returns `labels`. Labels are WHOLE-LIBRARY, not per-MST-cluster — real diverse libraries cluster into one generic blob + singletons, which gave noisy per-cluster names ("Photo Editing").
- **Bridge:** `run.ts` persists `tasteLabels` in `recommendations.params`. **UI:** `page.tsx` names the styles in the taste line (brand-colored, up to 3), for BOTH modes ("You play X, Y and Z games…" clustered / "Your taste centers on X…" single), graceful fallback to the old generic copy when a persisted rec has no labels.
- **KEY FINDING — scaled validation reversed the eyeball pick.** New harness `scripts/eval-labels.ts` (320 coherent 1-theme + 120 diverse 2–3-theme synthetic libraries; label-RECOVERY metric: does the labeler name the planted theme back?). Distinctiveness-first (pure idf — looked best on Ran's lone library) recovered the theme only **10%** @top-1 / 41% @top-3 — it chases rare co-tags ("Strategy RPG" user → top label "Card Battler"). **count·idf + generic stoplist recovers ≈100% (coherent) / 86% (diverse).** Ran's real labels: junk `["Online Co-Op","Photo Editing","Minigames"]` → truthful `["Survival","Sports","Competitive"]`. Writeup lesson: one-user qualitative judgment misled; the scaled objective metric was decisive (parallels the eval-synth finding).
- **Verified:** 28/28 reco tests (added a documenting `describeStyles` test + adjusted the taste tests for the new heuristic), `tsc`, `npm run build` (11 routes) all green. README synced (new "adapts to the shape of your library" paragraph). **NOT yet:** logged-in dashboard click-through (copy degrades gracefully so it's safe regardless).

## Adaptive taste engine — step A2 part 1: adaptive WEIGHTS (2026-06-16) — completes step A2
The engine now auto-tunes the score WEIGHTS per user (not just the taste mode), as a new **"Adaptive" recommendation style** that is the DEFAULT. Manual presets still override. No migration — the choice rides in the existing `user_preferences.weights` jsonb as a sentinel.
- **Profiles** (`lib/reco-data/user.ts` `ADAPTIVE_WEIGHTS`, both popularity≈0 per the eval): FOCUSED library (`analyzeTasteDiversity.mode === "single"`) → content-dominant, minimal graph (`content .6 / graph .1`); DIVERSE (`"clustered"`) → boost the Dijkstra graph term (`content .45 / graph .4`). Mirrors the eval finding that graph/clustering help diverse libraries but slightly hurt focused ones.
- **Persistence (no DDL):** picking "Adaptive" stores `weights = { adaptive: true, collab }` (sentinel). `user.ts` `isAdaptiveStored` → `UserContext.adaptiveWeights` is true for the sentinel OR no prefs row (the product default). `run.ts`: `const weights = user.adaptiveWeights ? ADAPTIVE_WEIGHTS[diversity.mode] : user.weights` → passed to `recommend()` + persisted (resolved) in `params.weights`, with `params.weightStyle: "adaptive"|"manual"`.
- **UI/options (`preferences-options.ts`):** `PresetKey` gains `"adaptive"`; `WEIGHT_PRESETS[0]` is the weightless Adaptive entry; `DEFAULT_PRESET = "adaptive"`; `WEIGHT_PRESET_MAP` built only from presets WITH static weights; new `isAdaptiveWeights` + `presetFromStored(raw)` (sentinel/null → "adaptive"; numeric → closest preset; `presetFromWeights` now falls back to "balanced" for an unmatched NUMERIC set). `actions.ts` `weightsPayloadFromPreset` stores the sentinel for adaptive (preserving collab). `page.tsx` pre-selects via `presetFromStored(prefsRow?.weights)` (dropped the now-unused `savedWeights`/`DEFAULT_WEIGHTS`/`Weights`/`presetFromWeights` imports).
- **Verified:** `tsc` + `npm run build` (11 routes) + **32/32 reco tests** (new `tests/reco/adaptive-weights.test.ts`: profile shape, focused→single/diverse→clustered mapping, `presetFromStored` default+sentinel). **Live read-only DB check:** the two existing users with manual presets (Ran "Popular & new"; the other "Discover hidden gems") both resolve `adaptive=false` — manual choices NOT overridden, the core requirement. **NOT yet:** logged-in click-through (pick Adaptive → Update → score bar reflects the tuned weights).
- **Step A2 is now COMPLETE** (part 1 adaptive weights + part 2 named styles). README synced.

## Per-card explanations + graded ratings (2026-06-29)
### 1. Always-on deterministic "why this ranked" line ✅ BUILT (tsc + 32/32 reco tests + build clean)
User feedback: clicking "✨ Why this match?" on every card to learn why it ranked is tedious — show a short reason on each card by default, less descriptive but all visible. DECIDED with user (preview-approved): an **always-on DETERMINISTIC line built from the persisted `score_breakdown`**, NOT auto-firing the LLM on all 10 cards (cheaper, instant, and far more defensible — the engine explains itself; AI stays the optional deep dive). This also pre-answers part of the RAG question.
- **`app/dashboard/rec-card.tsx`:** `MATCH_PHRASES` (one short phrase per score term) + pure `matchReason(breakdown, matchedStyles?)` → the top 1–2 contributing terms in plain words, with a colored dot from the lead term. Rendered above the (still optional) AI blurb; the "✨ Why this match?" button is unchanged as the on-demand AI dive.
- **REFINEMENT (live feedback — commit b754cbf):** the generic line read repetitively because an Adaptive user's recs are all driven by the same two signals (content + graph), so every card showed those two phrases only reordered. Fix: the **content** phrase now names the user's ACTUAL matching styles ("Matches your Survival & Co-op taste · linked to your favorites") — the game's tags ∩ the user's detected styles (strongest first, ≤2). Self-contained: the full ranked style list is already in `recommendations.params.tasteLabels`; `page.tsx` adds one read-only `game_tags` query for just the shown games and passes `matchedStyles` to `RecCard`. Falls back to the generic phrase when a game shares none of the user's styles. **Live-verified by user** (reads distinctly per card).
- **Drive-by fix:** `lib/reco-data/user.ts` `ADAPTIVE_WEIGHTS` was annotated `: Record<…, Weights>`, so `.graph` read as possibly-undefined and `tests/reco/adaptive-weights.test.ts` failed `npx tsc --noEmit` — but `next build` doesn't type-check test files, so commit `f2f8cb9` shipped it. Switched to `satisfies Record<…, Weights>` (fields stay known-defined). **Lesson:** run `tsc --noEmit` (not just `next build`) before committing — build skips tests.
- **NOT yet:** logged-in click-through (visual). Copy is purely derived from persisted data, so it's safe regardless.

### 2. Graded 1–10 ratings wired to the engine ✅ BUILT (tsc + 32/32 + build clean; migration 0005 applied)
Replaced binary 👍/👎 with a **1–10 integer** score (no decimals — false precision the engine can't use; we already cut 4→2 ratings once for that reason). Keeps `lib/reco` pure — only shapes its INPUTS.
- **Migration `0005_user_tried_games_score.sql`** (APPLIED via Supabase SQL editor, user-confirmed): adds nullable `score smallint check 1..10` to `user_tried_games`; legacy `rating` kept.
- **Engine inputs:** `user.ts` `UserContext.likedAppIds` → **`likedTaste: {appId, minutes}[]`**. `scoreToTasteMinutes(s)` = `s>=6 ? (s-5)*200 : 0` (6→200 … 10→1000), so via `log(1+minutes)` a 10 pulls ~30% harder than a 6 without drowning a heavy library. Legacy ratings map on read (`like/more`→8, `dislike/less`→3, `LEGACY_SCORE`). All tried games still excluded from results (unchanged). `run.ts` folds `likedTaste` into the taste `owned` list with per-game minutes (removed the flat `LIKED_TASTE_MINUTES=600`). **Honest limit (for defense):** the engine has no NEGATIVE taste vector, so a low score = "don't learn positively from this", not "recommend the opposite".
- **Action:** `rateGame(appId, rating:string)` → **`scoreGame(appId, score:number)`** (validates int 1–10, upserts `score`). `VALID_RATINGS` removed.
- **UI (`my-games-panel.tsx`):** `TriedGame.rating` → `score:number|null`; the 👍/👎 chips → a clickable **1–10 segment meter** (fills rose<4 / amber<7 / emerald≥7, shows "7/10"), optimistic as before. `page.tsx` selects `score`, maps legacy `rating`→score for display (like→8, dislike→3) so old reviews stay "Reviewed".
- **NOT yet:** logged-in click-through (score a game → meter persists → Update nudges taste). Effect is a nudge, not a reshuffle, on a large library.

### Parked: feedback "reasons" → negative preferences (DECIDED with user 2026-06-29)
User asked whether to also collect a reason (free-text or preset) when a user rates a rec good/bad. DECIDED: **park it** — a reason only earns its place if it changes ranking, else it's cosmetic data and a defense liability ("what does it do?" → "nothing"). **Free-text rejected** (needs an LLM to parse → pushes toward "AI does the work", off-thesis + defense risk). The defensible version, if revived: **structured preset reasons → a NEGATIVE-preference term** — symmetric to the existing positive `preferenceScore` (penalize candidates carrying tags the user explicitly rejected, e.g. "not my genre: Shooter"). Keeps `lib/reco` pure (new input + penalty term). Honest caveat: with ~1 real user it demonstrates a mechanism more than it moves the needle. Documented future extension, not built.

## Phase 6 — Defend The Project (ADDED 2026-06-16, DECIDED with user) — the final phase
**What it is:** the project's final submission includes a **~2-hour live defense**, where professors move between students and actively try to **"break" the project** — probing for anything we can't explain or justify. To pass we must know **EVERYTHING** about PlayNext, cold: architecture & the layering invariant, the full algorithm (every classic algorithm, the scoring math, why each choice), how it was built and in what language, the data model + RLS, the Steam + AI integrations, the deployment stack (Vercel, Supabase) and every third-party service, the evaluation evidence (and the honest negatives), security posture, and known limitations.

**Deliverable:** [docs/defense-prep.md](defense-prep.md) — a living "defense bible": a structured map of every area + the hard questions a professor might ask and our crisp answers. Built up over the remaining sessions; it is the single source of truth for defense readiness. Treat it as a standing lens: **whenever we add or change anything, ask "can we defend this in the 2-hour grilling?" and capture the answer there.**

**Why it reshapes priorities:** depth and explainability beat new surface area. Every feature must be defensible end-to-end. This is also the strongest argument for resolving the RAG question (item 4) carefully — a feature that looks like the engine, or that we can't fully explain, is a defense liability.

## ▶ RESUME HERE (next session) — updated 2026-06-08
**Prod at https://play-next-five.vercel.app** (NOT "live" — no real users yet; treat as production anyway). repo github.com/Ranavivcs/PlayNext (private). Latest `main` = `1cde42e`. **Everything below is MERGED to main + deployed.** WORKFLOW: commit straight to `main` → auto-deploys (no feature branches; only `main` exists now). Preview deploys CAN'T do auth → test on prod or localhost.

**THIS SESSION (2026-06-08):** shipped the **"My games" feedback loop** (try → rate 👍/👎 → engine: liked = taste boost, disliked/tried = excluded; migration 0004 `user_tried_games` applied; optimistic UI for instant try/rate/remove; "My games" vs "Reviewed games" split) and the **adaptive taste engine — step A** (auto single-vs-clustered taste mode from library diversity via MST clustering; Ran→clustered; plain-language explainability line on the dashboard). 27/27 reco tests, tsc, build all green.

### ▶ Adaptive engine step A2 — ✅ COMPLETE (2026-06-16)
1. ✅ **DONE — Adaptive WEIGHTS.** New "Adaptive" recommendation style (the DEFAULT) tunes weights per library shape: focused → content-dominant (`ADAPTIVE_WEIGHTS.single`), diverse → graph-leaning (`.clustered`); manual presets still override (sentinel in `user_preferences.weights`, no migration). See the "step A2 part 1" section above.
2. ✅ **DONE (2026-06-15) — Name the detected styles.** Shipped via `describeStyles` (count·idf + generic stoplist), validated at scale (`scripts/eval-labels.ts`). See the "step A2 part 2" section above.

**→ NEXT candidates:** (a) **DISCUSS the RAG question first** (item 4 — does it help or undercut the algorithm thesis? decide before building); (b) **Phase 6 Defend-The-Project prep** (`docs/defense-prep.md` — the 2-hour defense bible); (c) submission-polish (writeup → Word/PDF, perf, cleanup). Game-length is parked permanently (dropped).

**THIS SESSION (2026-06-07) — Step 2 "evidence for the algorithm" DONE:** built two eval harnesses (`scripts/eval-reco.ts` real-user LOO, `scripts/eval-synth.ts` de-biased synthetic) + multi-centroid taste (`tasteMode:"clustered"`, behind a flag) + MMR λ≥1 fast-path + learning-to-rank (`lib/reco/learn.ts` + `scripts/train-ltr.ts`). **PROVED content beats popularity ~85× NDCG@10** (synthetic, 168 users); LTR independently learns content-dominant/popularity≈0 weights. Honest negatives logged (graph/clustering = diversity refinements not headline wins; LTR doesn't beat content-only on these populations). **Shipped:** default weights re-tuned content-ward. **Wrote** `docs/algorithm-writeup.md` (submission artifact). 24/24 reco tests, tsc, build all green. See the "Step 2" sections just above.

**Done up to now:** Phases 1–4 complete. **Deployed to Vercel** (free `*.vercel.app`, auto-deploys on push to main). **Dark+neon redesign** across all surfaces. **Account management:** display-name in header, delete-account (Danger zone, admin cascade frees the steam_id), forgot/reset-password — and **request-origin hardening** (`lib/origin.ts`): reset links AND Steam OpenID derive the origin from the live request, NOT `NEXT_PUBLIC_SITE_URL` (which is now just a no-request fallback — `NEXT_PUBLIC_*` is baked at build time, which caused localhost reset links). **Password UX:** strength meter + show/hide + confirm (`components/password-fields.tsx`). **DEGREE MILESTONE — classic CS algorithms Dijkstra + Kruskal MST integrated** into the pure engine (binary heap, union-find, edge-sort; `graph` scoring term + MST single-linkage diversity; 21/21 reco tests; `GRAPH_MAX_NODES=800` caps O(n²)). **Catalog cache** (5-min TTL) — the ~16s `loadCatalog` was the latency, not the algorithm (~1s). **UX humanization:** preset "recommendation styles" (Balanced / More like my games / Discover hidden gems / Popular & new) instead of 0–1 weight knobs; plain-English score-bar labels + **themed CSS tooltips**; **loading spinners** (`components/submit-button.tsx`, useFormStatus) on Update/Sync/Why-this-match. **Landing "Why PlayNext is different"** trust section. **Game-length pref PARKED** (SteamSpy playtime data is dead — all zeros; plumbing kept). Pure `lib/reco/` still pure. RAWG DEFERRED.

**Migrations applied:** 0001, 0002 (metadata), **0003 (game_length: games.median_playtime + user_preferences.preferred_length)** — all via the Supabase SQL editor. Catalog = **2533 enriched games**.

**NEW STANDING RULE (in memory):** every commit + push must also keep the **README** in sync.

### ROADMAP REPRIORITIZED 2026-06-06 (DECIDED with user — time is NOT the constraint; goal = strongest *CS project*, algorithm is the thesis)
Lead with **evidence for the algorithm**, not more surface area. RAG is demoted to a subordinate explain-only feature (must never answer "what should I play?" — only explain/compare recs the engine already chose). CF stays a stretch (data-starved: ~1 real library). New signature contribution folded in: **learning-to-rank** (see step 2).

1. **Verify recent UI live (logged-in click-through)** — ✅ SUBSTANTIALLY VERIFIED 2026-06-06 (on PROD, acct ranaviv1991/"Ran"). Confirmed: plain-English labels + themed CSS tooltips (screenshots); AI "Why this match?" works on prod; **graph/Dijkstra term IS firing** (verified via persisted `score_breakdown` from `run-reco.ts` — every result nonzero graph 0.036–0.133, Hades II 0.133). Engine runs over 2533 candidates, persists. The pop/recency-dominated bar was NOT a bug: the acct's saved weights `{content .25 graph .15 pref .2 pop .5 rec .4}` are an EXACT match for the "Popular & new" preset (working as designed). Remaining purely-visual (preset chips render + spinners) left to a one-click user check (switch to "More like my games" → Update). 
   **→ FINDING for step 2:** score terms live on different magnitude scales — raw content/graph cosines are small (~0.05–0.13 weighted) while popularity/recency reach 0.25–0.42, so personal-taste signals are structurally outgunned even on "Balanced". This is the prime motivation for the eval harness + learning-to-rank (measure whether up-weighting/normalizing content+graph improves NDCG on held-out games; learn weights that compensate for scale).
2. ✅ **DONE — Evaluation + learning harness (THE BIG ONE).** Both eval harnesses + multi-centroid + MMR fast-path + LTR built; content beats popularity ~85×; defaults re-tuned. (Full detail in the "Step 2" sections above.) Original spec kept below for reference.
   - **(2a) Offline eval on REAL data:** hold out part of each real library → recommend → NDCG/MAP/recall@k. Baselines: popularity, pure-content (no graph), random. **Ablations:** what the Dijkstra `graph` term adds; the MST diversity↔relevance trade-off; is `graph` weight 0.25 right; is `GRAPH_MAX_NODES=800` enough. Output = the numbers the writeup needs.
   - **(2b) Learning-to-rank (the "self-improving" ask, done RIGHT):** NOT studying its own outputs (that's an echo chamber / model-collapse trap — avoid). Instead **learn the `weights`** from feedback ON outputs: positive = `user_games` playtime, negative = `user_feedback` dismissed/hidden; features = the persisted `score_breakdown` terms. Logistic-regression / pairwise learning-to-rank over the existing linear score → another classic algorithm class. Same machinery as 2a (eval measures; optimizer maximizes). Learned weights live in `lib/reco/` so the invariant holds (engine ranks, AI explains). Caveat: data-hungry → demonstrate the closed loop end-to-end (feedback → retrain → measurably different ranking); "scales with more users" = future work.
3. ✅ **DONE — Algorithm writeup** → `docs/algorithm-writeup.md` (classic-algorithm→code map, pipeline, full evaluation w/ honest negatives, reproducibility). README links it. May later convert to Word/PDF for submission (use the docx/pdf skills).
4. **RAG as the showcase AI feature — DECISION PENDING (discuss next session).** ⚠️ Open question raised by user (2026-06-16): does a RAG chat actually *benefit* the app, or does it make PlayNext look like "just an AI app" and undercut the real-algorithm thesis? **Resolve THIS before building.** If built, it must be strictly scoped (Phase 5; read `docs/ai-rag.md`): `game_embeddings` exists (1536-dim placeholder, HNSW cosine); "ask about the recs the algorithm already chose" — subordinate in the UI, never the entry point; AI still never ranks. The defense angle (Phase 6) cuts both ways — a chat is a liability if a professor can make it look like the engine. Decide deliberately.
5. ~~Un-park game-length~~ — 🚫 **PARKED PERMANENTLY (2026-06-16, DECIDED with user).** Not a future item; plumbing stays but stays hidden. See the game-length section above.
6. Collaborative filtering (`w_collab`) = stretch / future-work paragraph (needs many users with libraries).

### AI / dev-server gotcha (READ if explanations error with "Could not resolve authentication method")
- AI needs `ANTHROPIC_API_KEY` in `.env.local`. **Run `npm run dev` in a NORMAL terminal** — the Claude Code agent session injects `ANTHROPIC_API_KEY=""` + `ANTHROPIC_BASE_URL`, which shadow `.env.local` (`@next/env` won't override an already-set var). If launching from the agent: `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN && npm run dev`.
- `.env.local` is normalized to bare `KEY=VALUE` (no comments) because Node's strict `--env-file` parser drops vars after a comment line.

### How-to (Step D)
- Run engine live (admin/script): `node --env-file=.env.local scripts/run-reco.ts [steamId] [--mode=co-op] [--platform=windows,linux]` (or `npm run reco:run`).
- Type-check: `npx tsc --noEmit`. Full app compile: `npm run build`. Dev: `npm run dev` (a server may already be running on :3000).
- Bridge lives in `lib/reco-data/` (impure: reads Supabase, client INJECTED). Pure engine in `lib/reco/` is unchanged. Hard filters in `lib/reco-data/filters.ts` (`applyHardFilters`, gameplay-category whitelist).

### Env / accounts / how-to (unchanged)
- Enrichment re-run (idempotent, skips fresh): `node --env-file=.env.local scripts/enrich-catalog.ts [catalogSize=300] [playedCap=50]`.
- Reco unit tests: `npm run test:reco` (or `node --test "tests/reco/**/*.test.ts"`). Type-check: `npx tsc --noEmit`.
- Plain-Node scripts that import `lib/**`: use relative `.ts` imports (NOT the `@/` alias — Node can't resolve it) + `--env-file=.env.local`.
- Supabase NOT linked in CLI; DDL migrations get pasted into the dashboard SQL Editor (project ref `omrxytvshnuugnhusneh`). Service-role key in `.env.local` is enough for DML from scripts.
- Dev server: `npm run dev` (background); Next auto-reloads `.env.local`.
- **Prod (Vercel):** project `play-next` under `rans-projects1` → https://play-next-five.vercel.app. Env vars set in the Vercel dashboard (Supabase ×3, `STEAM_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`). **`NEXT_PUBLIC_*` is baked at build time** — changing it needs a fresh (no-cache) redeploy; but reset + Steam now use request-origin so they don't depend on it. Supabase Auth → URL Configuration has both `…/auth/callback` URLs allowlisted; Site URL = prod.
- **Accounts (prod + dev share Supabase `omrxytvshnuugnhusneh`):** `ranaviv1991@gmail.com` has linked Steam "Ran" (76561198137404352, 19 games). `ranaviv.cs@gmail.com` (display "Ran-test") has NO Steam library → cold-start. Add **seed games** in Adjust to exercise Content/Graph on that account.
- Graph algorithms: `lib/reco/{heap,graph}.ts` (pure). `run.ts` passes `diversify:"mst"`. Tune via the "Recommendation style" presets (`preferences-options.ts` `WEIGHT_PRESETS`).
