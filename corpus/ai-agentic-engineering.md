---
title: AI & Agentic Engineering
category: AI & Agentic Engineering
---

Alex ships applied-AI work, not demos. The throughline is treating LLMs as components in an engineered system with the same discipline as any other production dependency.

**Agentic AI in production.** He built a greenfield test-automation framework that pairs Playwright with agentic AI workflows, covering both component UIs and a public booking experience — materially cutting manual regression effort and raising release confidence. The agentic layer drives the browser and reasons about outcomes; the framework keeps it deterministic enough to trust in CI.

**Governance first.** He authored a written governance policy for AI coding agents — scoping what an agent may touch, what requires human review, and how its output is verified before it lands. Adoption without a policy is how teams get burned; the policy is what makes "AI-augmented" safe to say out loud.

**RAG and retrieval.** The pattern: chunk and embed a knowledge source into a vector store, retrieve the top matches for a query by similarity, and ground the model's answer in those passages with inline citations. Keep the model from answering outside its retrieved context; when retrieval comes up empty, hand off rather than hallucinate.

**Multi-LLM, tool-aware.** He works across Claude, ChatGPT, Gemini, and others, choosing the model for the task, and designs agent tools (function calling) so the model can take structured actions — escalation, lookups — instead of free-texting.

**Evals and observability.** Treat accuracy, latency, and cost as first-class. Measure retrieval quality and watch token cost per request; an agent you can't observe is one you can't trust in production.
