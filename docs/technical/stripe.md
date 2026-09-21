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
- `--no-assume-non-charity-acknowledged` keeps legacy sessions without that
  metadata out of contribution totals.

Backfill is safe to rerun. Checkout rows are keyed by `stripe_session_id`, and
fund transactions are skipped when the same logical Stripe object and event type
already exist. Synthetic `stripe_event_id` values use the
`stripe-backfill:<event-type>:<stripe-object-id>` form.
