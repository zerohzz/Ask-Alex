---
title: Auditing Connected Apps for OAuth Compliance
category: Integration
---

When auditing an org's OAuth surface, separate the apps you installed and control from the apps embedded by managed packages — they need different remediation, and they don't show up the same way. A vendor's connected app can't be hardened with your own config changes; it requires the vendor to act.

How to inventory:

- Query `ConnectedApplication` via the tooling API for locally-installed apps.
- Note that managed-package and external client apps may not appear in that object on every API version — cross-attribute usage through `OAuthToken` (by app name) to find apps that are active but not directly queryable.
- Reconcile both lists against actual token usage, so you audit what's in use, not just what's installed.

Controls to check on each app:

- PKCE enabled.
- Refresh-token rotation enabled.
- An idle-session timeout (e.g. 30 days).
- IP relaxation set to enforce an allowlist, with login-IP monitoring on.

Then split remediation by ownership:

- **Local apps** are yours to fix directly.
- **Vendor-embedded apps** need an attestation request to the vendor. Batch the outreach by vendor — if one vendor ships four packages, ask once for all four rather than four times.

```bash
sf data query --use-tooling-api \
  --query "SELECT Name, OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication"
```

When this breaks down: token-usage counts tell you an app is active but not whether it's still needed — pair the audit with an owner conversation before revoking anything that looks idle.
