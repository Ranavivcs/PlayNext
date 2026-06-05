"use client";

import { useEffect, useState } from "react";

const MAX_SEEDS = 5;

interface Game {
  appId: number;
  name: string;
  headerImage: string | null;
}

// Search-and-pick up to MAX_SEEDS catalog games. Selected games render hidden
// `seed` inputs so they post with the parent Adjust form; the server action
// turns them into the taste source for that run (see generateRecommendations).
export function SeedPicker() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Game[]>([]);
  const [selected, setSelected] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);

  const atCap = selected.length >= MAX_SEEDS;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults(Array.isArray(json.games) ? json.games : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function add(game: Game) {
    if (atCap || selected.some((s) => s.appId === game.appId)) return;
    setSelected((prev) => [...prev, game]);
    setQuery("");
    setResults([]);
  }

  function remove(appId: number) {
    setSelected((prev) => prev.filter((s) => s.appId !== appId));
  }

  const showDropdown = query.trim().length >= 2;

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold">Base it on games you like</span>
        <span className="text-xs text-faint">
          optional · up to {MAX_SEEDS} ({selected.length}/{MAX_SEEDS})
        </span>
      </div>
      <p className="text-xs text-faint">
        Pick games and we&apos;ll recommend similar ones. When set, these replace your
        Steam library as the basis for this run.
      </p>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((g) => (
            <span key={g.appId} className="chip chip-on inline-flex items-center gap-1.5">
              {g.name}
              <button
                type="button"
                onClick={() => remove(g.appId)}
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove ${g.name}`}
              >
                ×
              </button>
              <input type="hidden" name="seed" value={g.appId} />
            </span>
          ))}
        </div>
      )}

      {!atCap && (
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            className="field"
          />
          {showDropdown && (
            <ul className="panel absolute z-10 mt-1.5 max-h-64 w-full overflow-auto p-1">
              {loading && <li className="px-3 py-2 text-sm text-faint">Searching…</li>}
              {!loading && results.length === 0 && (
                <li className="px-3 py-2 text-sm text-faint">No matches</li>
              )}
              {results.map((g) => {
                const already = selected.some((s) => s.appId === g.appId);
                return (
                  <li key={g.appId}>
                    <button
                      type="button"
                      onClick={() => add(g)}
                      disabled={already}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      {g.headerImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.headerImage}
                          alt=""
                          className="h-7 w-14 shrink-0 rounded object-cover"
                        />
                      )}
                      <span className="truncate">{g.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {atCap && (
        <p className="text-xs text-faint">
          Max {MAX_SEEDS} games — remove one to add another.
        </p>
      )}
    </div>
  );
}
