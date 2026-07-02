---
title: Alex's Applied AI and LLM Stack
category: AI & Agentic Engineering
---

What Alex has actually shipped and works with across the AI stack — production adoption, not experiments.

**RAG and retrieval.** Designed and deployed a production retrieval-augmented generation pipeline end to end: ingest → chunk → embed → retrieve over Neon Postgres + pgvector, with citation-grounded answers to control hallucination (the structured/unstructured retrieval pattern enterprise GenAI deployments require). Live as Ask Alex on alex-huang.dev — Cloud Run (Node/TypeScript + Hono), Vertex AI Gemini for both generation and embeddings, secrets in Secret Manager.

**Tool orchestration and guardrails.** Function/tool calling in production (inline citations plus an escalate_to_human tool for low-confidence queries), CORS-scoped multi-origin access, and grounding constraints — a conversational agent engineered for production reliability rather than a demo notebook.

**Agentic engineering in a day job.** At Funlab, independently designed and delivered a greenfield Playwright automation framework augmented by agentic AI workflows, covering Salesforce LWC components and the public booking experience — materially reducing manual regression effort. Paired it with a written **Claude Code governance policy**, so AI coding agents are adopted with rules, not vibes.

**Tooling breadth.** Claude Code and agentic workflow design; multi-LLM evaluation across Claude, GPT, and Gemini; Vertex AI (generation + embeddings); Playwright + AI test automation; Hugging Face; governance and safety policy authoring.
