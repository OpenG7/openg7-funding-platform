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
- `FUNDING_ADMIN_AUTH_MODE` - `oidc` is required in production for named accounts, MFA, API roles and revocable sessions. `token` administration is limited to development/test.
- `FUNDING_ADMIN_TOKEN` - random root secret of at least 32 characters, required for local/test `token` administration; ignored in `oidc` mode.
- `FUNDING_ADMIN_SESSION_SECRET` - independent random HMAC secret of at least 32 characters, required for `token` administration and distinct from `FUNDING_ADMIN_TOKEN`; ignored in `oidc` mode.
- `FUNDING_ADMIN_SESSION_TTL_MINUTES` - token-mode duration: integer from 1 to 60 minutes, default 60. OIDC sessions last one hour without automatic renewal.
- `FUNDING_ADMIN_OIDC_ISSUER`, `FUNDING_ADMIN_OIDC_CLIENT_ID`, `FUNDING_ADMIN_OIDC_CLIENT_SECRET`, `FUNDING_ADMIN_OIDC_OWNER_SUBJECTS`, `FUNDING_ADMIN_OIDC_MFA_ACR` - server-only identity configuration; see the [identity and alerts runbook](../operations/admin-identity-and-alerts.md).
- `FUNDING_PRIVATE_DATA_ENCRYPTION_KEY` - private API key of exactly 32 random bytes in standard base64, required in production. Keep an independent protected recovery copy; a malformed configured key is rejected in every environment.
- `DATABASE_URL` - private PostgreSQL connection, required for OIDC, real Checkout and all production API starts. Production uses a limited runtime role distinct from the migration owner; see [private PostgreSQL](#private-postgresql).
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

Sponsorship tiers and included benefits come from
[`DEFAULT_SPONSORSHIP_PRICING_CONFIG`](../../packages/funding-core/src/sponsorship-pricing.ts)
and [`resolveSponsorshipBenefits`](../../packages/funding-core/src/sponsorship-benefits.ts)
in `funding-core`. The API uses that policy for private follow-up data, email
descriptions, the admin attention queue and private contribution website cards. Its
[social channel mapping](../../apps/funding-api/src/sponsorship-benefits.ts)
also supplies publication settings; review, visibility and publication
authorization remain separate decisions.

Production startup requires OIDC, PostgreSQL with the complete current schema,
the limited database runtime role and the private-data encryption key. Prepare
the HTTPS provider, confidential client, MFA and first owner accounts according
to the [identity runbook](../operations/admin-identity-and-alerts.md) before starting the API.
The API verifies database privileges before opening its listener.

`.env.example` and Compose select `oidc`. A standalone API defaults to `token`
when `FUNDING_ADMIN_AUTH_MODE` is absent, which production rejects; set the mode
explicitly. `FUNDING_PLATFORM_ENV` takes precedence over `NODE_ENV`, with
`development`, `test` and `production` as the only accepted values.

When `FUNDING_PLATFORM_ENV=production`, checkout mock fallbacks are disabled.
An absent `STRIPE_SECRET_KEY` blocks API startup.

Example values are available in [.env.example](../../.env.example).

SMTP can be verified without sending a message:

```bash
npm run email:verify
```

Send a manual test only to an explicitly provided recipient:

```bash
npm run email:test -- --to=adresse@example.com
```

## Development without PostgreSQL

Compatible development configurations can use Stripe-direct public transparency
without PostgreSQL: select `FUNDING_PLATFORM_ENV=development` and `token` mode
with the two independent token secrets described above.
With `STRIPE_SECRET_KEY` configured, the endpoint aggregates Stripe Checkout
sessions and payouts directly:

```bash
GET http://localhost:3333/api/public/fund-transparency
```

This path cannot start an OIDC or production API. Real Checkout requires durable
PostgreSQL operations even in development; local simulation remains separate.

## Private PostgreSQL

PostgreSQL is required for production, OIDC and real Checkout. The Compose service
stays private behind the `database` profile and publishes no `5432` port.

On an authorized fresh environment, configure distinct migration and API roles:

```env
POSTGRES_DB=openg7_funding
POSTGRES_USER=openg7_funding_owner
POSTGRES_PASSWORD=replace_with_a_long_random_secret
FUNDING_DATABASE_RUNTIME_USER=openg7_funding_api
FUNDING_DATABASE_RUNTIME_PASSWORD=replace_with_a_different_long_random_secret
DATABASE_URL=postgres://openg7_funding_api:replace_with_a_different_long_random_secret@postgres:5432/openg7_funding
```

Start the private database:

```bash
docker compose --profile database up -d postgres
```

For a **fresh local database**, apply the complete migration directory before
provisioning the runtime role. Clear its override for this first application:

```bash
FUNDING_DATABASE_RUNTIME_USER= yarn db:migrate
```

Then follow the [runtime-role provisioning procedure](../docker-deployment.md#compte-postgresql-applicatif)
before starting the API. `POSTGRES_USER` remains on the host and PostgreSQL
container for migrations; never use it in the production API's `DATABASE_URL`.
The API rejects administrative, owner and destructive privileges. URL-encode
reserved characters in the runtime password.

The [migration procedure and inventory](../operations/database-migrations.md)
owns database targeting and upgrades. The runner checks the registry and file
checksums, then applies only pending migrations in one transaction. A nonempty
existing database without a registry requires reviewed history adoption before
application; table presence alone is insufficient. Use the full current schema,
including migration `020` for OIDC, rather than stopping at that minimum.
Production migration and role provisioning require authorization for the target.

The PostgreSQL migration owner and the API runtime role have separate credentials;
Keycloak, when self-hosted, uses its own independent database.

## Local setup stepper

The developer-only setup assistant is available at:

- `/dev/stripe-setup`

It displays the PowerShell commands, Stripe Dashboard URLs, local webhook URL, copy buttons, open buttons, and a local progress checklist stored in `localStorage`.

The browser never executes shell commands and never reads secret values. The API only exposes non-sensitive readiness flags through:

- `GET /api/dev/stripe-setup-status`

This diagnostic endpoint is disabled when `FUNDING_PLATFORM_ENV=production`.
