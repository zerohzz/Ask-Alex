---
title: Resolving UNABLE_TO_LOCK_ROW Errors
category: Apex
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_locking_statements.htm
---

`UNABLE_TO_LOCK_ROW` happens when two transactions try to lock the same record (or a shared parent) at the same time. It is common when external callbacks, Batch Apex, and user saves all touch the same parent records — for example several child rows rolling up to one parent, or concurrent tax/payment recalculations on the same order.

Strategies to resolve it:

- **Serialize the work.** Move contended updates into a single asynchronous path (one Queueable chain) so they no longer race against the synchronous save.
- **Order DML deterministically.** Always update parents in a consistent sort order (e.g. by Id) across all code paths to avoid deadlocks.
- **Use `FOR UPDATE`** when you must read-then-write a record within a transaction, so the lock is acquired up front rather than at commit.
- **Add bounded retries** for transient contention: catch the `DmlException`, check for the lock message, and retry with a short backoff a small number of times.
- **Reduce lock scope.** Avoid recalculating an entire parent hierarchy when only one branch changed.

The double-firing variant — where automation recalculates and re-saves the same record twice in one transaction — is best fixed with a static recursion guard rather than retries.
