# AI / RAG (`lib/ai/`)

- Runs **after** reco on an already-ranked list. Explains, summarizes, compares, chats. **Never ranks or reorders** — that's `lib/reco/`.
- RAG retrieves from the same `game_embeddings` vectors (pgvector cosine). No second vector store. Ground answers in retrieved facts; don't invent game details.
- Claude via `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` server-side. Current model IDs (Opus `claude-opus-4-7`, Sonnet `claude-sonnet-4-6`, Haiku `claude-haiku-4-5-20251001`).
- Prompt-cache the stable system prompt + context; stream chat; persist explanations to `recommendation_items.ai_explanation`.
- Prompts live in `lib/ai/`, not in UI. LLM failure → still show ranked results.

Check: disabling AI still yields ranked recs; no LLM call in `lib/reco/`.
