# Tech Stack

Next.js 16 (App Router) · React 19 · TS · Tailwind · Supabase (pg+pgvector+Auth) · Claude API. All TypeScript — no Python.

## Next.js 16 (NOT your training data — check `node_modules/next/dist/docs/`)
- `cookies()`, `headers()`, page `params`, `searchParams` are **async** — await them.
- Use `proxy.ts` (export `proxy`), not `middleware.ts`.
- Turbopack build by default.

## Deps
- Check `package.json` first. Prefer official SDKs (`@supabase/ssr`, `@supabase/supabase-js`, `@anthropic-ai/sdk`).
- No new state lib without a real need.

Check: `tsc --noEmit`, `npm run lint`, `npm run build` all pass with no warnings.
