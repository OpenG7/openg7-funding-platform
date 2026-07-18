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

- `FUNDING_BUSINESS_SPONSORSHIP_ENABLED` - set to `true` only when the business sponsorship flow is ready to accept new sponsorship checkouts. Defaults to `false`.
- `FUNDING_ADMIN_TOKEN` - required in production as the root secret used to create admin sessions.
- `FUNDING_ADMIN_SESSION_SECRET` - optional but recommended separate HMAC secret for signed admin browser sessions.
- `FUNDING_ADMIN_SESSION_TTL_MINUTES` - optional admin session duration, defaulting to 60 minutes.
- `FUNDING_SPONSOR_LOGO_STORAGE_DIR` - private API filesystem directory for uploaded sponsor logos.
- `FUNDING_SPONSOR_LOGO_MAX_BYTES` - optional sponsor logo upload size limit, defaulting to 524288 bytes.
- `FUNDING_EMAIL_FROM`, `FUNDING_EMAIL_REPLY_TO`, `FUNDING_ADMIN_NOTIFICATION_EMAIL`, `RESEND_API_KEY` - optional Resend email settings used to send sponsorship confirmations, follow-up links, admin publication-batch alerts, and setup tests.
- `FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS`, `FUNDING_EMAIL_QUEUE_BATCH_SIZE` - optional email queue worker settings.
- `FUNDING_SPONSORSHIP_INVOICE_PREFIX`, `FUNDING_INVOICE_ISSUER_NAME`, `FUNDING_INVOICE_ISSUER_EMAIL`, `FUNDING_INVOICE_ISSUER_ADDRESS`, `FUNDING_INVOICE_TAX_ID`, `FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL`, `FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE` - optional sponsorship invoice identity and legal text displayed in app-generated invoice emails.

For the initial production launch, you can leave `DATABASE_URL` unset. Public transparency reads directly from Stripe so the platform can launch without PostgreSQL.

When `FUNDING_PLATFORM_ENV=production`, checkout mock fallbacks are disabled. Missing Stripe configuration returns an API error instead of simulating a successful checkout.

Example values are available in [.env.example](.env.example).

### Fast launch without PostgreSQL

For the first launch, PostgreSQL is intentionally not used. When `DATABASE_URL` is absent and `STRIPE_SECRET_KEY` is configured, the public transparency endpoint aggregates recent Stripe Checkout sessions and payouts directly from Stripe:

```bash
GET http://localhost:3333/api/public/fund-transparency
```

This is the default quick-launch path. It avoids local persistence while still showing real Stripe totals.

### Optional private PostgreSQL

PostgreSQL is optional and must stay private. The Compose service is behind the `database` profile and publishes no `5432` port.

Enable it only when you are ready to persist checkout sessions and webhook state:

```env
POSTGRES_DB=openg7_funding
POSTGRES_USER=openg7_funding
POSTGRES_PASSWORD=replace_with_a_long_random_secret
DATABASE_URL=postgres://openg7_funding:replace_with_a_long_random_secret@postgres:5432/openg7_funding
```

Start the private database:

```bash
docker compose --profile database up -d postgres
```

Apply the versioned migrations:

```sql
\i apps/funding-api/migrations/001_create_fund_transparency_tables.sql
\i apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql
\i apps/funding-api/migrations/003_add_sponsorship_details.sql
\i apps/funding-api/migrations/004_add_sponsorship_review.sql
\i apps/funding-api/migrations/005_add_sponsorship_followup_token.sql
\i apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql
\i apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql
\i apps/funding-api/migrations/008_add_sponsorship_publication_batches.sql
\i apps/funding-api/migrations/009_add_contribution_public_reference.sql
\i apps/funding-api/migrations/010_create_email_messages.sql
\i apps/funding-api/migrations/011_create_sponsorship_invoices.sql
```

These create:

- `fund_transactions` (Stripe event level, aggregate-safe values only)
- `fund_allocations` (publicly publishable allocations)
- `stripe_events` (future webhook idempotency)
- `stripe_checkout_sessions` (created Checkout Sessions)
- `fund_contributions` (pending contribution records, sponsor follow-up details, private review status, hashed follow-up tokens, and sponsor feed placement fields)
- `sponsor_publication_drafts` (private sponsored publication drafts for manual review)
- `admin_audit_log` (private admin action log)
- `email_messages` (queued email templates with retry status)
- `sponsorship_invoices` (private app-generated sponsorship invoice snapshots)

When `DATABASE_URL` is absent, the API continues to run with Stripe-direct public transparency.

### Fundraiser admin

The MVP admin dashboard is available at:

```text
/admin/fundraiser
```

The browser entry point is protected by a lightweight frontend session gate.
Open `/admin/login`, enter `FUNDING_ADMIN_TOKEN`, and the frontend exchanges it
through `POST /api/admin/session` before loading `/admin/fundraiser` or any
`/admin/fundraiser/...` child route. The API remains the source of truth for
authorization on every admin endpoint.

It exposes private operational views through:

```text
GET /api/admin/dashboard
POST /api/admin/session
GET /api/admin/contributions
GET /api/admin/contributions.csv
GET /api/admin/expenses
POST /api/admin/expenses
POST /api/admin/expenses/update
GET /api/admin/transparency
GET /api/admin/publication-drafts
POST /api/admin/publication-drafts
POST /api/admin/publication-drafts/update
GET /api/admin/audit-log
GET /api/admin/setup-status
POST /api/admin/email/test
GET /api/admin/sponsorship-invoices
POST /api/admin/sponsorship-invoices/resend
```

The dashboard summarizes received funds, estimated availability, pending
sponsorship reviews, feed publication state, Stripe event errors, and recent
contributions. The contributions view supports local filtering by type, payment
status, public-display consent, and search, with a CSV export for private admin
review. The expenses view manages publishable fund allocations backed by
`fund_allocations`, and the transparency view compares the public summary with
published allocations. The publications view generates and moderates sponsored
publication drafts for approved sponsorships, while the audit view lists recent
sensitive admin actions.

The operational setup page is available at `/admin/fundraiser/setup`. It
checks Stripe, email, invoice, queue, database and environment readiness,
includes a small in-app guide, and can send an admin email test through the
queued email system without exposing secret values.

The sponsorship invoice page is available at `/admin/fundraiser/invoices`. It
lists app-generated sponsorship invoices, shows Stripe references and latest
email delivery status, and can resend the invoice email to the recorded sponsor
contact or a corrected admin-entered address.

### Sponsorship review admin

The MVP admin review screen is available at:

```text
/admin/fundraiser/sponsors
```

It reads and updates private sponsorship records through:

```text
GET /api/admin/sponsorships
GET /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo
POST /api/admin/sponsorships/logo/delete
POST /api/admin/sponsorships/review
POST /api/admin/sponsorships/publication
```

In production, first exchange `FUNDING_ADMIN_TOKEN` from `/admin/login` through
`POST /api/admin/session`. The browser admin then calls operational endpoints
with `Authorization: Bearer <sessionToken>`. The static token remains accepted
for scripts and backwards-compatible admin operations. In local development,
admin endpoints can be used without a token when `FUNDING_ADMIN_TOKEN` is unset,
but the frontend admin routes still expect a browser session.

The publication endpoint prepares the public sponsor profile and records feed
placement metadata:

- public slug and short public summary
- feed target: `openg7` or `openg20`
- feed channels: `facebook` and/or `linkedin`
- feed status: `not_planned`, `planned`, `drafted`, or `published`
- optional public post URL once a publication exists

It does not post automatically to Facebook or LinkedIn.

When an admin refuses a sponsorship from `/admin/fundraiser/sponsors`, the
review flow requires an internal refusal reason, can send a sponsor-facing
email through the queued email system, and records the chosen refund handling
(`none`, manual refund required, or manual refund already completed) in the
admin audit metadata. It does not trigger a Stripe refund automatically yet;
Stripe refunds remain a deliberate manual operation until a dedicated refund
confirmation workflow is added.

Sponsor logos can be uploaded by admins through
`POST /api/admin/sponsorships/logo`. The API accepts PNG, JPEG, and WebP files
only, validates MIME type and file signature, stores the file outside the web
bundle, records the controlled `/api/public/sponsor-logos/...` URL on the
sponsorship, and audits the upload. Admins can preview controlled logos through
`GET /api/admin/sponsorships/logo`, replace a logo with cleanup of the previous
controlled file, or remove the logo with `POST /api/admin/sponsorships/logo/delete`.
Uploaded logos are served publicly only when an approved, consented sponsorship
references that exact URL.

### Public sponsorship page

Approved, consented sponsorships are exposed through:

```text
GET /api/public/sponsorships
GET /api/public/sponsor-logos/<file>
```

The public pages are:

```text
/commanditaires
/en/commanditaires
```

Only paid sponsorships with `public_display_consent=true`,
`sponsor_review_status=approved`, and a company name are returned. Private
contact fields, Stripe ids, emails, and internal notes are never exposed.

### Usage and refund policy

The public policy pages are:

```text
/politique-utilisation-remboursement
/en/politique-utilisation-remboursement
```

They explain contribution use, Stripe payment handling, refund requests,
disputes, sponsorship review, feed visibility, and privacy limits. Keep this
policy reviewed before accepting real payments.

### Sponsorship follow-up links

Paid sponsorships receive a non-guessable follow-up token when Checkout is
created. The token is stored server-side as a hash, is no longer written to new
Stripe metadata as a raw secret, and expires after
`FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS` days. The public recovery/status
page is:

```text
/fonds-des-batisseurs/suivi-commandite?token=...
```

It can reload the sponsorship status and resubmit company details through:

```text
GET /api/sponsorship-followup?token=...
POST /api/sponsorship-followup/details
```

When PostgreSQL, `RESEND_API_KEY`, `FUNDING_EMAIL_FROM`, and migration 011 are
configured, the `checkout.session.completed` webhook queues the follow-up link
and creates an app-generated sponsorship invoice snapshot for the Stripe
customer email. The invoice includes a stable invoice number, issuer details,
sponsor recipient snapshot, Stripe references, line item, totals, tax label,
and a non-charity receipt disclaimer. Without email configuration, the immediate
Stripe return shows a tokenized follow-up action; if the tab is closed, admins
can still see the paid but incomplete sponsorship from the admin screen. If
details are
resubmitted after approval, the sponsorship returns to `pending_review` before
any public display continues. Without PostgreSQL, Stripe-direct transparency
still works, but the recoverable sponsorship follow-up and public sponsor
profile lifecycle are not available.

The API also applies in-process rate limits to checkout, sponsorship follow-up,
and admin sponsorship routes. Configure the window and limits with
`FUNDING_RATE_LIMIT_WINDOW_MS`, `FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX`,
`FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX`, and
`FUNDING_ADMIN_RATE_LIMIT_MAX`; keep proxy-level limits enabled as a second
layer in production.

### Stripe webhook endpoint

Webhook URL (local):

- `POST http://localhost:3333/api/stripe/webhook`

Handled events:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `payout.paid`
- `payout.failed`

Behavior:

- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- Idempotency through unique `stripe_event_id` and `processing_status`
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
stripe trigger checkout.session.completed
stripe trigger checkout.session.expired
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger charge.refunded
stripe trigger charge.dispute.created
stripe trigger payout.paid
stripe trigger payout.failed
```

### Replay failed Stripe webhook events

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
endpoint can also be provided through `STRIPE_WEBHOOK_ENDPOINT_ID`. Replaying a
`checkout.session.completed` sponsorship event can resend the follow-up email
when email configuration is active.

### Stripe historical backfill to PostgreSQL

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

If `DATABASE_URL` uses the private Docker host `postgres`, run the backfill
inside Docker Compose instead:

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
- [Command cheatsheet](docs/command-cheatsheet.md)
