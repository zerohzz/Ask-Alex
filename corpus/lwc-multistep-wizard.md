---
title: Architecting a Multi-Step LWC Wizard
category: LWC
source_url: https://developer.salesforce.com/docs/component-library/documentation/en/lwc
---

A multi-step booking/checkout wizard is best built as one parent component orchestrating many small child components — one per step — rather than a single monolithic component.

Key patterns:

- **Single source of truth.** The parent owns the wizard state object and passes slices down via `@api` properties. Children stay presentational and reusable.
- **Events up, props down.** Children raise `CustomEvent`s on change; the parent updates state and re-renders. Never mutate parent data directly from a child.
- **Step gating.** Track the current step index in the parent; validate the active step before advancing. Disable Next until required fields pass validation.
- **Lazy work.** Defer expensive Apex calls (pricing, availability, tax) until the step that needs them, and debounce rapid user input.
- **Imperative Apex with error handling.** Wrap `@AuraEnabled` calls in try/catch, surface user-friendly messages, and show a spinner during in-flight requests.
- **Resilience.** Keep partial state so a failed API call doesn't lose the user's progress; allow retry.

Splitting steps into 10+ focused sub-components keeps each file small, testable with Jest, and independently maintainable.
