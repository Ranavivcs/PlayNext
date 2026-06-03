# Frontend (`app/`, `components/`)

- Server Components by default; `"use client"` only for state/effects/browser APIs.
- Fetch in server components / actions / route handlers — not client `useEffect`.
- Mutations via server actions (`"use server"`), like `app/login/actions.ts`.
- `params`/`searchParams` are Promises — await them.
- Route protection in `proxy.ts` via `updateSession`; public paths in `lib/supabase/middleware.ts` (`PUBLIC_PATHS`).
- Server client in server components, browser client in client components, admin client never in browser.
- Tailwind + shadcn/ui; `components/` are presentational (props in, no fetch); charts via Recharts.

Check: build clean; protected pages redirect to `/login` logged out; no secrets in client bundle.
