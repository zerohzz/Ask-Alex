---
title: SFDX Git Delta Deployments in CI/CD
category: DevOps
source_url: https://github.com/scolladon/sfdx-git-delta
---

Deploying the entire source on every release is slow and risky. A delta deployment ships only the metadata that changed between two git refs.

A typical CI/CD pipeline (e.g. on Azure DevOps) per environment:

- On a pull request / merge, run `sfdx-git-delta` to diff the current commit against the last deployed ref and generate a `package.xml` (and a `destructiveChanges.xml`) containing only changed/removed components.
- Validate with a check-only deploy (`--dry-run` / `--checkonly`) running the relevant Apex tests before merge.
- On merge to the release branch, deploy the delta package to the target org.
- Promote through Dev → QA → UAT → Production using the same delta artifact, keeping a consistent fortnightly cadence.

Benefits: faster deploys, smaller blast radius, clearer change review, and reliable destructive changes. Keep a record of the last successfully deployed commit per org so the next delta diffs from the right baseline. Pair with scratch orgs or sandboxes seeded from source for testing.
