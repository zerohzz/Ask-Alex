---
title: Seeding Sandboxes Safely with Masked Data
category: DevOps
---

When seeding a sandbox or QA org with representative data, restore objects in dependency order and mask sensitive fields at restore time — before the data lands. Loading children before parents produces missing-lookup failures and partial batches; loading unmasked production data into a wider-access environment leaks PII.

Restore order and matching:

- Sequence objects so every lookup target exists first — record types and users, then reference data, then transactional objects, then junctions last.
- Match on external ids / alternate keys so the load upserts instead of duplicating; for junction objects, use a composite key (e.g. the two parent names).
- Treat record types and users as reference-only — resolve lookups by developer name / name without performing DML on them in the target, to avoid cross-org id collisions.
- Filter out soft-deleted records (`WHERE IsDeleted = false`) so archived data doesn't reappear.

Masking strategy by field type:

- **Secrets / key references** become a fixed placeholder string, so nothing resolves to a real credential.
- **Emails** become a deterministic safe pattern (`user-{n}@qa.example.com`) to prevent real mail being sent from a sandbox.
- **Phone numbers** become a randomised value that preserves format.
- **Personal / payee names** become a fixed placeholder.

Make masking deterministic (same input, same output per run) so re-seeds don't churn data, and verify it doesn't break referential integrity on fields used as keys.

Operational notes:

- Run seeding on a predictable cadence (e.g. after each UAT deploy) with failure alerts.
- Benchmark the first run against the org's daily API limit before scheduling it regularly.

When this breaks down: very large data volumes may exceed API limits or masking windows — sample a representative subset rather than cloning production wholesale.
