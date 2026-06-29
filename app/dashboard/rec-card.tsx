"use client";

import { useState, useTransition } from "react";
import { tryGame, explainRec } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export interface Breakdown {
  content: number;
  preference: number;
  popularity: number;
  recency: number;
  collab: number;
  graph: number;
}

export interface RecItem {
  appId: number;
  rank: number;
  score: number;
  breakdown: Breakdown;
  name: string;
  headerImage: string | null;
  aiExplanation: string | null;
  /** This game's tags that overlap the user's detected styles, strongest first
   *  (≤2). Makes the "matches your games" reason game-specific. */
  matchedStyles?: string[];
}

// Plain-English labels + tooltips — the internal term names (content, graph…)
// mean nothing to a user, so the card shows friendly text and explains on hover.
const BREAKDOWN_PARTS: { key: keyof Breakdown; label: string; tip: string; color: string }[] = [
  { key: "content", label: "Like your games", tip: "How closely this matches the genres & tags of the games you play most.", color: "bg-violet-500" },
  { key: "graph", label: "Linked to your favorites", tip: "How closely it's connected to your favorites through a network of similar games.", color: "bg-fuchsia-400" },
  { key: "preference", label: "Your genres", tip: "How well it matches the genres, vibe and difficulty you chose.", color: "bg-emerald-400" },
  { key: "popularity", label: "Well-reviewed", tip: "How well-reviewed it is (weighted by review quality, not just count).", color: "bg-amber-400" },
  { key: "recency", label: "Newer", tip: "How recently the game was released.", color: "bg-sky-400" },
  { key: "collab", label: "Similar players", tip: "Recommendations from players with similar taste (coming soon).", color: "bg-rose-400" },
];

// Short, human phrase for why a game ranked — keyed to each score term.
const MATCH_PHRASES: Record<keyof Breakdown, string> = {
  content: "closely matches your games",
  graph: "linked to your favorites",
  preference: "fits your chosen genres",
  popularity: "highly rated by players",
  recency: "a recent release",
  collab: "enjoyed by similar players",
};

/**
 * Build a one-line "why this ranked" straight from the score breakdown — the top
 * one or two contributing terms, in plain words. Deterministic and free (no AI):
 * the engine's own numbers explain the pick; the AI blurb is the optional deeper
 * dive. Returns null only if nothing scored (shouldn't happen in practice).
 */
function matchReason(
  breakdown: Breakdown,
  matchedStyles?: string[],
): { text: string; color: string } | null {
  const ranked = BREAKDOWN_PARTS
    .map((p) => ({ key: p.key, color: p.color, v: Math.max(0, breakdown[p.key]) }))
    .filter((p) => p.v > 0 && p.key !== "collab")
    .sort((a, b) => b.v - a.v);
  if (ranked.length === 0) return null;
  // For the content term, name the user's actual matching styles when we know
  // them ("matches your Survival & Co-op taste") instead of the generic phrase —
  // so cards read distinctly rather than repeating the same two terms reordered.
  const phraseFor = (key: keyof Breakdown): string => {
    if (key === "content" && matchedStyles && matchedStyles.length > 0) {
      const styles = matchedStyles.slice(0, 2).join(" & ");
      return `matches your ${styles} taste`;
    }
    return MATCH_PHRASES[key];
  };
  const text = ranked.slice(0, 2).map((p) => phraseFor(p.key)).join(" · ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), color: ranked[0].color };
}

export function RecCard({ item, recId }: { item: RecItem; recId: string }) {
  // Optimistic: hide the card the instant the user adds it to "My games"; the
  // tryGame write + revalidate happen in the background (and remove it for real).
  const [added, setAdded] = useState(false);
  const [, startTransition] = useTransition();
  if (added) return null;

  const total = BREAKDOWN_PARTS.reduce((s, p) => s + Math.max(0, item.breakdown[p.key]), 0);
  const reason = matchReason(item.breakdown, item.matchedStyles);

  return (
    <li className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-transform duration-200 hover:-translate-y-1">
      <div className="relative h-28 overflow-hidden rounded-t-xl">
        {item.headerImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.headerImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-violet-700/40 to-fuchsia-700/30" />
        )}
        <span className="absolute left-2.5 top-2.5 grid h-6 min-w-6 place-items-center rounded-md bg-black/55 px-1.5 text-xs font-bold text-white backdrop-blur-sm">
          {item.rank}
        </span>
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          {item.score.toFixed(3)}
        </span>
      </div>
      <div className="space-y-2.5 p-3.5">
        <h3 className="truncate font-semibold">{item.name}</h3>
        <div className="flex h-2 overflow-hidden rounded-full" style={{ background: "var(--bar-track)" }}>
          {total > 0 &&
            BREAKDOWN_PARTS.map((p) => {
              const v = Math.max(0, item.breakdown[p.key]);
              if (v <= 0) return null;
              return <div key={p.key} className={p.color} style={{ width: `${(v / total) * 100}%` }} />;
            })}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {BREAKDOWN_PARTS.filter((p) => item.breakdown[p.key] > 0).map((p) => (
            <li key={p.key} className="group/tip relative flex cursor-help items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-sm ${p.color}`} />
              {p.label}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-52 -translate-x-1/2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-foreground shadow-[var(--shadow-card)] group-hover/tip:block">
                {p.tip} <span className="text-faint">({item.breakdown[p.key].toFixed(2)})</span>
              </span>
            </li>
          ))}
        </ul>

        {reason && (
          <p className="flex items-center gap-1.5 text-xs text-foreground/80">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${reason.color}`} />
            {reason.text}
          </p>
        )}

        {item.aiExplanation && (
          <p className="border-t border-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="text-brand">✨ </span>
            {item.aiExplanation}
          </p>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <button
            type="button"
            className="btn btn-primary btn-sm w-full"
            onClick={() => {
              setAdded(true); // instant: card disappears
              startTransition(() => {
                void tryGame(item.appId);
              });
            }}
          >
            + I&apos;ll try this
          </button>
          {!item.aiExplanation && (
            <form action={explainRec}>
              <input type="hidden" name="rec_id" value={recId} />
              <input type="hidden" name="app_id" value={item.appId} />
              <SubmitButton className="btn btn-ghost btn-sm w-full" pendingText="Thinking…">
                Why this match?
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
