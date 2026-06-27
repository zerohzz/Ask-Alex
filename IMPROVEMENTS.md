# Ask Alex — Improvement Report

Local-only changes (verified against the real Neon DB + Vertex, read-only). **Not deployed** — staged for you to deploy. Backend branch `feat/ask-alex-quality` (repo `genai-kb-agent`), frontend branch `feat/ask-alex-quality` (repo `alex-huang.dev`).

## TL;DR — what was wrong and what I changed

| # | Problem (with evidence) | Fix | Verified |
|---|---|---|---|
| 1 | **Primary model 404'd on *every* request** (`gemini-3-flash-preview` not in project; prod logs showed fallback every turn) | Set `GEMINI_MODEL=gemini-2.5-flash`, fallback `gemini-2.5-flash-lite`, `GOOGLE_CLOUD_LOCATION=us-central1` | Turn logs: `model=gemini-2.5-flash, fellBack=false` |
| 2 | **Thinking-tokens truncated answers + added latency** (fit turn: prompt 2274 + output **60** + ~**1472 thinking** → cut mid-sentence) | `thinkingConfig.thinkingBudget = 0` on all generation + the condense call | Fit answer 278 → **2200+ chars**; first-token ~2100–2590ms → **~550–1400ms** |
| 3 | **Follow-ups retrieved the wrong docs & falsely escalated** ("how do I avoid that?" → nearest 0.498, escalated, even though the doc exists) | Conversation-aware **condense** + deterministic recent-user-turns fallback + distance threshold | Rewrites to "How to avoid Salesforce governor limits" → right doc at **0.247**, no escalation. Stable 3/3 |
| 4 | **JD button dead-ended on links** (LinkedIn 404, Seek 403 — 8s timeout) | Backend fast-path for bot-blocking boards + login-wall detection; frontend **re-opens the modal** with a hint + the value preserved | Immediate (**0.099s**) specific message; modal re-open confirmed in browser |
| 5 | **Multi-turn 400'd in real conversations** (history > `maxInputChars=2000` → backend rejected follow-ups) | `maxInputChars` 2000 → **16000** | 400 eliminated; multi-turn stable in browser E2E |
| 6 | **No observability** (blog claimed latency/token logging that didn't exist) | Structured per-turn JSON log: model, retrieved titles+distances, embed/search/first-token/generate latency, token usage, escalation | Used throughout this work as the debug loop |
| 7 | Out-of-scope questions could be answered from weak context | Retrieve wider (12) + **cosine-distance filter (≤0.55)** → empty context → clean escalation | "weather in Tokyo": kept=0 → escalates |
| 8 | Terse, thin "basic chatbot" voice | Reworked system prompt for richer, grounded, cited answers + smarter escalation gating | Answers now substantive + cited |
| 9 | **Legitimate soft questions falsely escalated** ("is he a good culture fit?" → all chunks filtered past the 0.55 cutoff → "outside the knowledge base") | Retrieval always keeps the top `retrievalMinKeep`(3) chunks (model judges relevance, not a brittle distance rule) + prompt pivots fit/style/"is he a good fit" questions into how-Alex-works material | Now answers from principles/delivery, cited; weather still escalates; golden still all-pass |

## Root-cause notes

- **The two complaints had four root causes, not two.** "Feels basic" was mostly (2) thinking-truncation + (3) broken follow-up retrieval + (8) terse prompt. "JD button broken" was (4). I also found (1) the 404-every-request model and (5) the multi-turn 400 — both silent until you read the logs/telemetry.
- **(2) was the biggest single quality win** and was invisible until the structured logging (6) exposed the token split (`prompt + output ≪ total`). Disabling thinking fixed truncated answers, the broken condense rewrite, *and* a chunk of the latency.

## Files changed

**Backend (`genai-kb-agent`)** — `src/config.ts`, `src/genai.ts`, `src/rag.ts`, `src/chat.ts`, `src/server.ts`, `src/db.ts`, `src/fetchJd.ts`, `ingest.ts`, `.env`, `.env.example`; new `src/observe.ts`, `test/golden.mjs`.
*(Pre-existing uncommitted changes in `docs/index.html`, `package.json`, `package-lock.json` were left untouched — not mine.)*

**Frontend (`alex-huang.dev`)** — `src/scripts/askAlex.ts` (F2 re-open), `src/config.ts` (`PUBLIC_ASK_ALEX_API` override), `src/styles/global.css` (`.aa-modal-hint`); new `aa-e2e.mjs` (Playwright E2E).

## Testing

- **Golden runner** (`test/golden.mjs`, 6 acceptance criteria): **ALL PASS**, stable across 3 consecutive runs.
- **Playwright browser E2E** (`aa-e2e.mjs`, 8 scenarios — ask+citations, multi-turn, escalation card, fit-text, fit-URL re-open, widget, mobile): **8/8 PASS, 0 console errors, 0 failed responses**. Screenshots in scratchpad `/shots`.
- **Backend** `npm run typecheck`: clean. **Frontend** `npm run build`: 95 pages, prod URL correctly embedded (dev override does not leak).

## Deferred / honest gaps

- **B1/B2 (embedding task types + title-in-chunk) are staged but NOT validated** — they require a destructive corpus re-ingest, and no isolated DB (Neon branch / local pgvector) could be stood up headlessly (no Docker/psql/neonctl). The code is gated behind `EMBED_TASK_TYPES=1` (off by default, current behaviour preserved). Validate on a Neon branch before enabling in prod.
- **A3 distance threshold (0.55)** was tuned on the *current* embeddings. B1 shifts the distribution — re-validate (env `RETRIEVAL_MAX_DISTANCE`) after re-ingest.
- **Local latencies** (`embedMs`/`searchMs` up to ~2–3s) are inflated by this dev machine hitting Neon `us-east-1` + Vertex from Australia. Not prod-representative; Cloud Run (`us-central1`) will be faster.
- 5 pre-existing `astro check` type errors in unrelated files (`index.astro`, etc.) — not touched.

## Deploy (you run — nothing deployed yet)

```bash
# Backend (genai-kb-agent) — set the valid model + region; enable task types only WITH a re-ingest
gcloud run services update kb-agent --region us-central1 \
  --update-env-vars GOOGLE_CLOUD_LOCATION=us-central1,GEMINI_MODEL=gemini-2.5-flash,GEMINI_MODEL_FALLBACK=gemini-2.5-flash-lite,MAX_INPUT_CHARS=16000

# OPTIONAL B1/B2 (recommended, but validate on a Neon branch first — see rollback):
#   1. CREATE TABLE kb_chunks_backup AS SELECT * FROM kb_chunks;   -- rollback safety
#   2. EMBED_TASK_TYPES=1 npm run ingest                            -- re-embed corpus (RETRIEVAL_DOCUMENT + titles)
#   3. add EMBED_TASK_TYPES=1 to the Cloud Run env (queries use RETRIEVAL_QUERY)
# Rollback: restore kb_chunks from kb_chunks_backup and drop EMBED_TASK_TYPES.

gcloud run deploy kb-agent --source . --region us-central1   # deploy the code

# Frontend (alex-huang.dev): merge feat/ask-alex-quality → normal GitHub Pages deploy. No env needed (prod URL is the default).
```
