---
title: End-to-End Browser Testing of Salesforce UIs
category: DevOps
---

End-to-end browser tests give real confidence in Salesforce UIs that unit tests can't — but Salesforce's dynamic rendering and shared org state make them flaky unless you design against it. A few practices carry most of the reliability.

- **Reuse an authenticated session.** Log in once, persist the storage state to a file, and load it for every test — re-authenticating per test is slow and a common failure point.

```javascript
// one-time setup
await page.context().storageState({ path: 'auth.json' });
// per test
const context = await browser.newContext({ storageState: 'auth.json' });
```

- **Run serially when tests share org state.** Booking slots, payment intents, and other singletons race under parallel workers. Use a single worker (`--workers=1`) for suites that touch shared records; parallelise only the genuinely independent ones.
- **Wait on conditions, not clocks.** Salesforce components hydrate asynchronously and hosted pages (payments, date pickers) load on their own schedule. Use explicit waits for the element or state; reserve fixed delays for third-party frames you can't observe.
- **Handle dynamic widgets defensively.** A date picker that has advanced past the target month needs fallback navigation logic, not a hard-coded click.
- **Debug interactively.** A step-through UI runner with screenshots at each step finds fragile selectors far faster than re-reading logs.

Anchor selectors to stable attributes rather than generated DOM structure, which shifts between releases.

When this breaks down: E2E tests are expensive to maintain — cover critical user journeys end-to-end and push everything else down to unit and integration tests.
