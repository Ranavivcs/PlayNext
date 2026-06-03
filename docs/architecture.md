# Architecture

- `lib/reco/` ranks with math. `lib/ai/` only explains an already-ranked list. **AI never ranks.**
- `lib/reco/` is pure: data in → scores out. No DB, no fetch, no LLM, no unseeded random.
- Flow is one-way: `route → fetch (steam/db) → reco → ai → response`. Lower layers don't import higher.
- Admin (service-role) client is server-only — never in browser code.

Folders: `app/` routes · `lib/supabase` clients · `lib/steam` fetch · `lib/reco` engine · `lib/ai` RAG/LLM · `lib/types` types · `components/` UI · `supabase/` migrations · `tests/`.

Check: editing `lib/reco/` shouldn't force changes in `lib/ai` or `lib/supabase`.
