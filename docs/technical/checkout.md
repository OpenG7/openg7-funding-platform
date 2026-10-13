# Durable Checkout requests

`POST /api/checkout-sessions` (also `/checkout-sessions`) requires an opaque
`idempotencyKey` of 16–128 ASCII letters, digits, underscores or hyphens when
Stripe Checkout is configured. Use a fresh UUID for a new contribution and keep
the same key and payload when retrying an uncertain request. Missing or invalid
keys return `400 CHECKOUT_IDEMPOTENCY_KEY_INVALID`. The Web keeps the pending
key, payload hash, public offer terms and verification marker in one IndexedDB
snapshot and merges concurrent submissions. Reservations and cleanup use an
exclusive Web Lock shared by same-origin tabs: read the committed snapshot,
validate on a synchronous memory adapter, then commit the complete record before
dispatch. Checksums run outside IDB transactions; a successful `put` request alone
does not authorize dispatch, which waits for transaction completion. Local storage
is a compatibility mirror, whose stale process-local view cannot mint another UUID.
The provider call happens outside that lock. The original UUID survives a lost
response or a refusal while another request is still in flight. Cleanup checks
ownership before removing an entry. Existing readable recovery caches import once,
preserving UUIDs, terms and expiry; private legacy intents import only a verification
block. An initialized snapshot, including an empty one, is never replaced by the
mirror. Already open tabs running an older client must reload to use this protocol;
transactional coordination does not extend to those older writers.
Without usable locks or canonical storage, a known exact durable attempt can retry
read-only; a new browser attempt cannot call the provider. Synthetic/SSR instances
without browser storage retain the existing personal-support memory fallback.
An aborted reservation commit creates no API request or retained-submission claim;
an aborted cleanup keeps the accepted API result and its durable key for exact retry.
An accepted result ends that attempt; provider/network failures remain errors.

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

Business Checkout also requires the displayed offer reference:
`offerAcceptance: { version, fingerprint }`. Obtain it from
`GET /api/sponsorship-offer?amountMinor=25000&currency=CAD`. The quote contains
integer minor units, currency, benefit IDs, logical destination, quantity,
required elements, and explicit nullable deadline/duration. Other currencies
are refused; CAD thresholds are never applied to them. The current quantity is
one website mention and, at their thresholds, one Facebook/LinkedIn recognition.
`null` promises no fixed deadline or duration.

Offer v2 records each social format. Optional `facebookFormat` / `linkedinFormat`
query parameters select `collective_text` (default), `individual_portrait` or
`collective_composite`; copy the chosen options into Checkout's `offerFormats`
object (`facebook?`, `linkedin?`). The server recomputes the matching quote before
preparation. `image_collection` returns `400 FORMAT_UNAVAILABLE`; it is not
converted to a single image. The acceptance fingerprint covers the format.
[Migration 045](../../apps/funding-api/migrations/045_sponsorship_publication_formats.sql)
records it on obligations. Old snapshots without a format keep their canonical
JSON/hash. An absent `offerFormats` stays absent on retries: adding defaults or
changing a selected format changes the durable request fingerprint.

[Migration 041](../../apps/funding-api/migrations/041_sponsorship_commitments.sql)
stores the immutable server offer in the same transaction as the newly prepared
Checkout operation and charter evidence, before Stripe. Missing or stale offer
references return `400 SPONSORSHIP_OFFER_ACCEPTANCE_REQUIRED` or
`409 SPONSORSHIP_OFFER_CHANGED` before that operation is inserted. A malformed
reference returns `400 SPONSORSHIP_OFFER_INVALID`. Reconfirm the current quote
for a new attempt; provider/network failures retain the original key, payload
and offer. The public offer snapshot and its checksum can be cached for exact
recovery without contributor details. The selected format options are retained
and restored verbatim; historical absent options remain absent. Public recovery
entries expire after 24 hours. Expiration first persists a verification marker,
then removes the expired entries; it never grants permission for a fresh payment.
Unreadable legacy session/local caches require verification. A new sponsorship
requires both its UUID and public terms to be durably retained before any call.
Unreadable storage and failed term writes display a specific French/English
recovery message and retry action, without claiming that a payment was sent.
Uncertain attempts instead display the verification message and link to support.
Local mocked business Checkout also
requires the displayed reference, but creates no payment, durable operation or
obligation.

Repeated durable operations skip offer preparation: their original terms remain
unchanged after a price change, including an increased minimum. The Web restores
the original amount and terms, and the API reconciles the existing operation
before applying the current minimum to a new operation. Operations prepared
before 041 without an offer
can replay their original payload; confirmed dossiers remain explicitly
`needs_confirmation` rather than receiving today's benefits. Stripe-confirmed
payment activates one set of obligations from a matching operation/reference,
amount and currency. Session activation requires an explicit server-confirmed
paid amount and currency. PaymentIntent activation and backfill use the validated
financial journal; a failed event, missing journal or contradictory amount cannot
activate accepted terms from the local contribution amount. Payment, review,
consent, visibility and publication stay
independent. New invoices and confirmation messages describe the recorded offer;
issued documents and queued messages keep their existing snapshots.

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
both the pending key and a verification flag in the canonical snapshot.
The flag blocks further Checkout requests across same-origin tabs, including
after reload, route changes, or changes to the amount, name and consent. Reload
restores the verification message before submission without contacting Stripe.
The page restores the canonical block asynchronously even with an empty mirror;
a positive mirror flag also remains a conservative synchronous block.
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
