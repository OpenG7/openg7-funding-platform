# OpenG7 Funding Platform

Reusable, transparent and configurable funding engine for OpenG7 ecosystem projects.

## Workspace architecture

- `apps/funding-web`: Angular standalone funding experience.
- `packages/funding-core`: reusable funding domain logic and checkout contract.
- `packages/funding-ui`: reusable design tokens.
- `packages/funding-models`: immutable funding models.
- `packages/funding-i18n`: shared translation keys and locale metadata.

## Signal-first approach

Use Angular `signal()`, `computed()` and `effect()` for local visual/UI state (selection, panel toggles, local loading, animation state). Keep component state local and reactive.

## NgRx guidance

Use NgRx only for shared and persistent funding data:

- confirmed contribution totals
- shared campaign information
- allocation data
- contributor records
- backend synchronization state

Do **not** use NgRx for purely visual state.

## Reuse in other projects

Install and import workspace packages:

- `@openg7/funding-models`
- `@openg7/funding-core`
- `@openg7/funding-ui`
- `@openg7/funding-i18n`

Provide project-specific configuration with the funding config provider.

## OpenG7 example configuration

`apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts` ships with:

- Project: OpenG7
- Campaign: Le Fonds des Bâtisseurs
- Currency: CAD
- Locale: fr-CA
- Monthly goal: 270
- Contribution amounts: 5, 10, 25, 50

## Commands

```bash
corepack enable
yarn install
yarn lint
yarn format
yarn format:check
yarn test
yarn build
yarn docs
```

## Production launch

Use [docs/production-launch-checklist.md](docs/production-launch-checklist.md) for the first public launch runbook. The initial production path is Stripe-direct and does not require PostgreSQL.

## Fund transparency module (V1)

### Environment variables

Set these variables for API and webhook processing:

- `STRIPE_SECRET_KEY` — required for real checkout and Stripe-direct public statistics.
- `STRIPE_WEBHOOK_SECRET` — required only when validating Stripe webhook deliveries.
- `FUNDING_ALLOWED_ORIGINS` — comma-separated browser origins allowed to call the API in production.

For the initial production launch, do **not** set `DATABASE_URL`. Public transparency reads directly from Stripe so the platform can launch without PostgreSQL.

When `FUNDING_PLATFORM_ENV=production`, checkout mock fallbacks are disabled. Missing Stripe configuration returns an API error instead of simulating a successful checkout.

Example values are available in [.env.example](.env.example).

### Fast launch without PostgreSQL

For the first launch, PostgreSQL is intentionally not used. When `DATABASE_URL` is absent and `STRIPE_SECRET_KEY` is configured, the public transparency endpoint aggregates recent Stripe Checkout sessions and payouts directly from Stripe:

```bash
GET http://localhost:3333/api/public/fund-transparency
```

This is the default quick-launch path. It avoids local persistence while still showing real Stripe totals.

### Future optional database migration

This is not part of the initial launch. Apply the SQL migration only later, if you decide to add a local transparency journal in PostgreSQL:

```sql
\i apps/funding-api/migrations/001_create_fund_transparency_tables.sql
```

This creates:

- `fund_transactions` (Stripe event level, aggregate-safe values only)
- `fund_allocations` (publicly publishable allocations)

No personal contributor data is stored for transparency reporting.

### Stripe webhook endpoint

Webhook URL (local):

- `POST http://localhost:3333/api/stripe/webhook`

Handled events:

- `payment_intent.succeeded`
- `charge.refunded`
- `payout.paid`
- `payout.failed`

Behavior:

- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- Idempotency through unique `stripe_event_id`
- Optional `balance_transaction` retrieval to compute fee/net fields
- For the fast launch, webhook deliveries are validated and acknowledged without local storage
- Public statistics come from Stripe directly while `DATABASE_URL` remains unset

### Test with Stripe CLI

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
stripe trigger payment_intent.succeeded
stripe trigger charge.refunded
stripe trigger payout.paid
stripe trigger payout.failed
```

### Local setup stepper

The developer-only setup assistant is available at:

- `/dev/stripe-setup`

It displays the PowerShell commands, Stripe Dashboard URLs, local webhook URL, copy buttons, open buttons, and a local progress checklist stored in `localStorage`.

The browser never executes shell commands and never reads secret values. The API only exposes non-sensitive readiness flags through:

- `GET /api/dev/stripe-setup-status`

This diagnostic endpoint is disabled when `FUNDING_PLATFORM_ENV=production`.

### Public read-only endpoint

Endpoint:

- `GET /api/public/fund-transparency`

Returns only aggregated values:

- `total_received`
- `total_fees`
- `total_net`
- `total_refunded`
- `total_payouts`
- `current_available_estimate`
- `contributions_count`
- `currency`
- `monthly_summary`
- `latest_public_allocations`
- `last_updated_at`

### Frontend transparency page

Public route:

- `/fonds-des-batisseurs/transparence`

The page consumes `/api/public/fund-transparency` and displays civic, readable aggregate reporting with an explicit privacy statement.

## Production deployment

The production stack uses Docker Compose, Traefik, Let's Encrypt, Nginx, and the Node funding API.

Full OVH VPS deployment documentation:

- [Docker deployment guide](docs/docker-deployment.md)
