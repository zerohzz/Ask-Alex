---
title: The Ralph Loop for Iterative AI Development
category: AI & Agentic Engineering
---

For well-defined coding tasks, an autonomous "Ralph loop" — a tight plan, implement, test, debug, refactor cycle that an agent repeats until done — can do real work unattended, provided the stop condition is objective and checkable. The pattern earns its keep on greenfield builds, TDD cycles, and mechanical fixes; it is the wrong tool for tasks needing human judgement or live production debugging.

Three controls make it safe:

- **An objective completion promise.** Define success as conditions a machine can verify — tests pass, a build succeeds, a command returns clean — and instruct the agent to emit a sentinel string (e.g. `<promise>DONE</promise>`) only when every condition is met. Loop until the sentinel appears.
- **A max-iteration cap.** Bound the loop so a stuck agent can't run indefinitely.
- **A stuck-after-N escape hatch.** After N iterations with no progress, have the agent stop, summarise the blocker and what it tried, and propose alternatives — explicitly without emitting the completion promise.

Structure the task as phased incremental goals, each with its own deliverable, verification step, and stop-if-blocked condition, rather than one large objective. Within a phase, run a self-correction cycle: plan the smallest next step, implement it, run the checks, debug failures, refactor, repeat.

```
Loop until <promise>DONE</promise> or iteration == MAX:
  plan smallest next step
  implement
  run verify commands
  if all green and all criteria met: emit promise
  if stuck N rounds: summarise blocker, ask for input, stop
```

Completion criteria should name functional outcomes, the exact verify commands, test requirements, and documentation expectations — vague criteria ("make it work") leave the loop unable to decide it's finished.

When this breaks down: if success can't be checked by a command, don't automate the loop — keep a human in it.
