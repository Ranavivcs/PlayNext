// AI explanation layer. Runs AFTER the pure reco engine on an already-ranked
// game and writes a short, human "why this matches you" blurb. It NEVER ranks
// or reorders — that's lib/reco/. Grounded strictly in the facts we pass in, so
// it can't invent game details. LLM failure is the caller's problem to swallow
// (the ranked list still shows without an explanation).

import Anthropic from "@anthropic-ai/sdk";

// Haiku 4.5 — ~5x cheaper than Opus and entirely sufficient for this short,
// grounded blurb. Swap to "claude-opus-4-8" if you want maximum quality.
const MODEL = "claude-haiku-4-5";

export interface ExplainInput {
  game: {
    name: string;
    genres: string[];
    tags: string[];
    shortDesc: string | null;
    totalReviews: number | null;
    positiveRatio: number | null; // 0..1
  };
  /** Plain-language summary of what the player likes (top games or seed picks). */
  tasteSummary: string;
  /** The engine's weighted contributions (each ~0..1) — tells us WHY it ranked. */
  breakdown: { content: number; preference: number; popularity: number; recency: number };
}

// Stable system prompt (cache_control below); keep byte-identical across calls.
const SYSTEM = `You explain, in ONE or TWO short sentences, why a video game was recommended to a player.

Rules:
- Ground every claim ONLY in the facts given in the user message. Never invent gameplay, story, modes, or features that aren't listed.
- Address the player directly as "you".
- Be specific and natural, not salesy. No marketing superlatives.
- Do NOT mention the score numbers or the algorithm.
- Output ONLY the explanation text — no preamble, no quotes, no "Here's why".`;

function factSheet(input: ExplainInput): string {
  const { game, tasteSummary, breakdown } = input;
  const pct =
    typeof game.positiveRatio === "number"
      ? `${Math.round(game.positiveRatio * 100)}% positive`
      : "n/a";
  // Order the signals by contribution so the model leads with the real reason.
  const signals = (
    [
      ["similarity to games you play", breakdown.content],
      ["your selected genres/tags", breakdown.preference],
      ["broad popularity", breakdown.popularity],
      ["being a recent release", breakdown.recency],
    ] as const
  )
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  return [
    `Recommended game: ${game.name}`,
    `Genres/tags: ${[...game.genres, ...game.tags].slice(0, 12).join(", ") || "n/a"}`,
    `Description: ${game.shortDesc ?? "n/a"}`,
    `Reviews: ${game.totalReviews ?? "n/a"} (${pct})`,
    `What the player likes: ${tasteSummary || "n/a"}`,
    `Main reasons it was ranked highly (most important first): ${
      signals.join("; ") || "general match"
    }`,
    ``,
    `Write the 1-2 sentence explanation.`,
  ].join("\n");
}

/** Generate a grounded "why this matches you" blurb. Throws on API failure. */
export async function explainRecommendation(input: ExplainInput): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "disabled" }, // a one-liner needs no reasoning
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: factSheet(input) }],
  });

  const block = message.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}
