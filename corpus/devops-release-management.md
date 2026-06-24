---
title: DevOps & Release Management
category: DevOps & Release
---

Alex has run a sustained fortnightly release cadence across a multi-org estate, owning the pipeline end to end. The principles generalise beyond any one stack.

**Delta over full-source deploys.** Ship only what changed between two git refs, generating the deployment manifest (and destructive changes) from the diff. Faster deploys, smaller blast radius, clearer review.

**Branch and gate deliberately.** Feature work branches from the integration branch; production-grade fixes branch as `hotfix/*` from the release line. Nothing reaches production without passing branch policy: a green validation run, two reviewers, and sign-off from the release/UAT owner. "Can you just deploy this quickly" still goes through the pipeline — the answer is to triage the user-visible impact, not to skip the gate.

**Validate before you merge.** Run a check-only deployment with the relevant tests on every pull request, so failures surface before merge, not after.

**Promote one artifact through environments.** Dev → QA → UAT → Production using the same delta package, so what you tested is what ships. Record the last successfully deployed ref per environment so the next delta diffs from the right baseline.

**Watch for source-control drift.** Things drift into existence in production that never made it back into source — automation, rules, configuration records. Pulling them into version control is its own workstream; flag it rather than letting the gap widen silently.

**Plan for platform deprecations.** Track the vendor's release calendar (API version retirements, default-behaviour changes, feature sunsets) and pre-empt the ones that touch your code before they force an emergency.
