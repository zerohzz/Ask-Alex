---
title: JWT Connected-App Auth for CI Pipelines
category: DevOps
---

Authenticate CI pipelines to Salesforce with the JWT bearer flow against a dedicated connected app, not with interactive login or a stored password. JWT needs no human at the browser, no session timeout, and no credentials in the pipeline definition — the private key lives in the CI platform's secure store and never touches the repo.

Setup:

- Create a connected app with a digital certificate; grant the integration user access via permission set.
- Store the private key in the CI platform's secure-file vault, referenced by the pipeline at runtime — never committed.
- Authenticate per job, mapping the branch to its target org.

```bash
sf org login jwt \
  --client-id "$CONSUMER_KEY" \
  --jwt-key-file "$KEY_FILE" \
  --username "$ORG_USERNAME" \
  --instance-url "$LOGIN_URL"   # https://test.salesforce.com for sandboxes
```

Practices:

- **One cert, branch-to-org mapping.** A shared certificate across orgs is fine; resolve client id, username, and login URL from the branch in a shared auth template.
- **Track certificate expiry.** A lapsed cert fails every pipeline at once — calendar the rotation before it expires and keep the access list current.
- **Pin the Node runtime.** The `sf` CLI rides on Node; pin it to an Active LTS in CI. Drifting onto an end-of-life or bleeding-edge version surfaces as cryptic failures — older Node can't parse newer CLI regex features and throws `SyntaxError: Invalid regular expression flags`.
- **Test runtime bumps on a throwaway branch** before rolling them to production pipelines.

When this breaks down: if the org enforces IP restrictions on the connected app, add the CI runner's egress range to the allowlist or the JWT exchange will be refused.
