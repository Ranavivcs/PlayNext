"use client";

import { useOptimistic, useState, useTransition } from "react";
import { scoreGame, untryGame } from "./actions";

export interface TriedGame {
  appId: number;
  /** 1–10 review score, or null until the user rates it. */
  score: number | null;
  name: string;
  headerImage: string | null;
}

type Action = { type: "score"; appId: number; score: number } | { type: "remove"; appId: number };

function reducer(state: TriedGame[], action: Action): TriedGame[] {
  switch (action.type) {
    case "score":
      return state.map((g) => (g.appId === action.appId ? { ...g, score: action.score } : g));
    case "remove":
      return state.filter((g) => g.appId !== action.appId);
  }
}

export function MyGamesPanel({ games }: { games: TriedGame[] }) {
  // Optimistic: scoring/removing updates the screen instantly; the server write +
  // revalidate happen in the background and re-sync on the next render.
  const [optimistic, apply] = useOptimistic(games, reducer);
  const [, startTransition] = useTransition();

  const score = (appId: number, value: number) =>
    startTransition(() => {
      apply({ type: "score", appId, score: value });
      void scoreGame(appId, value);
    });
  const remove = (appId: number) =>
    startTransition(() => {
      apply({ type: "remove", appId });
      void untryGame(appId);
    });

  const toReview = optimistic.filter((g) => g.score == null);
  const reviewed = optimistic.filter((g) => g.score != null);

  return (
    <>
      <section id="my-games" className="mb-12 scroll-mt-6">
        <div className="mb-5">
          <h2 className="text-2xl font-bold tracking-tight">My games</h2>
          <p className="mt-1 text-sm text-faint">
            Games you decided to try — score each <span className="font-medium text-foreground">1–10</span>.
            Your verdict shapes future picks (hit{" "}
            <span className="font-medium text-foreground">Update recommendations</span> to apply): a
            high score pulls recs toward it, a low one keeps it out.
          </p>
        </div>
        {toReview.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {toReview.map((g) => (
              <GameRow key={g.appId} game={g} onScore={score} onRemove={remove} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No games waiting for a review — hit{" "}
            <span className="font-semibold text-foreground">+ I&apos;ll try this</span> on a
            recommendation to track it.
          </p>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="mb-12">
          <div className="mb-5">
            <h2 className="text-2xl font-bold tracking-tight">Reviewed games</h2>
            <p className="mt-1 text-sm text-faint">
              Your scores. Change one any time — it&apos;s applied on the next Update.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {reviewed.map((g) => (
              <GameRow key={g.appId} game={g} onScore={score} onRemove={remove} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Fill color conveys the verdict: low = rose, mid = amber, high = emerald. */
function fillColor(score: number): string {
  if (score >= 7) return "bg-emerald-400";
  if (score >= 4) return "bg-amber-400";
  return "bg-rose-400";
}

function GameRow({
  game,
  onScore,
  onRemove,
}: {
  game: TriedGame;
  onScore: (appId: number, score: number) => void;
  onRemove: (appId: number) => void;
}) {
  // Preview the score under the cursor as you hover the meter; falls back to the
  // saved score when not hovering.
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? game.score; // value to display + fill to
  const fill = shown ?? 0;
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      {game.headerImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={game.headerImage} alt="" className="h-12 w-24 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="h-12 w-24 shrink-0 rounded-md bg-gradient-to-br from-violet-700/40 to-fuchsia-700/30" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{game.name}</h3>
          <button
            type="button"
            title="Remove from My games"
            onClick={() => onRemove(game.appId)}
            className="shrink-0 text-sm leading-none text-faint transition hover:text-destructive"
          >
            ×
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex gap-0.5"
            role="group"
            aria-label="Score 1 to 10"
            onMouseLeave={() => setHover(null)}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`Rate ${n} out of 10`}
                title={`${n}/10`}
                onMouseEnter={() => setHover(n)}
                onClick={() => onScore(game.appId, n)}
                className={`h-4 w-3 rounded-sm transition ${
                  fill >= n ? fillColor(fill) : "bg-[var(--bar-track)] hover:bg-brand/40"
                }`}
              />
            ))}
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
            {shown != null ? `${shown}/10` : "Rate"}
          </span>
        </div>
      </div>
    </li>
  );
}
