---
title: Bulkifying Apex Triggers
category: Apex
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_bulk.htm
---

Apex triggers must assume they will receive up to 200 records per execution. Code that queries or performs DML inside a `for` loop will hit governor limits as data volume grows.

The core pattern is to operate on collections, not individual records:

- Collect the IDs or values you need from `Trigger.new` / `Trigger.old` into a `Set` or `Map` first.
- Run a single SOQL query against that set, keyed into a `Map<Id, SObject>` for O(1) lookup.
- Build a `List` of records to update or insert, then perform one DML statement after the loop.

A bulkified trigger does at most a constant number of SOQL queries and DML statements regardless of how many records are processed. This keeps you well under the 100 SOQL / 150 DML per-transaction limits and makes the logic safe for Data Loader, Bulk API, and Flow-initiated updates.

Always test triggers with a batch of 200+ records, not a single insert, so limit problems surface before production.
