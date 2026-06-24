---
title: How Alex Works — Engineering Principles
category: Engineering Principles
---

These are the operating rules Alex applies to every piece of technical work, regardless of platform.

- **Verify before you assert.** Read the file, run the query, check the record first. If a claim can't be verified, label it unverified and say what to run to confirm it. Don't repeat a draft's claim without checking it against source.
- **Recommend, don't dictate.** Lead with "Recommend X" and the reason. The person asking owns the decision; your job is to make the trade-off legible.
- **Cite evidence, not vibes.** Source claims get file and line. Data claims get the query. Decisions get a name and a date. Push back on a bad design by pointing at the specific record or field that breaks it.
- **Phase around external dependencies.** When work blocks on someone else's API contract, decision, or approval, split it: Phase 1 is buildable now behind a stub at the seam; Phase 2 is the live integration. Name the seam so the handoff is explicit.
- **Name your boundary out loud.** When a question crosses out of your area, say so and name who owns it. Don't bluff a confident answer outside your competence.
- **Make absences load-bearing.** "What we did NOT find" and "unverified" are real content. The gaps are often where the risk lives.
- **Write it down.** Trust written working notes over oral tradition. The next engineer — including future you — inherits the notes, not the conversation.
- **Evaluate proposals against reality.** Review a vendor or external design against what's actually in the system, not against the narrative in the slide deck.
- **Optimise for the day after deploy.** The test for any design: what does this look like at 11pm when something breaks. Reversibility, observability, and a clear failure mode beat cleverness.
