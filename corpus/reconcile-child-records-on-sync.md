---
title: Reconcile Instead of Delete-and-Rebuild
category: Apex
---

When syncing a list of child records from a payload, prefer querying the existing records and reconciling them over deleting everything and inserting fresh. Delete-and-rebuild looks simpler but discards record ids, audit fields, field history, and the distinction between insert and update that downstream triggers rely on.

Reconcile in three moves:

```apex
Map<Id, Child__c> existing = new Map<Id, Child__c>(
    [SELECT Id, Qty__c FROM Child__c WHERE Parent__c = :parentId]
);
List<Child__c> toUpsert = new List<Child__c>();
Set<Id> seen = new Set<Id>();

for (PayloadItem item : payload) {
    Child__c rec = (item.id != null && existing.containsKey(item.id))
        ? existing.get(item.id)                 // update in place
        : new Child__c(Parent__c = parentId);   // insert new
    rec.Qty__c = item.qty;
    toUpsert.add(rec);
    if (rec.Id != null) seen.add(rec.Id);
}
upsert toUpsert;

List<Child__c> toDelete = new List<Child__c>();
for (Id id : existing.keySet()) {
    if (!seen.contains(id)) toDelete.add(existing.get(id));
}
delete toDelete;
```

Guidelines:

- Pass existing record ids through every layer (UI to DTO to Apex) so the payload can be matched, not just rebuilt.
- Match on a stable key — the record id, or a business external id — never array order.
- Delete only the records absent from the incoming payload, after the upsert, so nothing is dropped mid-sync.
- This preserves CreatedDate/CreatedBy, keeps history tracking continuous, and lets triggers see real updates instead of insert-then-delete churn.

When this breaks down: if the payload genuinely can't carry ids and the child records hold no audit value, delete-and-rebuild is the simpler honest choice — reconcile earns its complexity only when identity matters.
