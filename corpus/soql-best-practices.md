---
title: SOQL Best Practices and Selective Queries
category: SOQL
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_SOQL.htm
---

Efficient SOQL keeps transactions under limits and avoids full-table scans.

- **Never query inside a loop.** Query once into a `Map<Id, SObject>` and look up by key.
- **Select only needed fields.** Narrow SELECT lists cut heap usage and improve performance.
- **Make filters selective.** Filter on indexed fields (Id, Name, External Ids, lookups, and fields marked as custom indexes). Non-selective filters on large objects throw a query-non-selective error or scan too many rows.
- **Use relationship queries** instead of separate queries: child-to-parent (`Contact.Account.Name`) and parent-to-child subqueries (`SELECT Id, (SELECT Id FROM Contacts) FROM Account`).
- **Aggregate in the database** with `GROUP BY` and aggregate functions rather than summing in Apex.
- **Bound result size** with `LIMIT` and, for large scans, hand off to Batch Apex which re-scopes governor limits per batch.

For read-then-write logic under concurrency, add `FOR UPDATE` to lock the rows you intend to modify.
