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

## Fund transparency module (V1)

### Environment variables

Set these variables for API and webhook processing:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `DATABASE_URL`

Example values are available in [.env.example](.env.example).

### Database migration

Apply the SQL migration in your PostgreSQL instance:

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
- Storage limited to aggregate-safe finance fields

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
