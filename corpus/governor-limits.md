---
title: Common Governor Limit Breaches and Fixes
category: Apex
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
---

Governor limits are enforced per transaction. The breaches seen most often in production:

- **Too many SOQL queries (101).** Caused by querying inside a loop. Fix by querying once into a `Map` before the loop.
- **Too many DML statements (151).** Caused by `update`/`insert` inside a loop. Fix by collecting records into a `List` and doing one DML after the loop.
- **CPU time limit (10,000 ms).** Caused by nested loops, heavy formula/recursion, or large in-memory transforms. Fix by reducing algorithmic complexity, using maps for lookups, and moving heavy work async.
- **Heap size (6 MB sync / 12 MB async).** Caused by holding large query results or strings. Fix with `for (SObject s : [SELECT ...])` query-loops that stream rows, and by narrowing SELECT fields.
- **Too many query rows (50,000).** Fix with selective filters and `LIMIT`; move full-table work to Batch Apex.

A finalisation step that runs on every save (quotes, totals, tax) is a frequent CPU/SOQL offender — guard it so it only runs when the relevant fields actually changed, and push expensive recalculation into asynchronous processing.
