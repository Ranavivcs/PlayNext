# Steam Integration (`lib/steam/`)

- Linking via Steam OpenID → store `steamid` in `steam_accounts`. OpenID is identity only; Supabase owns sessions. Verify the assertion; return URL from `NEXT_PUBLIC_SITE_URL`.
- All API calls server-side with `STEAM_API_KEY` — never in the browser.
- Endpoints: `GetOwnedGames` (+appinfo, +free), `GetRecentlyPlayedGames`, `GetPlayerSummaries`, store appdetails for metadata/tags.
- Cache in Supabase (catalog via admin client); store playtime in minutes; set `last_synced_at`; back off on 429.
- Private profile → set `profile_public=false`, fall back to cold start, don't error.
- Upsert game metadata before inserting `user_games` (FK).

Check: public account fills `user_games`; private degrades to cold start; key absent from client bundle.
