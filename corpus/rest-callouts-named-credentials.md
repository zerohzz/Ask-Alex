---
title: REST Callouts with Named Credentials
category: Integration
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_named_credentials.htm
---

Named Credentials externalise the endpoint URL and authentication for outbound callouts, so credentials never live in Apex and auth is handled by the platform.

Pattern:

- Define a Named Credential (or the newer External Credential + Named Credential pair) for the target system, configuring the base URL and auth (OAuth, API key header, mTLS, etc.).
- In Apex, set the endpoint to `callout:My_Named_Credential/path`. The platform injects the host and auth headers at runtime.
- This removes hardcoded secrets, removes the need for separate Remote Site Settings, and lets you swap sandbox/production endpoints without code changes.

Reliability practices for callouts:

- Set explicit timeouts and handle non-2xx responses; do not assume success.
- Callouts cannot run after uncommitted DML in the same transaction — do the callout first, or move it into an async (Queueable) context.
- Wrap parsing in try/catch and validate the response shape before using it.
- For high-volume or rate-limited integrations (tax, payments), serialize and add bounded retries with backoff.

Named Credentials are the recommended approach for tax, payment, and third-party platform integrations.
