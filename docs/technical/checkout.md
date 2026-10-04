# Durable Checkout requests

`POST /api/checkout-sessions` (also `/checkout-sessions`) requires an opaque
`idempotencyKey` of 16–128 ASCII letters, digits, underscores or hyphens when
Stripe Checkout is configured. Use a fresh UUID for a new contribution and keep
the same key and payload when retrying an uncertain request. Missing or invalid
keys return `400 CHECKOUT_IDEMPOTENCY_KEY_INVALID`. The Web keeps the pending
key and a payload hash in session storage and merges concurrent submissions.
An accepted result ends that attempt; provider/network failures remain errors.

Apply [migration 031](../../apps/funding-api/migrations/031_create_checkout_operations.sql)
before starting the updated API. Configured Checkout now requires PostgreSQL;
without durable storage it returns `503 CHECKOUT_STORAGE_UNAVAILABLE` before
contacting Stripe. Stripe-direct statistics remain available. The explicit local
mock still works without a database when Stripe Checkout is not configured.
Deploy the updated Web with the API; older clients without a key are refused.

The API persists the original parameters before contacting Stripe and uses the
operation UUID as Stripe's idempotency key. A completed operation returns its
original redirect without another provider call. A changed amount, consent,
name, contribution type or resolved return URL using the same key returns
`409 CHECKOUT_IDEMPOTENCY_CONFLICT`; an active request returns
`409 CHECKOUT_IN_PROGRESS`. Keys are scoped to the server's project.

Provider failures return `502 CHECKOUT_PROVIDER_UNAVAILABLE`; local persistence
failures return `503 CHECKOUT_PERSISTENCE_FAILED` and retain the session for
recovery. Retry with the original key. The same Stripe parameters/key reconcile
an uncertain result within 23 hours of its first submission. Older unresolved
operations return `409 CHECKOUT_RECONCILIATION_REQUIRED` without creating
another session: Stripe can prune keys after 24 hours ([Stripe reference](https://docs.stripe.com/api/idempotent_requests)).
An operator must reconcile the operation UUID/public reference against Stripe
before deciding recovery; changing the key is not an uncertainty recovery.
The Web displays a specific French/English verification message and retains
both the pending key and a separate verification flag in session storage.
The flag blocks further Checkout requests throughout that browser tab, including
after reload, route changes, or changes to the amount, name and consent. Reload
restores the verification message before submission without contacting Stripe.
This flag contains no contributor data and is not cleared by editing the form;
recovery still requires the operator's reconciliation. When browser storage is
unavailable, the block lasts only for the current service instance.

`checkout_operations` is private: its snapshots include the return URLs needed
for exact retries (including sponsorship follow-up tokens), consent/name and
provider redirect. They are never exposed as records or logged. Contributions
and Stripe metadata retain only the follow-up token hash. Protect these records
and backups with the same controls as private contribution data. Creation and
retries only record a pending contribution; payment still requires Stripe's
authoritative confirmation and never authorizes publication.

## Local validation

On 4 October 2026, before the persistent verification-flag correction, base
`831ad7c` with the original Checkout changes, Node 22.23.3:
13 Checkout integration tests passed against disposable PostgreSQL 16,
including the real Stripe SDK over local HTTP, lost provider responses,
concurrent API instances, local commits followed by failure, a terminated
database connection during the provider call, and recovery with a one-connection
pool. The 23-hour limit was checked at 23 hours and one minute. Existing
contributions were preserved when applying migration 031. The nine migration
runner tests passed on disposable databases as well.
`yarn test` passed all 5,301 Node tests. The Angular production build rendered
24 routes, and all 31 funding-home/payment-recovery browser tests passed,
including the French/English verification message and preservation of the
pending key after reload. Lint passed with the existing `smoke-public.mjs`
warning; targeted formatting, project standards, documentation budgets and
`git diff --check` passed.

The subsequent verification-flag correction was validated on 4 October 2026
with Node 24.21.0: the complete `yarn test` suite passed all 5,304 tests;
144 targeted Node tests and all 31 funding-home/payment-recovery browser tests
also passed. The French/English regressions submit a nondefault amount
and public name, then verify that reload, amount changes and language navigation
retain the block and original key without another Checkout request. The Angular
production build rendered 24 routes; lint, targeted formatting, documentation
checks and `git diff --check` passed. Node 22 was not revalidated for this correction.

```sh
yarn build
node --test tests/integration/checkout-idempotency.integration.mjs tests/integration/database-migrations.integration.mjs
yarn test
yarn workspace @openg7/funding-web build --configuration production
yarn test:ui:funding-home
```

These tests create no real payment. Current provider access checks and the
remaining external qualification are recorded in the
[integration rehearsal](../operations/integration-rehearsal.md#qualification-du-4-octobre-2026).
