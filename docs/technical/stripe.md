# Stripe webhooks, replay and backfill

Root commands. [Index](../README.md).

Live mode, production targets and backfill require the
[high-risk procedure](../../AGENTS.md#risque-eleve), bounded scope and backup where needed.
Read the [migration procedure](../operations/database-migrations.md) before migrations.

[Checkout and recovery](checkout.md).

## Stripe webhook endpoint

Webhook URL (local):

- `POST http://localhost:3333/api/stripe/webhook`

Handled events:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.updated` (late fee/net enrichment)
- `charge.refunded`
- `refund.updated`
- `refund.failed`
- `charge.dispute.created`
- `payout.paid`
- `payout.failed`

Behavior:

- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- Idempotency through unique `stripe_event_id` and `processing_status`
- PostgreSQL locks each event on one connection. Redelivery resumes interrupted
  processing; concurrent deliveries receive `503`, completed duplicates `200`.
- Delayed failures cannot replace confirmed payment, dispute, or refund states.
- Refund events reconcile current provider facts under a per-refund lock.
  Missing invoices or financial contradictions keep the event failed; no sponsor
  email is inferred. See [refund recovery](../operations/stripe-refund-integrity.md).
- Sponsorship follow-up and invoice emails are queued for the email worker.
- `balance_transaction` retrieval to compute fee/net fields
- Development without PostgreSQL acknowledges verified webhooks without storage;
  transparency reads Stripe. Production requires PostgreSQL.

[Private data](../operations/private-data-protection.md).

See [payment confirmation and recovery checks](../payment-trust-validation.md)
for the UI behavior, refund totals, and isolated PostgreSQL/browser tests.

## Test with Stripe CLI

1. Start services:

```bash
corepack yarn dev
```

2. Forward Stripe events to local webhook:

```bash
stripe listen --forward-to localhost:3333/api/stripe/webhook
```

3. Copy the emitted signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

4. Trigger sample events:

```bash
stripe trigger checkout.session.completed
stripe trigger checkout.session.expired
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger charge.refunded
stripe trigger charge.dispute.created
stripe trigger payout.paid
stripe trigger payout.failed
```

## Replay failed Stripe webhook events

When a signed webhook failed after payment, fix the underlying cause first
(for example, run database migrations), then replay the original Stripe event.
For local HTTPS through Traefik, keep the listener open in one terminal:

```bash
corepack yarn stripe:webhook:listen
```

`yarn docker:up:dev` demarre Docker et ce relais : voir le
[demarrage guide et HTTPS local](../docker-deployment.md#demarrage-docker-guide).
Le relais utilise `STRIPE_SECRET_KEY` de `.env` (le shell prime), refuse le live
et verifie `STRIPE_WEBHOOK_SECRET`. `yarn stripe:webhook:listen --check` fait ce
controle sans relayer d'evenement ni afficher/modifier les secrets.
Pour obtenir le secret initial, utiliser `stripe listen --print-secret` dans un
terminal prive avec `STRIPE_API_KEY` defini sur la meme cle de test que l'API.
Mettre a jour `.env` puis recreer l'API; ne pas publier le secret.
Le relais verifie TLS et ne rejoue pas les paiements passes : ils demandent
un rejeu ou un rattrapage borne distinct.

Then resend one or more event ids from another terminal:

```bash
corepack yarn stripe:events:resend evt_1... evt_2...
```

You can also pass a comma-separated list:

```bash
corepack yarn stripe:events:resend evt_1...,evt_2...
```

For production or another saved Stripe webhook endpoint, use live mode and
target the endpoint explicitly:

```bash
corepack yarn stripe:events:resend:live evt_1... evt_2... --endpoint we_...
```

Use `--dry-run` to print the Stripe CLI calls without sending anything. The
endpoint can also be provided through `STRIPE_WEBHOOK_ENDPOINT_ID`. Replaying
an already processed event does not resend a logical email. Recover failed
processing through the idempotent webhook flow; use the confirmed admin resend
or email retry action when a new delivery is required.

## Stripe historical backfill to PostgreSQL

[Admin recovery](../operations/admin-stripe-backfill.md) is available in Contributions after migration 028.

When switching from Stripe-direct transparency to PostgreSQL, run an initial
Stripe backfill after migrations and a database backup. The command reads
historical Checkout Sessions from Stripe, filters them by `FUNDING_PROJECT_ID`
metadata, and writes idempotent rows to `stripe_checkout_sessions`,
`fund_contributions`, and `fund_transactions`.

Payment and payout imports share the webhook's transaction lock and deduplicate by
Stripe object ID and outcome, including concurrent deliveries. A failed payout supersedes its earlier
success in financial projections without rewriting the ledger; see the
[payout transparency contract](../funding-transparency.md#versements-stripe-et-échecs-tardifs).

Preview first:

```bash
corepack yarn stripe:backfill --dry-run
```

Run against the configured `STRIPE_SECRET_KEY` and `DATABASE_URL`. If
`DATABASE_URL` uses the private Docker host `postgres`, this command
automatically runs the backfill inside Docker Compose:

```bash
corepack yarn stripe:backfill
```

For an explicit Docker invocation, the internal runner remains available:

```bash
node scripts/stripe-backfill-docker.mjs --dry-run
```

For live mode, the command refuses non-live keys when `--live` is present:

```bash
corepack yarn stripe:backfill:live --from 2026-01-01 --dry-run
corepack yarn stripe:backfill:live --from 2026-01-01
```

Useful options:

- `--project openg7` overrides the project metadata filter.
- `--include-unmatched` imports legacy Checkout Sessions without matching
  project metadata.
- `--from` and `--to` restrict the Stripe created timestamp range.
- `--limit` caps the number of objects scanned per Stripe resource.
- `--skip-payouts`, `--skip-refunds`, and `--skip-disputes` narrow the import.
- `--no-assume-non-charity-acknowledged` keeps newly imported legacy sessions
  without that metadata out of contribution totals; existing local choices remain unchanged.

Checkout rows deduplicate by session ID; payments/payouts by object and outcome;
refunds by refund ID. See [refund integrity and project filtering](../operations/stripe-refund-integrity.md)
for migration 029, partial refunds and uncertain-result recovery.

### Historical payment recovery recipe

Use project, date and volume limits together, preview with `--dry-run`, then inspect
the import counters. Imported payments mark their administrative notification as
already handled without creating an activity, email or SMS. A later Checkout
webhook keeps such payments silent and does not automatically generate or email
their invoice. A new live confirmation still creates its normal activity and messages.

Backfill and webhook replays initialize consent/name from Stripe only when inserting
a contribution. Existing local consent, public name and non-charity acknowledgment
remain unchanged. One successful PaymentIntent contributes one ledger movement;
conflicting amount/currency on a repeated insertion fails for investigation.
Existing payment rows are preserved; fee updates still use `charge.updated`.

From **À traiter**, open the specific missing invoice, confirm its generation and
download its PDF. This operation requires owner access and scope confirmation at
the API boundary, creates an audit entry, and does not email the sponsor. Repeating
the import, late webhooks or invoice generation keeps the same document and number.
See the [invoice API contract](admin-api.md) and
[disposable browser recipe](../../tests/playwright/historical-payment-recovery-acceptance.spec.ts).
The recipe exercises the real CLI, API, database and Web against simulated Stripe
and captured SMTP, with bounded imports and FR/EN public exports. It performs no
production import, invoice issuance or external delivery.
