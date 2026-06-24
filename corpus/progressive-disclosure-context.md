---
title: Treating an Agent Context File as a Contract
category: AI & Agentic Engineering
---

Treat an agent's always-loaded context file as a contract, not a dumping ground: keep it short and load detail on demand. Every line in the always-loaded file is paid for in tokens on every turn of every session, so it should hold only the non-negotiables — and point to everything else.

The structure that holds up:

- **A tiny always-loaded core.** A handful of lines, each a hard rule or a hard-won scar ("this controller has a wide blast radius — changes ripple"), plus a small repository map (top-level folders to purpose). Aim for roughly a dozen lines, not a manual.
- **An index of pointers.** Everything deeper — architecture notes, integration maps, execution-order gotchas, CLI references — lives in separate docs the agent loads only when the task calls for it.
- **Load on match.** Skills and deep-dive docs carry a description that decides when they activate; the body stays unloaded until the description matches the work at hand.

This mirrors how a skill itself is built: an entry point with a description, plus a body that only loads when relevant. The same discipline applies at project scope.

Guidelines:

- Put a fact in the always-loaded core only if getting it wrong causes an incident; everything else goes behind a pointer.
- Make each core line load-bearing — a verified count, a named constraint — not generic advice the model already knows.
- Tune descriptions deliberately: over-broad descriptions waste tokens by activating everywhere; over-narrow ones miss the moment they were needed.

When this breaks down: if the agent keeps missing a rule that lives in a pointer doc, that rule has earned promotion into the always-loaded core — and something less critical should drop out to make room.
