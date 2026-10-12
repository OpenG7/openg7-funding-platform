# Durable Checkout requests

`POST /api/checkout-sessions` (also `/checkout-sessions`) requires an opaque
`idempotencyKey` of 16–128 ASCII letters, digits, underscores or hyphens when
Stripe Checkout is configured. Use a fresh UUID for a new contribution and keep
the same key and payload when retrying an uncertain request. Missing or invalid
keys return `400 CHECKOUT_IDEMPOTENCY_KEY_INVALID`. The Web keeps the pending
key and a payload hash in bounded local storage and merges concurrent submissions.
Older session-storage attempts require verification before a new key can be
created. Contributor names, contacts and return URLs are not stored in this
browser recovery record.
An accepted result ends that attempt; provider/network failures remain errors.

Shared browser reservations and cleanup use an exclusive, origin-scoped
[Web Lock](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
in a secure context. Two tabs submitting the same intent retain the same UUID;
cleanup checks ownership in both the attempt and offer records. Network requests
run outside the lock. Without reliable coordination, no new operation is started
against shared recovery storage; an exact known retry keeps its original key.
Personal contributions without browser storage retain their in-memory recovery.
An offer or charter refusal also retains the dispatched key: another tab can
still have a request in flight with that key. Retrying the original intent keeps
the key; replacing its terms requires reconciliation before any new operation.

Apply [migration 031](../../apps/funding-api/migrations/031_create_checkout_operations.sql)
before starting the updated API. Configured Checkout now requires PostgreSQL;
without durable storage it returns `503 CHECKOUT_STORAGE_UNAVAILABLE` before
contacting Stripe. Stripe-direct statistics remain available. The explicit local
mock still works without a database when Stripe Checkout is not configured.
Deploy the updated Web with the API; older clients without a key are refused.

For sponsorships, a validated public charter can additionally require
`charterAcceptance: { accepted: true, policyVersion, fingerprint, locale }`.
The acceptance and durable operation commit together before Stripe; retries
retain the original evidence. Personal contributions remain outside this scope.
The prepared V1 charter is inactive by default. See the
[moderation contract and activation limits](../operations/sponsorship-moderation.md).

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
both the pending key and a separate verification flag in browser storage.
The flag blocks further Checkout requests, including
after reload, route changes, or changes to the amount, name and consent. Reload
restores the verification message before submission without contacting Stripe.
This flag contains no contributor data and is not cleared by editing the form;
recovery still requires the operator's reconciliation. When browser storage is
unavailable, an already retained attempt remains protected in memory. A new
sponsorship cannot start without reliable recovery storage; the interface
explains this availability failure without asserting that payment occurred.

`checkout_operations` is private: its snapshots include the return URLs needed
for exact retries (including sponsorship follow-up tokens), consent/name and
provider redirect. They are never exposed as records or logged. Contributions
and Stripe metadata retain only the follow-up token hash. Protect these records
and backups with the same controls as private contribution data. Creation and
retries only record a pending contribution; payment still requires Stripe's
authoritative confirmation and never authorizes publication.

## Accepted sponsorship offers and obligations

`GET /api/sponsorship-offer?amountMinor=<integer>&currency=CAD` returns the
current server quote: version, amount in integer minor units, currency, benefits
and SHA-256 fingerprint. Each benefit identifies its channel, logical target,
quantity, required elements and any promised deadline/duration. A null deadline
or duration means that none is promised. The existing `*_batch` IDs identify
collective recognition; individual portraits are not offered by this version.

Business Checkout requires `offerAcceptance: { version, fingerprint }`. This
reference cannot supply commercial terms to the server. Missing acceptance
returns `400 SPONSORSHIP_OFFER_ACCEPTANCE_REQUIRED`; a changed quote returns
`409 SPONSORSHIP_OFFER_CHANGED` before contacting Stripe. The interface reloads
the terms and clears acceptance, while retaining the dispatched attempt key.
Replacing those terms requires verification because another tab can still be
using the original attempt. Personal contributions cannot include
this reference (`400 SPONSORSHIP_OFFER_NOT_APPLICABLE`).

[Migration 041](../../apps/funding-api/migrations/041_sponsorship_commitments.sql)
adds immutable commercial offer snapshots, commitments, obligations and audited
changes. The offer commits with the new durable Checkout operation before
Stripe. An uncertain retry retains that snapshot despite a later pricing change.
The browser retains only the public quote, attempt UUID and payload fingerprint
for up to 24 hours; this retention does not extend the server's 23-hour retry
window and never confirms a payment. A different payload, expired or ambiguous
cache requires verification instead of silently creating a replacement attempt.
Expiry blocks submission immediately; pruning shared expired records waits for
reliable coordination. If that coordination is unavailable, residual public
recovery data stays blocked until it can be pruned safely.
Resuming requires re-entering the same details, consent, language, return URLs
and charter acceptance. A changed charter requires verification; the cache does
not reconstruct private details or silently accept newer terms.

Authoritative Stripe amount, currency and Session/PaymentIntent associations must
match before activation. Repeated events create one commitment and one obligation
per promised ordinal. Early payment confirmation is reconciled with the exact
existing financial journal entry. If evidence is incomplete or inconsistent,
the payment fact remains intact and the commitment needs confirmation; an active
or explicitly qualified offer is not replaced by an incompatible replay.
An unconfirmed failure event cannot activate an offer. PaymentIntent success
qualifies obligations only after its financial journal write or exact replay
succeeds; a conflicting journal leaves the commercial record unqualified.
Checkout producers supply monetary evidence explicitly for a paid Session.
Backfill does not infer that evidence from a paid projection, and existing
journal facts remain authoritative even without a notification marker.

Existing paid sponsorships have `historical_unverified` provenance and
`needs_confirmation` state, with no inferred offer or invented obligations.
Historical qualification requires an owner decision and an evidence reference.
Current payment, consent, review and media guards can block an obligation without
erasing it. Partial or failed refunds alone do not rewrite promised terms.
Private progress retains these blocks, including a required logo that is absent
or whose moderation is incomplete; apparent media approval cannot clear a
repository block. Qualification and blocker messages are translated in FR/EN.
Completion can include an approved adjustment; its label distinguishes that
outcome from delivery backed by evidence.
Fulfilment on provider evidence remains a separate publication task; this lot
creates no `fulfilled` result. Invoice snapshots preserve the recorded terms and
financial facts at issuance; a later qualification does not rewrite an invoice.

### Commercial commitment administration

`GET /api/admin/sponsorship-commitments?contributionId=<uuid>` requires existing
server-side admin access and returns a private, non-cacheable commercial record.
`POST /api/admin/sponsorship-commitments/qualify` records historical terms with
an evidence reference; `POST /api/admin/sponsorship-commitments/adjust` records
an explicit destination change or waiver. Mutations require owner rights in
OIDC mode, or the authorized signed local token session, plus JSON, a request UUID,
the expected version, a reason and confirmation equal to the selected target ID.
They are idempotent and audited in the same transaction. An identical request,
input and actor reuses the original logical receipt even after its version has
advanced; a different input or a new request on a stale version returns a conflict.
No mutation creates payment, provider proof, publication or a refund. Owner UI
workflows and complete obligation-based scheduling remain later work.

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
