---
title: A Two-Pipeline Salesforce CI/CD Architecture
category: DevOps
---

Split Salesforce CI/CD into two pipelines — a validation pipeline on pull request and a deployment pipeline on merge — rather than one pipeline that both checks and ships. The split lets failures surface before code merges, and keeps the deploy step doing only what was already proven safe.

Validation pipeline (runs on PR):

- Generate a delta package from the git diff between the source and target branch, so only changed metadata is considered.
- Run a check-only deploy (`sf project deploy validate`) with `RunLocalTests`.
- Block the merge on a green result plus branch policy (reviewers, sign-off).

Deployment pipeline (runs on merge):

- Regenerate the same delta and run the real deploy (`sf project deploy start`).
- Deploy the identical package that validated, so what shipped is what was tested.

Cross-cutting practices:

- **Delta over full-source.** Build `package.xml` and `destructiveChanges.xml` from the diff to shrink blast radius and review surface.
- **`.forceignore` is the exclusion source of truth.** Keep volatile metadata (duplicate/matching rules, hand-managed profiles) out of deploys there, not in ad-hoc pipeline filters.
- **Map branches to orgs.** One long-lived branch per environment (integration to UAT, release line to production); the pipeline reads the branch to pick the target org.
- **Share templates.** Factor org auth, runtime setup, and delta generation into reusable pipeline templates so both pipelines stay in sync.
- **Default to `RunLocalTests`.** Don't loosen the test level without a recorded reason.

```bash
sf sgd source delta --to HEAD --from HEAD~1 --output-dir delta
sf project deploy validate --manifest delta/package.xml --test-level RunLocalTests
```

When this breaks down: a very small org may not justify two pipelines — but keep the validate-before-merge gate even if you collapse the deploy step into it.
