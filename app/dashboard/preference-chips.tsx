"use client";

import { useState } from "react";
import { GENRE_OPTIONS, MAX_GENRE_PICKS } from "./preferences-options";

// Genre multi-select with a pick cap. Client component because the cap needs
// live state: once MAX_GENRE_PICKS are chosen, the rest grey out. Selected chips
// render a hidden checkbox named "tag" so they post with the parent form.
// (Mode / Difficulty / Vibe are single-select and rendered server-side.)
export function GenrePicker({ initialSelected }: { initialSelected: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected.filter((v) => (GENRE_OPTIONS as readonly string[]).includes(v))),
  );

  const atCap = selected.size >= MAX_GENRE_PICKS;

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else if (next.size < MAX_GENRE_PICKS) next.add(value);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-medium text-gray-500">Genres</span>
        <span className={`text-xs ${atCap ? "font-medium text-gray-600" : "text-gray-400"}`}>
          pick up to {MAX_GENRE_PICKS} ({selected.size}/{MAX_GENRE_PICKS})
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {GENRE_OPTIONS.map((g) => {
          const isSelected = selected.has(g);
          const disabled = !isSelected && atCap;
          return (
            <label key={g} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
              <input
                type="checkbox"
                name="tag"
                value={g}
                checked={isSelected}
                disabled={disabled}
                onChange={() => toggle(g)}
                className="sr-only"
              />
              <span
                className={`inline-block rounded-full border px-3 py-1 text-sm transition-colors ${
                  isSelected
                    ? "border-gray-900 bg-gray-900 text-white"
                    : disabled
                      ? "border-gray-200 bg-white text-gray-300"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                }`}
              >
                {g}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
