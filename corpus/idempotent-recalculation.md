---
title: Making Recalculation Logic Idempotent
category: Apex
---

Prefer recalculation logic that produces the same result no matter how many times it runs over logic that assumes it runs exactly once. Salesforce gives you no such guarantee — triggers re-fire, flows re-enter, users re-save, and async jobs land out of order — so any "calculate once on save" assumption eventually breaks and leaves doubled totals or stale documents.

The core technique is a configuration fingerprint. Before applying a stored or previously computed result, hash the inputs the result depends on and compare against the fingerprint stored alongside it. Reuse the stored value only when the fingerprints match; otherwise recompute from current inputs.

```apex
String fingerprint = buildFingerprint(lineItems); // sorted, order-independent
if (record.Calc_Fingerprint__c == fingerprint) {
    return; // inputs unchanged — nothing to recompute
}
record.Total__c = recompute(lineItems);
record.Calc_Fingerprint__c = fingerprint;
```

Guidelines:

- Build the fingerprint from every input that changes the output (quantities, prices, variant ids), and sort it so order doesn't produce false mismatches.
- Store the fingerprint on the record, not in memory — the next transaction needs to see it.
- Guard the whole recalculation behind the fingerprint check, not individual sub-steps, so a partial run can't half-apply.
- Keep the recompute pure: same inputs, same output, no side effects beyond the fields it owns.

This pairs naturally with a single-run flag for async chains: the flag prevents concurrent recomputes within a transaction, the fingerprint prevents redundant recomputes across transactions.

When this breaks down: if an input lives outside the fingerprint — a clock, a sequence, an external rate — the result is no longer a pure function of the record and idempotency is not guaranteed. Pin those inputs explicitly.
