---
title: Choosing Between Queueable, Future, and Batch Apex
category: Apex
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_async_overview.htm
---

Salesforce offers three asynchronous mechanisms. Pick by data volume and control needs.

- **@future** — fire-and-forget for simple offloading (e.g. a callout after DML). Limited: only primitive parameters, no chaining, no return, hard to monitor. Prefer Queueable for new code.
- **Queueable** — the modern default. Accepts sObjects and complex types, returns a job Id you can track, and supports chaining (enqueue the next job from `execute`). Ideal for serializing contended updates and for multi-step workflows that must run in order.
- **Batch Apex** — for large data volumes (thousands to millions of records). Implements `start`, `execute`, `finish`; processes in scoped batches (default 200) each with its own governor limits. Use for nightly recalculations, payment-reminder sweeps, and mass data fixes. Schedule with `System.scheduleBatch` or a `Schedulable`.

Rules of thumb: use Queueable for transactional, ordered, small-to-medium work; use Batch for high-volume scans; reserve @future for trivial legacy cases. Chaining Queueables one-at-a-time is also an effective way to remove row-lock contention by turning concurrent writes into a serial queue.
