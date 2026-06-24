---
title: Routing Edits Through Validator Hooks
category: AI & Agentic Engineering
---

Wire quality gates into post-edit hooks so they run automatically on every change, rather than relying on the agent or the human to remember to invoke them. A hook that fires after each write can route the changed file to the right linter or rubric and feed the findings straight back into the conversation as context — failures become visible inline, without anyone asking.

The pattern is a dispatcher:

- A post-edit hook inspects the changed file and routes by type — server code to its static analyser, components to their linter and unit tests, declarative automation to a dedicated scanner.
- The validator's output (and a scoring rubric, if you use one) is returned as context, so both the model and the human see the result on the next turn.
- A critical finding can trigger an automatic fix loop; a soft finding is surfaced as a warning.

Design choices that matter:

- **Route by diff size.** Trivial edits shouldn't pay for a heavyweight rubric — gate the expensive checks on meaningful change.
- **Retry steps independently.** In a multi-step gauntlet (format, lint, test, validate), let each step retry on its own rather than failing the whole chain on one flake.
- **Bootstrap async hooks synchronously.** If hooks run async with per-session state, initialise that state in a synchronous session-start step so nothing races.
- **Warn, don't silently transform.** An auto-fix that rewrites code on an ambiguous rule can corrupt it silently; prefer blocking or warning over a quiet edit.

When this breaks down: if validators fire on every keystroke-level edit they become noise and get ignored — tune the trigger so the signal stays worth reading.
