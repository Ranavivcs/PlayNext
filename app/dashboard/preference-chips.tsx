"use client";

import { useState } from "react";
import {
  GENRE_OPTIONS,
  VIBE_TAGS,
  DIFFICULTY_OPTIONS,
  MAX_PICKS,
} from "./preferences-options";

// Soft-preference chip picker with a selection cap. Client component because the
// cap needs live state: once MAX_PICKS are chosen, the rest grey out. Selected
// chips render a hidden checkbox named "tag" so they post with the parent form.
export function PreferenceChips({ initialSelected }: { initialSelected: string[] }) {
  // Only keep initial values that are still offered (vocabulary may have changed)
  // and respect the cap on load.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected.slice(0, MAX_PICKS)),
  );

  const atCap = selected.size >= MAX_PICKS;

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else if (next.size < MAX_PICKS) next.add(value);
      return next;
    });
  }

  function chip(value: string, label: string) {
    const isSelected = selected.has(value);
    const disabled = !isSelected && atCap;
    return (
      <label key={value} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
        <input
          type="checkbox"
          name="tag"
          value={value}
          checked={isSelected}
          disabled={disabled}
          onChange={() => toggle(value)}
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
          {label}
        </span>
      </label>
    );
  }

  function group(label: string, children: React.ReactNode) {
    return (
      <div>
        <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Pick up to {MAX_PICKS} — fewer, sharper picks give better recommendations.{" "}
        <span className={atCap ? "font-medium text-gray-600" : ""}>
          ({selected.size}/{MAX_PICKS})
        </span>
      </p>
      {group("Genres", GENRE_OPTIONS.map((g) => chip(g, g)))}
      {group("Vibe & theme", VIBE_TAGS.map((t) => chip(t, t)))}
      {group("Difficulty", DIFFICULTY_OPTIONS.map((d) => chip(d.value, d.label)))}
    </div>
  );
}
