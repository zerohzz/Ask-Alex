---
title: Preventing Trigger Recursion and Double-Firing
category: Apex
source_url: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm
---

When a trigger updates the same records it fires on — directly, or via a Flow/Process that re-saves — it can re-enter and run its logic twice in one transaction. Symptoms include duplicated child records, doubled rollups, and recalculated totals applied twice.

The standard fix is a static recursion guard. A static variable lives for the duration of the transaction, so set a `Boolean` (or a `Set<Id>` of already-processed records) the first time the logic runs and short-circuit on re-entry.

A `Set<Id>` guard is more precise than a single Boolean because it lets unrelated records in the same transaction still process while blocking only the records already handled.

Combine the guard with a "did the relevant field actually change?" check (compare `Trigger.new` against `Trigger.oldMap`) so expensive automation only runs on real changes. This both prevents recursion and reduces CPU usage. Use a single trigger per object delegating to a handler class so all logic shares one guard.
