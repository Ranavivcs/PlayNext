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
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-gray-700">Base it on games you like</span>
        <span className="text-xs text-gray-400">
          optional · up to {MAX_SEEDS} ({selected.length}/{MAX_SEEDS})
        </span>
      </div>
      <p className="text-xs text-gray-400">
        Pick games and we&apos;ll recommend similar ones. When set, these replace your
        Steam library as the basis for this run.
      </p>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((g) => (
            <span
              key={g.appId}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1 text-sm text-white"
            >
              {g.name}
              <button
                type="button"
                onClick={() => remove(g.appId)}
                className="text-gray-300 hover:text-white"
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
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          {showDropdown && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
              {loading && <li className="px-3 py-2 text-sm text-gray-400">Searching…</li>}
              {!loading && results.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
              )}
              {results.map((g) => {
                const already = selected.some((s) => s.appId === g.appId);
                return (
                  <li key={g.appId}>
                    <button
                      type="button"
                      onClick={() => add(g)}
                      disabled={already}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:opacity-40"
                    >
                      {g.headerImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.headerImage}
                          alt=""
                          className="h-6 w-12 shrink-0 rounded object-cover"
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
        <p className="text-xs text-gray-400">
          Max {MAX_SEEDS} games — remove one to add another.
        </p>
      )}
    </div>
  );
}
