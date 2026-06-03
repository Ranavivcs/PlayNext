# PlayNext

Personalized Steam game recommendations from a hybrid ranking engine.

PlayNext links your Steam account, learns your taste from the games you own and
how long you've played them, and ranks games you don't own yet. The ranking is a
**real algorithm** — TF-IDF over genres/community tags, playtime-weighted cosine
similarity, damped popularity, recency, soft preferences, and MMR for diversity.
A later AI/RAG layer will only *explain* the ranked results; **it never ranks.**

> CS final project. The point is that we own the algorithm and architecture — the
> AI layer is one explainable component, not the engine.

## Status

| Phase | What | State |
|-------|------|-------|
| 1 | Foundation (Next.js + Supabase + Auth, schema/RLS) | ✅ Done |
| 2 | Steam linking (OpenID) + library ingest | ✅ Done |
| 3 | Recommendation engine + metadata enrichment + dashboard | ✅ Done |
| 4 | Embeddings (pgvector) + AI/RAG explanations | ⏳ Planned |
| — | Collaborative filtering | ⏳ Stretch |

See [`docs/progress.md`](docs/progress.md) for the detailed running log (the
`▶ RESUME HERE` section at the bottom is the current todo list).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind · Supabase
(Postgres + pgvector + Auth) · Claude API (Phase 4). All TypeScript — no Python.

> Next.js 16 differs from older docs: `cookies()`, `headers()`, page `params` and
> `searchParams` are **async**; route protection lives in `proxy.ts` (not
> `middleware.ts`); builds use Turbopack.

## Architecture

One-way flow — lower layers never import higher ones:

```
route → fetch (steam / db) → reco → ai → response
```

- **`lib/reco/`** — the pure ranking engine. Data in → scores out. No DB, no
  network, no LLM, no unseeded randomness. Unit-tested with fixtures.
- **`lib/reco-data/`** — impure bridge: loads the catalog + user data from
  Supabase, applies hard filters, calls `lib/reco`, persists results. The
  Supabase client is **injected** so it runs under both a service-role script and
  a user-scoped server action.
- **`lib/steam/`** — Steam Web API + OpenID + metadata enrichment fetchers.
- **`lib/ai/`** — RAG/LLM explanations (Phase 4). Explains, never ranks.
- **`lib/supabase/`** — `client` (browser), `server` (RSC/actions), `admin`
  (service-role, **server-only — never in browser code**).

```
app/            Next.js routes (dashboard, auth, Steam API routes)
components/      presentational UI (props in, no data fetching)
lib/             see above
supabase/        SQL migrations + config
scripts/         one-off runners (catalog enrichment, live reco)
tests/           reco unit tests + live smoke tests
docs/            area guides — read the one for the area you touch
```

## Getting started

### Prerequisites
- **Node.js ≥ 22** (the project runs `.ts` scripts directly via Node's
  type-stripping; relative imports inside `lib/reco*` use explicit `.ts`
  extensions and avoid the `@/` alias so plain Node and `tsc` resolve identically)
- A Supabase project (Postgres + pgvector)
- A [Steam Web API key](https://steamcommunity.com/dev/apikey)

### 1. Install
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.local.example .env.local
```
Fill in `.env.local` (never commit it — it's gitignored):

| Variable | Where | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same | |
| `SUPABASE_SERVICE_ROLE_KEY` | same | **server-only**, bypasses RLS |
| `STEAM_API_KEY` | steamcommunity.com/dev/apikey | |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` for local | Steam OpenID return URL |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Phase 4 |
| `EMBEDDINGS_API_KEY` | TBD | Phase 4 — leave blank |

### 3. Apply the database schema
Run the SQL in `supabase/migrations/` (in order) against your Supabase project.
We apply them via the **Supabase dashboard SQL Editor** (the CLI isn't linked) —
the files in this repo are the source of truth.

### 4. Run
```bash
npm run dev          # http://localhost:3000
```
Then: sign up → link your Steam account → **Sync library** → **Update
recommendations** on the dashboard.

> Steam library import requires your Steam profile's **Game details** privacy to
> be **Public** (separate from overall profile visibility).

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Dev server |
| `npm run build` | Production build (Turbopack) |
| `npm run lint` | ESLint |
| `npm run test:reco` | Unit tests for the pure engine |
| `npm run reco:run` | Run the engine on live DB data (admin client). Flags: `--mode=co-op --platform=windows,linux` |
| `node --env-file=.env.local scripts/enrich-catalog.ts [catalogSize=300] [playedCap=50]` | Populate the shared game catalog from SteamSpy + Steam appdetails (idempotent, skip-if-fresh) |

Type-check anytime with `npx tsc --noEmit`.

## Conventions

- Read [`CLAUDE.md`](CLAUDE.md) and the relevant `docs/*.md` guide before working
  in an area. Update `docs/progress.md` after each meaningful step.
- Keep `lib/reco/` pure and separate from `lib/ai/`.
- Per-user tables are RLS owner-only; catalog tables are public-read,
  service-role write. Never disable RLS.
- Schema changes = a new numbered migration; never edit an applied one.
