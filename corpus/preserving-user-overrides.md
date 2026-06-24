---
title: Preserving Manual Overrides Across Re-saves
category: LWC
---

When a re-save replaces a data set from a server response, preserve the fields the user explicitly edited rather than letting the fresh payload overwrite them. Users lose trust fast when a time, price, or note they just set silently reverts because adding an unrelated item triggered a full reload.

Mark intent at the moment of the edit. Set an override flag on the row exactly when the user changes the field — not derived later by comparing values, which can't distinguish a deliberate edit from a coincidence.

```javascript
handleTimeChange(event) {
    const row = this.rows.find(r => r.id === event.target.dataset.id);
    row.startTime = event.detail.value;
    row.hasManualTimeOverride = true; // record intent now
}
```

Then snapshot-and-reapply around any list replacement:

```javascript
const overrides = new Map(
    this.rows.filter(r => r.hasManualTimeOverride)
             .map(r => [r.id, r.startTime])
);
this.rows = await fetchRowsFromServer();        // fresh payload
this.rows.forEach(r => {
    if (overrides.has(r.id)) {
        r.startTime = overrides.get(r.id);
        r.hasManualTimeOverride = true;         // keep the flag alive
    }
});
```

Guidelines:

- Key the snapshot map on a stable identifier (record id, product id), not array position — the new list may be reordered or resized.
- Treat the override flag as a first-priority check in any downstream sync that would otherwise recompute the field.
- Persist the flag if the override must survive a page reload, not just an in-memory refresh.

The same pattern applies server-side: before a bulk field copy overwrites a target, check whether the target carries a user-set marker and skip it if so.

Related: pair with non-destructive sync — never overwrite a populated target with a null source.
