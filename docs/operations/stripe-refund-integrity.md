# Stripe refund integrity and recovery

Deliver migration `029`, API and Web together. The migration adds
`sponsorship_refund_operations`; it does not rewrite contributions or ledger facts.

## Administrative request

`POST /api/admin/sponsorships/refund` retains owner authorization, confirmation
text and optimistic version validation. A transaction locks the contribution,
checks its current version and eligibility, records the amount/currency/actor,
marks the workflow `processing` and audits the claim before contacting Stripe.
Only one unresolved operation can exist per contribution. Stripe receives
`sponsorship-refund:<operation UUID>` as its idempotency key and
`openg7RefundOperationId` in refund metadata.

A confirmed response settles that operation. A definitive invalid-request
rejection marks it `failed`; an ambiguous connection/server result leaves it
`uncertain` and returns `502 SPONSORSHIP_REFUND_UNCERTAIN`. The UI refreshes the
dossier and explains that another refund is blocked. Restarting the API, changing
the dossier version or submitting concurrently cannot create another operation
while one is `submitting`, `uncertain` or `pending`. The audit records the original
actor, operation UUID and state transitions without provider secrets.

## Reconcile an uncertain result

Inspect the operation, audit and Stripe refund using the operation UUID,
PaymentIntent, amount and currency. A signed matching `charge.refunded` webhook,
`refund.updated` / `refund.failed` notification
or an explicitly confirmed [Stripe recovery](admin-stripe-backfill.md) settles
the operation. An unrelated refund cannot release its lock; a delayed pending
snapshot cannot replace a terminal outcome. Backfill must cover the original
Checkout creation period and include refunds.

There is no automatic re-creation of uncertain requests, including after a
restart. If Stripe created no refund, investigate and reconcile explicitly with
provider evidence.
Do not mark the request failed merely because no HTTP response arrived, delete
the operation, or change its idempotency key to retry. No automatic expiry releases
the lock. A manual correction requires a separately authorized, audited action.
Historical reconciliation does not send sponsor emails. It creates missing
credit notes for confirmed refunds when the local sponsorship invoice is present;
recover a missing invoice first, then resume the bounded recovery.

## Asynchronous refund updates

Subscribe the Stripe endpoint to `refund.updated` and `refund.failed` alongside
the existing events. In PostgreSQL mode, their signed delivery acquires a
per-refund session lock on the event owner's connection, rereads the current
Refund and Charge, and validates project, references, amount, currency and the
durable administrative operation before changing its state. No database
transaction remains open during provider requests. A failed lock cleanup retires
the owning connection; its interrupted event resumes on redelivery. A delayed
pending/success event cannot override a newer terminal provider state. The current refund
replaces its older snapshot in the charge's bounded refund list; confirmed
individual facts still deduplicate by refund ID.

Every confirmed sponsorship refund, including one created outside OpenG7,
completes its existing credit note or issues one from its local invoice. This
shared path handles `charge.refunded`, asynchronous refund updates and backfill,
including all confirmed refunds returned for the charge. Issuance and its audit
commit together, once per refund ID. Repeats retain number, amount, issue date
and document snapshot. No new
sponsor email is queued: the operation does not store the original notification
recipient/message/consent. Previously queued messages remain unchanged; use the
existing confirmed email action if a further notification is appropriate.
Historical backfill retains the same document rule and stays silent.

A missing invoice leaves the financial refund confirmed but the event failed
(`REFUND_INVOICE_REQUIRED` in the correlated safe log). Recover the invoice with
the existing administrative action, then replay that event to finish the credit
note without another refund or ledger entry. Provider/database failure likewise
leaves a retryable event rather than a false success.
If the refund arrives before the Checkout contribution is attached to its
PaymentIntent, `REFUND_CONTRIBUTION_REQUIRED` likewise leaves its event retryable.
Payment confirmation/invoice recovery followed by redelivery attaches the existing
refund and completes its credit note; no financial fact or invoice is invented.

An authoritative failure/return after a succeeded refund is a financial
correction, not a pending-operation failure. `REFUND_FINANCIAL_CORRECTION_REQUIRED`
leaves the event failed for review, preserving the confirmed ledger, operation
and issued documents. An old succeeded charge snapshot also cannot revive an
operation already failed. The registry insertion and operation settlement share
a per-refund transaction lock: concurrent old charge deliveries cannot insert a
succeeded fact after the failure settles. This guard is checked again inside the
ledger transaction after any provider balance read. Reconcile provider evidence
and prepare a separately authorized compensation; this workflow neither deletes
facts nor invents a reversal document. It does not automatically repair historical financial
contradictions. No new migration or live action is performed by this change.

## Financial facts and project boundary

Webhook and backfill share individual succeeded refund facts. Refund IDs deduplicate
even across different events and concurrent deliveries. Paginated refund lists
are bounded; exceeding the cap fails rather than accepting an incomplete total.
Pending and failed refunds are excluded. Amounts remain integer minor units in
the charge currency. A partial refund preserves `paid`; only the confirmed total
reaching the original charge marks `refunded`.

Public transparency, cockpit and dossier projections collapse duplicate refund
IDs and read legacy cumulative snapshots only for their residual amount beyond
known individual refunds. Original ledger rows remain unchanged. This prevents
double counting when backfill and delayed webhooks overlap. Previously incorrect
contribution statuses and foreign-project rows are not automatically rewritten
or deleted; identify them and prepare a separately authorized correction.

Handled financial webhook events must belong to `FUNDING_PROJECT_ID` before any
persistence. Explicit foreign/conflicting metadata is rejected. Untagged legacy
payments require a known local association; otherwise the related PaymentIntent
must carry matching metadata. Untagged account-wide payouts are ignored. Ignored
events return `200` with `PROJECT_MISMATCH` and do not enter the event ledger.
Synthetic Stripe CLI events also need project metadata. CLI payout backfill
remains an explicitly scoped account operation; it does not infer project ownership.

## Local evidence

`tests/integration/stripe-financial-integrity.integration.mjs` exercises partial
refunds, pagination, duplicate/order/concurrency cases, immutable legacy rows,
foreign projects and a lost provider response across a real API restart.
`tests/integration/stripe-refund-events.integration.mjs` covers signed asynchronous
success/failure, stale snapshots, concurrent repeats, project and monetary
contradictions, provider failure, missing invoice recovery and quarantine after
a confirmed refund. All provider responses and recipients are synthetic.
`stripe-reconciliation-regressions.integration.mjs` covers refunds created outside
OpenG7, several refunds delivered through one update, invoice recovery, audit
rollback and current dispute resolution without restoring publication authority.
`database-migrations.integration.mjs` checks clean and existing disposable databases.
The admin dossier browser suite covers the uncertain-result message and disabled
resubmission. Providers and credentials are synthetic; these are not live refunds.
