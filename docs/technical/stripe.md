# Stripe webhooks, replay and backfill

Reference extracted from the main README. Read only the relevant section; current
feature guides and implementation define the exact contract. Commands run from
the repository root. [Documentation index](../README.md).

Live mode, production targets and backfill require the
[high-risk procedure](../../AGENTS.md#risque-eleve), bounded scope and backup where needed.
Read the [migration procedure](../operations/database-migrations.md) before migrations.

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
- `charge.dispute.created`
- `payout.paid`
- `payout.failed`

Behavior:

- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- Idempotency through unique `stripe_event_id` and `processing_status`
- PostgreSQL serializes each event on a dedicated connection; interrupted
  processing can resume on redelivery, while concurrent deliveries receive
  `503` for retry and completed duplicates receive `200`.
- Delayed failures cannot replace confirmed payment, dispute, or refund states.
- Sponsorship follow-up and invoice emails are queued for the email worker.
- Optional `balance_transaction` retrieval to compute fee/net fields
- For the fast launch, webhook deliveries are validated and acknowledged without local storage
- Public statistics come from Stripe directly while `DATABASE_URL` remains unset

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

The explicit Docker command is also available:

```bash
corepack yarn stripe:backfill:docker --dry-run
corepack yarn stripe:backfill:docker
```

For live mode, the command refuses non-live keys when `--live` is present:

```bash
corepack yarn stripe:backfill:live --from 2026-01-01 --dry-run
corepack yarn stripe:backfill:live --from 2026-01-01
corepack yarn stripe:backfill:docker:live --from 2026-01-01 --dry-run
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

Backfill is idempotent for matching financial facts. Checkout rows are keyed by `stripe_session_id`, and
fund transactions are skipped when the same logical Stripe object and event type
already exist. Synthetic `stripe_event_id` values use the
`stripe-backfill:<event-type>:<stripe-object-id>` form.

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
