@AGENTS.md

# PlayNext

Hybrid Steam game recommender (real ranking algorithm) + AI/RAG layer that explains. AI never ranks.

## Always
1. At session start, read [docs/progress.md](docs/progress.md) to see what's done. Update it after each meaningful step.
2. Check it doesn't already exist (grep/read) before writing.
3. Ask before any major change.
4. Read the one guide below for the area you're touching — nothing else.

## Read before touching
| Area | Guide |
|------|-------|
| Layers / where code goes | [docs/architecture.md](docs/architecture.md) |
| Deps, Next.js/Supabase APIs | [docs/tech-stack.md](docs/tech-stack.md) |
| Tables, migrations, RLS | [docs/database.md](docs/database.md) |
| `lib/reco/` scoring | [docs/recommendation-engine.md](docs/recommendation-engine.md) |
| `lib/steam/` API + OpenID | [docs/steam-integration.md](docs/steam-integration.md) |
| `lib/ai/` RAG + LLM | [docs/ai-rag.md](docs/ai-rag.md) |
| `app/`, `components/` UI | [docs/frontend.md](docs/frontend.md) |

## Locked (ask before changing)
All-TS Next.js 16 · Supabase (pg+pgvector+Auth) · Claude API · content-based first, CF deferred · `lib/reco` and `lib/ai` stay separate.
