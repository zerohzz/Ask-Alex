---
title: Gating Downstream Automation on Async Completion
category: Apex
---

When downstream automation depends on the result of an asynchronous operation — a `@future` callout, a Queueable, a managed-package job — gate it on an explicit completion signal rather than letting it fire on whatever state happens to exist when the trigger runs. The classic failure is a document or email that generates from intermediate values because the automation didn't wait for the async job to land.

Use a transient intent flag on the record:

- Set the flag before the async work starts (e.g. `Calc_In_Progress__c = true`).
- Have the async job clear the flag — or flip a status field to a known "done" value — when it completes.
- Make every dependent trigger or flow check that signal in its entry criteria, so it stays dormant until the result is ready.

```apex
// Entry guard on the dependent automation
if (record.Calc_In_Progress__c == true) {
    return; // async result not ready — do nothing this run
}
```

Guidelines:

- Drive the dependent automation off the status transition (e.g. a message field becoming "Current"), not off a blind retry.
- For chained async work, set a deferred-intent flag when one job must hand off to another, so the second stage knows it is expected.
- Clear flags in a finally-style path so a failed job doesn't strand the record in a permanently-locked state.
- Keep flags transient and record-scoped; they describe in-flight intent, not durable business data.

This is distinct from recursion control: a static flag stops re-entry within one transaction, whereas an intent flag coordinates across transactions and async boundaries.

When this breaks down: if the async job can die without clearing its flag, add a timeout or a scheduled sweep to release stuck records.
