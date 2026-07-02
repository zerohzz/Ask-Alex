---
title: Ask Alex — Building This RAG Agent
category: Projects
source_url: https://alex-huang.dev/posts/ask-alex-rag-agent
---

Ask Alex — the agent answering this question — is itself one of Alex's projects: a production retrieval-augmented generation agent he designed and built solo (Jun 2026 – present), live at alex-huang.dev/ask.

**Architecture.** Cloud Run (Node + TypeScript / Hono, scales to zero) serving a static page and a floating site widget, streaming answers token-by-token over SSE. Answers are grounded in a personal engineering knowledge base using Postgres + pgvector for cosine-similarity retrieval and Vertex AI Gemini for embeddings and grounded generation. No API keys in code — auth runs through the Cloud Run service account.

**Designed for trust over flash.** Inline citations act as an audit trail against hallucination, and a single escalation tool hands the conversation to the real Alex instead of guessing when the knowledge base comes up empty.

**Deliberate trade-offs.** pgvector over a managed vector index — a real vector database on free-tier Postgres that Alex can debug by hand the day after deploy, consistent with his principle of owning the result after go-live, not just the design.
