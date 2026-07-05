import type React from "react";
import { updateRecommendations } from "./actions";
import { SeedPicker } from "./seed-picker";
import { GenrePicker } from "./preference-chips";
import { SubmitButton } from "@/components/submit-button";
import { VIBE_OPTIONS, DIFFICULTY_OPTIONS, WEIGHT_PRESETS } from "./preferences-options";
import type { HardFilters } from "@/lib/reco-data/filters";

// Mode is single-select; "" = Any (parseFilters treats it as no constraint).
// "How do you want to play?" — the only hard filter.
const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "single-player", label: "Solo" },
  { value: "multiplayer", label: "Multiplayer" },
  { value: "co-op", label: "Co-op (play with friends)" },
];

/** A label-wrapped, visually-hidden input styled as a toggle pill (pure CSS). */
function Chip({
  name,
  value,
  label,
  type = "checkbox",
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  type?: "checkbox" | "radio";
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="pn-check sr-only"
      />
      <span className="chip">{label}</span>
    </label>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * Collapsible "Adjust recommendations" panel: seed games (optional taste source),
 * the one hard filter (mode), soft preferences (genres/vibe/difficulty), and the
 * recommendation-style preset. Submits the single `updateRecommendations` action.
 * Server-rendered; pre-filled from the last run's params.
 */
export function AdjustPanel({
  defaultOpen,
  gameCount,
  appliedFilters,
  savedGenres,
  savedVibe,
  savedDifficulty,
  savedPreset,
}: {
  defaultOpen: boolean;
  gameCount: number;
  appliedFilters: HardFilters;
  savedGenres: string[];
  savedVibe: string;
  savedDifficulty: string;
  savedPreset: string;
}) {
  return (
    <details className="panel mb-7 overflow-hidden" {...(defaultOpen ? { open: true } : {})}>
      <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 text-sm font-semibold">
        <span>Adjust recommendations</span>
        <span className="text-faint">▾</span>
      </summary>
      <form action={updateRecommendations} className="space-y-6 border-t border-border p-5">
        {gameCount === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No Steam library linked — pick a few games you like below to get recommendations (or
            link Steam under your account).
          </p>
        )}

        {/* Seed games — optional taste source for this run */}
        <SeedPicker />

        {/* How you play — the only hard filter */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">How you want to play</p>
            <p className="text-xs text-faint">
              The one hard filter — results are limited to games that fit.
            </p>
          </div>
          <ChipGroup label="Mode">
            {MODE_OPTIONS.map((m) => (
              <Chip
                key={m.value || "any"}
                type="radio"
                name="mode"
                value={m.value}
                label={m.label}
                defaultChecked={(appliedFilters.mode ?? "") === m.value}
              />
            ))}
          </ChipGroup>
        </div>

        {/* Lean toward — soft preferences */}
        <div className="space-y-4 border-t border-border pt-5">
          <div>
            <p className="text-sm font-semibold">Lean toward</p>
            <p className="text-xs text-faint">
              Soft preferences — nudge ranking (raise the &quot;Preference&quot; score), they
              don&apos;t exclude anything.
            </p>
          </div>
          <GenrePicker initialSelected={savedGenres} />
          <ChipGroup label="Vibe & theme">
            <Chip type="radio" name="vibe" value="" label="Any" defaultChecked={savedVibe === ""} />
            {VIBE_OPTIONS.map((v) => (
              <Chip
                key={v}
                type="radio"
                name="vibe"
                value={v}
                label={v}
                defaultChecked={savedVibe === v}
              />
            ))}
          </ChipGroup>
          <ChipGroup label="Difficulty">
            <Chip
              type="radio"
              name="difficulty"
              value=""
              label="Any"
              defaultChecked={savedDifficulty === ""}
            />
            {DIFFICULTY_OPTIONS.map((d) => (
              <Chip
                key={d.value}
                type="radio"
                name="difficulty"
                value={d.value}
                label={d.label}
                defaultChecked={savedDifficulty === d.value}
              />
            ))}
          </ChipGroup>
          {/* "Game length" control is PARKED: SteamSpy's median playtime is dead
              (all zeros), so it has no data source yet. The column/engine/action
              plumbing stays; re-add this ChipGroup once a real source
              (HowLongToBeat / IGDB) feeds games.median_playtime. */}
        </div>

        {/* Recommendation style — friendly presets instead of raw weights */}
        <div className="space-y-3 border-t border-border pt-5">
          <div>
            <p className="text-sm font-semibold">Recommendation style</p>
            <p className="text-xs text-faint">
              {WEIGHT_PRESETS.find((p) => p.value === savedPreset)?.description ??
                "Choose how the ranking is balanced."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {WEIGHT_PRESETS.map((p) => (
              <label key={p.value} className="cursor-pointer" title={p.description}>
                <input
                  type="radio"
                  name="preset"
                  value={p.value}
                  defaultChecked={savedPreset === p.value}
                  className="pn-check sr-only"
                />
                <span className="chip">{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        <SubmitButton className="btn btn-primary" pendingText="Updating…">
          Update recommendations
        </SubmitButton>
      </form>
    </details>
  );
}
