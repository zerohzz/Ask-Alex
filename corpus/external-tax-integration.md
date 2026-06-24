---
title: Integrating an External Tax Engine (Multi-State / Multi-Company)
category: Integration
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts.htm
---

Calculating sales tax for multi-state or multi-company operations is best delegated to a dedicated tax engine rather than hardcoding rates, because jurisdictions and rules change constantly.

A robust integration pattern:

- **Map the org to the tax engine.** Each operating company / location maps to a tax profile (nexus, registration, company code) in the external system.
- **Call out at the right moment.** Recalculate tax when the quote/order lines or ship-to change — not on every save. Guard the recalculation so it only fires on relevant field changes.
- **Run asynchronously under load.** Move tax calculation into a Queueable so it doesn't block the user save and so concurrent recalculations are serialized, avoiding row-lock contention on shared parents.
- **Handle taxed vs tax-exempt** events and additional charges (e.g. service charges) explicitly, applying the correct rule per line.
- **Persist results idempotently.** Store the returned tax amounts and a calculation timestamp; re-running should overwrite cleanly, not double-apply.
- **Fail safe.** On callout error, surface a clear message and avoid finalising an invoice with stale or missing tax; add bounded retries for transient failures.

This keeps quoting, invoicing, and document generation compliant across regions from day one.
