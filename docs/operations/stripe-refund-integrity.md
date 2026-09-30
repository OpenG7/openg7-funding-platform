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
PaymentIntent, amount and currency. A signed matching `charge.refunded` webhook
or an explicitly confirmed [Stripe recovery](admin-stripe-backfill.md) settles
the operation. An unrelated refund cannot release its lock; a delayed pending
snapshot cannot replace a terminal outcome. Backfill must cover the original
Checkout creation period and include refunds.

There is no automatic re-creation of uncertain requests, including after a
restart. If Stripe created no refund, or a pending refund later fails without a
new charge event, investigate and reconcile explicitly with provider evidence.
Do not mark the request failed merely because no HTTP response arrived, delete
the operation, or change its idempotency key to retry. No automatic expiry releases
the lock. A manual correction requires a separately authorized, audited action.
Historical reconciliation does not send sponsor emails or create missing credit
notes; inspect these separately before using their existing recovery actions.

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
`database-migrations.integration.mjs` checks clean and existing disposable databases.
The admin dossier browser suite covers the uncertain-result message and disabled
resubmission. Providers and credentials are synthetic; these are not live refunds.
