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

## ▶ RESUME HERE (next session)
**Done up to now:** Phases 1–2; **Phase 3 FULLY DONE** (CORE; Step C **2533-game** catalog; Step D bridge + games-first dashboard + hard filters; Step E soft-pref UX = rich tag-genres, 5-pick cap, single-select vibe/difficulty); **Step F seed-based recs** (no-Steam "pick games" path, live-verified); **Phase 4 AI explanations DONE & live-verified** (per-card "Why this match?", Haiku); **README refreshed + full visual redesign to a dark+neon theme across landing/auth/dashboard** (built clean; dashboard awaits a logged-in click-through). App renamed **GameMatch AI → PlayNext**, pushed to **github.com/Ranavivcs/PlayNext** (private). Pure `lib/reco/` still untouched. RAWG DEFERRED (Steam-only v1).

Next, roughly in value order:
1. **Deploy to Vercel** — live URL for partner/professors. Set env vars in Vercel dashboard (Supabase x3, `STEAM_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`=prod URL). The Steam OpenID `return_to` and Supabase auth redirect URLs must use the prod URL, not localhost.
2. **Classic CS algorithm (user wants this for the degree).** k-NN is ALREADY the mathematical core (taste vector + cosine = nearest-neighbour) — could surface an explicit "games like this". User said they'll **propose specific algorithms they studied** (PageRank / K-Means / etc.) to evaluate together — invite that, then pick one that integrates meaningfully (e.g. PageRank on a game-similarity graph as a popularity signal; K-Means for diversity). Keep `lib/reco` pure.
3. **Game-length soft pref** (deferred, user agreed): "playtime" = time-to-finish / invest. New enriched field (SteamSpy `average_forever`/`median_forever` — cheap, already hit in enrichment), migration, engine soft term (or short/med/long bucket), UI control.
4. **Embeddings + pgvector → semantic RAG chat** (the bigger AI feature; read `docs/ai-rag.md`). `game_embeddings` table already exists (1536-dim placeholder, HNSW cosine). Then an "ask about these recs" chat that retrieves over embeddings. AI still never ranks.
5. Collaborative filtering (`w_collab`) = stretch.

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
- Test account: PlayNext login `ranaviv1991@gmail.com`; linked Steam = "Ran" (76561198137404352), 19 games imported & verified.
