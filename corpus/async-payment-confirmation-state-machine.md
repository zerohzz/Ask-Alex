---
title: Designing for Async Payment Confirmation (3DS)
category: Integration
---

If your payment flow assumes a payment is confirmed the moment the charge call returns, it will break the first time the processor requires asynchronous customer authentication (3-D Secure). Strong Customer Authentication turns a one-shot charge into a multi-step state machine — design for it from the start rather than retrofitting under deadline.

The shape of the problem:

- A synchronous flow sets the record to "confirmed" on return from the charge call. 3DS instead moves through states — pending, requires action (customer must authenticate), then succeeded or failed — and the final state arrives later, out of band.
- The transition is delivered by webhook, not by the original call returning. Without a webhook handler, the org never learns the real outcome.

What to build:

- **A state field, not a boolean.** Track the intent id and confirmation status on the payment record, plus a deadline for how long to wait.
- **A webhook handler** that receives the `requires_action`, `succeeded`, and `failed` events and advances the record's state accordingly.
- **Gate downstream automation on confirmation.** Document generation, confirmation emails, and tax finalisation should fire on a "payment confirmed" signal — never on the initial charge call. A customer must not receive a paid-confirmation email for a payment still awaiting authentication.
- **A rollback path.** On failure or timeout, revert the record's stage and clean up anything provisioned optimistically — synchronous flows usually have no revert, and that gap is where bad data accumulates.

Watch for logic owned by a managed package: the calls that enable manual confirmation and async handling may live inside the vendor's package and require vendor configuration, not your code.

When this breaks down: low-value payments in regions without an SCA mandate may not justify the machinery — but isolate the synchronous assumption so it's easy to upgrade later.
