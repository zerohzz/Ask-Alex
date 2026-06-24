---
title: Reusing Record Types Instead of Rebuilding
category: Solution Design & Delivery
---

When a new record type replicates most of an existing one, extend the existing automation to recognise it rather than forking a parallel set of flows and classes. Building a near-duplicate type as a fresh stack doubles the maintenance surface and guarantees the two drift apart.

The reuse approach:

- Find every place the existing type is checked — trigger conditions, flow entry criteria, component getters — and add the new type to those conditions. This is mostly a search-and-extend exercise, not new architecture.
- Centralise the type check behind one predicate (e.g. a getter that returns true for both types) so UI and logic branches don't each re-implement the test.
- Drive variant behaviour from configuration (custom metadata per brand or variant) rather than hard-coded mappings, so adding the next variant is a config change, not a code change.

Call out the difference between a defect and a config gap: if only some brands are configured in the metadata, that's an unconfigured-but-working state to flag upfront — not a bug to code around.

Guidelines:

- Confirm the overlap is genuine before reusing — if the new type diverges in core lifecycle, shared logic becomes a tangle of conditionals and a separate path is cleaner.
- When you extend a shared component for the new type, you touch every record type that flows through it in one change; weigh that reach in testing.

When this breaks down: once the conditionals checking "type A or type B or type C" outnumber the shared logic, the types have diverged enough that separate handling is the simpler design.
