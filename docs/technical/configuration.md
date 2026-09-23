# Configuration and startup

Reference extracted from the main README. Read only the relevant section; current
feature guides and implementation define the exact contract. Commands run from
the repository root. [Documentation index](../README.md).

## Environment variables

Set these variables for API and webhook processing:

- `STRIPE_SECRET_KEY` — required for real checkout and Stripe-direct public statistics.
- `STRIPE_WEBHOOK_SECRET` — required only when validating Stripe webhook deliveries.
- `FUNDING_ALLOWED_ORIGINS` — comma-separated browser origins allowed to call the API in production.

- `FUNDING_BUSINESS_SPONSORSHIP_ENABLED` - set to `true` only when the business sponsorship flow is ready to accept new sponsorship checkouts. Defaults to `false`.
- `FUNDING_ADMIN_AUTH_MODE` - `token` by default; `oidc` enables named accounts, MFA, API roles and revocable sessions.
- `FUNDING_ADMIN_TOKEN` - root secret required for production admin access in `token` mode; rejected as an authentication method in `oidc` mode.
- `FUNDING_ADMIN_SESSION_SECRET` - recommended separate HMAC secret for signed browser sessions in `token` mode.
- `FUNDING_ADMIN_SESSION_TTL_MINUTES` - token-mode session duration, defaulting to 60 minutes. OIDC sessions currently last one hour without automatic renewal.
- `FUNDING_ADMIN_OIDC_ISSUER`, `FUNDING_ADMIN_OIDC_CLIENT_ID`, `FUNDING_ADMIN_OIDC_CLIENT_SECRET`, `FUNDING_ADMIN_OIDC_OWNER_SUBJECTS`, `FUNDING_ADMIN_OIDC_MFA_ACR` - server-only identity configuration; see the [identity and alerts runbook](../operations/admin-identity-and-alerts.md).
- `FUNDING_OPERATIONS_WEBHOOK_URL`, `FUNDING_OPERATIONS_WEBHOOK_SECRET` - optional independent signed alert channel, enabled by configuring and starting the operations watcher.
- `FUNDING_CONTRIBUTION_EMAIL_ENABLED`, `FUNDING_CONTRIBUTION_SMS_MODE`, `FUNDING_CONTRIBUTION_SMS_MOCK_URL` — private payment-notification settings, disabled by default; see [contribution activity](../operations/contribution-activity.md). `STRIPE_SIMULATED_CHECKOUT_ENABLED` is a separate local-only acceptance setting.
- `SPONSOR_MEDIA_STORAGE_DRIVER` - sponsor media storage backend. Use `local` for filesystem storage or `ovh-s3` for OVH Object Storage.
- `FUNDING_SPONSOR_LOGO_STORAGE_DIR` - private API filesystem directory for uploaded sponsor logos when `SPONSOR_MEDIA_STORAGE_DRIVER` is `local`.
- `FUNDING_SPONSOR_LOGO_MAX_BYTES` - optional sponsor logo upload size limit, defaulting to 524288 bytes.
- `SPONSOR_MEDIA_REGION`, `SPONSOR_MEDIA_ENDPOINT`, `SPONSOR_MEDIA_PUBLIC_BUCKET`, `SPONSOR_MEDIA_PUBLIC_BASE_URL`, `SPONSOR_MEDIA_PRIVATE_BUCKET`, `SPONSOR_MEDIA_PRIVATE_BASE_URL`, `OVH_S3_ACCESS_KEY_ID`, `OVH_S3_SECRET_ACCESS_KEY` - required when `SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3`. The API stores uploaded controlled sponsor logos in the private bucket and never exposes the OVH credentials to browsers.
- `SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS`, `MAIL_REPLY_TO_NAME`, `MAIL_REPLY_TO_ADDRESS` - SMTP settings for low-volume transactional email. See [docs/email-smtp.md](../email-smtp.md).
- `FUNDING_ADMIN_NOTIFICATION_EMAIL` - optional internal notification recipient for publication-batch alerts.
- `FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX` - optional public OpenG7 reference lookup limit, defaulting to 30 requests per window.
- `FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX` - optional public reference recovery rate limit, defaulting to 10 requests per window.
- `FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS`, `FUNDING_EMAIL_QUEUE_BATCH_SIZE` - optional email queue worker settings.
- `SOCIAL_PUBLICATION_MODE` - `disabled` by default, `mock` for local/E2E social publishing, or `live` for real Facebook/LinkedIn publishing after credentials are configured.
- `SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL`, `SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID`, `SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN`, `SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL`, `SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID`, `SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN`, `SOCIAL_PUBLICATION_LINKEDIN_VERSION` - social provider settings used only by the API; never expose the tokens to browsers.
- `FUNDING_SPONSORSHIP_INVOICE_PREFIX`, `FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX`, `FUNDING_INVOICE_ISSUER_NAME`, `FUNDING_INVOICE_ISSUER_EMAIL`, `FUNDING_INVOICE_ISSUER_ADDRESS`, `FUNDING_INVOICE_TAX_ID`, `FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL`, `FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE`, `FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE` - optional sponsorship invoice/credit-note identity and legal text displayed in app-generated invoice and credit-note emails.

For the initial production launch, you can leave `DATABASE_URL` unset. Public transparency reads directly from Stripe so the platform can launch without PostgreSQL.

When `FUNDING_PLATFORM_ENV=production`, checkout mock fallbacks are disabled. Missing Stripe configuration returns an API error instead of simulating a successful checkout.

Example values are available in [.env.example](../../.env.example).

SMTP can be verified without sending a message:

```bash
npm run email:verify
```

Send a manual test only to an explicitly provided recipient:

```bash
npm run email:test -- --to=adresse@example.com
```

## Fast launch without PostgreSQL

When `DATABASE_URL` is absent and `STRIPE_SECRET_KEY` is configured, the public
transparency endpoint aggregates Stripe Checkout sessions and payouts directly
from Stripe. This is a limited deployment option:

```bash
GET http://localhost:3333/api/public/fund-transparency
```

This is the default quick-launch path. It avoids local persistence while still showing real Stripe totals.

## Optional private PostgreSQL

PostgreSQL is optional and must stay private. The Compose service is behind the `database` profile and publishes no `5432` port.

Enable it for persistent checkout/webhook state, sponsor follow-up, directories,
administration, OIDC and alert episodes:

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

For a **fresh local database**, apply all versioned migrations:

```bash
yarn db:migrate
```

Read the current migration inventory and the
[migration procedure and replay limitation](../operations/database-migrations.md)
before updating an existing database: the runners currently replay every file,
and migrations `019`–`021` cannot be applied twice.

The initial migrations create the tables below; consult the linked inventory
for later publication automation and administrative command receipt tables:

- `fund_transactions` (Stripe event level, aggregate-safe values only)
- `fund_allocations` (publicly publishable allocations)
- `stripe_events` (webhook idempotency and processing status)
- `stripe_checkout_sessions` (created Checkout Sessions)
- `fund_contributions` (pending contribution records, sponsor follow-up details, private review status, hashed follow-up tokens, and sponsor feed placement fields)
- `sponsor_publication_drafts` (private sponsored publication drafts for manual review)
- `sponsor_publication_batches` (collective Facebook/LinkedIn publication batches)
- `publication_slots` (capacity-bound publication calendar slots by target, channel, date and timezone)
- `social_publication_jobs` (idempotent social provider publication jobs)
- `admin_audit_log` (private admin action log)
- `email_messages` (queued email templates with retry status)
- `sponsorship_invoices` (private app-generated sponsorship invoice snapshots)
- `sponsorship_credit_notes` (private app-generated sponsorship credit-note snapshots tied to Stripe refunds)
- `sponsor_media_assets` (private originals and reviewed public media)
- `sponsorship_access_tokens`, `sponsorship_followup_drafts` (access recovery and revision-protected drafts)
- `admin_accounts`, `admin_identity_sessions`, `admin_login_challenges` (OIDC access)
- `operations_alerts` (persistent incident episodes and delivery retries)

Migration `018` also adds achievement/proof fields to public allocations.

When `DATABASE_URL` is absent, the API continues to run with Stripe-direct public transparency.

## Local setup stepper

The developer-only setup assistant is available at:

- `/dev/stripe-setup`

It displays the PowerShell commands, Stripe Dashboard URLs, local webhook URL, copy buttons, open buttons, and a local progress checklist stored in `localStorage`.

The browser never executes shell commands and never reads secret values. The API only exposes non-sensitive readiness flags through:

- `GET /api/dev/stripe-setup-status`

This diagnostic endpoint is disabled when `FUNDING_PLATFORM_ENV=production`.
