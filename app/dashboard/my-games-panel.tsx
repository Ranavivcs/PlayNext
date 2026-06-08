"use client";

import { useOptimistic, useTransition } from "react";
import { rateGame, untryGame } from "./actions";

export interface TriedGame {
  appId: number;
  rating: string | null;
  name: string;
  headerImage: string | null;
}

// Two-way feedback: like → taste boost; dislike → excluded + nudged away.
const RATING_OPTIONS: { value: string; label: string }[] = [
  { value: "like", label: "👍 Liked it" },
  { value: "dislike", label: "👎 Not for me" },
];

type Action = { type: "rate"; appId: number; rating: string } | { type: "remove"; appId: number };

function reducer(state: TriedGame[], action: Action): TriedGame[] {
  switch (action.type) {
    case "rate":
      return state.map((g) => (g.appId === action.appId ? { ...g, rating: action.rating } : g));
    case "remove":
      return state.filter((g) => g.appId !== action.appId);
  }
}

export function MyGamesPanel({ games }: { games: TriedGame[] }) {
  // Optimistic: rating/removing updates the screen instantly; the server write +
  // revalidate happen in the background and re-sync on the next render.
  const [optimistic, apply] = useOptimistic(games, reducer);
  const [, startTransition] = useTransition();

  const rate = (appId: number, rating: string) =>
    startTransition(() => {
      apply({ type: "rate", appId, rating });
      void rateGame(appId, rating);
    });
  const remove = (appId: number) =>
    startTransition(() => {
      apply({ type: "remove", appId });
      void untryGame(appId);
    });

  const toReview = optimistic.filter((g) => !g.rating);
  const reviewed = optimistic.filter((g) => g.rating);

  return (
    <>
      <section id="my-games" className="mb-12 scroll-mt-6">
        <div className="mb-5">
          <h2 className="text-2xl font-bold tracking-tight">My games</h2>
          <p className="mt-1 text-sm text-faint">
            Games you decided to try — tell us how they landed. Your verdict shapes future picks
            (hit <span className="font-medium text-foreground">Update recommendations</span> to
            apply): 👍 pulls recs toward it, 👎 filters it out.
          </p>
        </div>
        {toReview.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {toReview.map((g) => (
              <GameRow key={g.appId} game={g} onRate={rate} onRemove={remove} />
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
              Your verdicts. Change one any time — it&apos;s applied on the next Update.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {reviewed.map((g) => (
              <GameRow key={g.appId} game={g} onRate={rate} onRemove={remove} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function GameRow({
  game,
  onRate,
  onRemove,
}: {
  game: TriedGame;
  onRate: (appId: number, rating: string) => void;
  onRemove: (appId: number) => void;
}) {
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
        <div className="flex flex-wrap gap-1.5">
          {RATING_OPTIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onRate(game.appId, r.value)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                game.rating === r.value
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-border text-muted-foreground hover:border-brand/60 hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}
