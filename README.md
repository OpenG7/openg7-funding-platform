# OpenG7 Funding Platform

![OpenG7 — Le Fonds des Bâtisseurs](docs/images/openg7-fonds-des-batisseurs-banner.png)

Reusable, transparent and configurable funding engine for OpenG7 ecosystem projects.

See the [current platform status](docs/platform-status.md) for available features,
validation evidence and remaining operational checks. The older MVP documents
describe the project's evolution and should not be used alone as a current backlog.
The [documentation index](docs/README.md) separates current feature guides,
operational procedures and historical design/validation reports.

## Workspace architecture

- `apps/funding-web`: Angular standalone funding experience.
- `apps/funding-api`: Node API, payments, administration, media and email workers.
- `apps/production-launch-agent`: optional controlled VPS operations tooling.
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

### Recette admin isolée

Avec Node 22, Yarn 4, Docker local (conteneurs Linux) et Chromium installé :

```bash
yarn playwright:install
yarn test:ui:admin
docker pull postgres:16-alpine
docker pull axllent/mailpit:v1.27.4
docker pull adobe/s3mock:5.1.0
yarn test:integration:payments
yarn test:e2e:acceptance
```

La recette Docker crée ses propres conteneurs, réseaux et données temporaires,
sans charger le `.env` applicatif ni réutiliser les volumes locaux. Stripe est
simulé, SMTP est désactivé et les publications sociales sont simulées.
Les rapports sont conservés sous `test-results/acceptance/` et dans les artefacts
du workflow de PR. Voir le [bilan et les limites de la recette](docs/admin-ux-lot-8.md).

Les intégrations utilisent aussi un fournisseur OIDC signé local, Mailpit et
S3Mock dans des conteneurs jetables. Pour les parcours publics et les contrôles
d'accessibilité sur Chromium, Firefox, WebKit et mobile WebKit :

```bash
yarn exec playwright install --with-deps chromium firefox webkit
yarn test:ui:public-journeys
yarn test:ui:platform-accessibility
```

Voir les [preuves locales et leurs limites](docs/platform-status.md). Ces suites
ne prouvent pas l'activation des services externes en production.

### HTTPS local approuve

Sous Windows, cette commande installe `mkcert` avec `winget` lorsqu'il est
absent, approuve son autorite locale, genere le certificat `localhost` et
redemarre Traefik avec la surcharge Docker locale :

```powershell
yarn tls:local:setup
```

Fermer et rouvrir Firefox apres la premiere execution. Pour renouveler le
certificat local :

```powershell
yarn tls:local:renew
```

Les certificats sont generes sous `traefik/certs/` et sont ignores par Git.
Cette configuration locale ne remplace pas les certificats Let's Encrypt de
production.

## Production launch

Use the [production checklist](docs/production-launch-checklist.md) for the
chosen deployment scope. Stripe-direct supports checkout and aggregate
transparency without PostgreSQL. Persistent administration, sponsor follow-up,
public directories, OIDC and operational alerts require the private database.

## Fund transparency module (V1)

### Environment variables

Set these variables for API and webhook processing:

- `STRIPE_SECRET_KEY` — required for real checkout and Stripe-direct public statistics.
- `STRIPE_WEBHOOK_SECRET` — required only when validating Stripe webhook deliveries.
- `FUNDING_ALLOWED_ORIGINS` — comma-separated browser origins allowed to call the API in production.

- `FUNDING_BUSINESS_SPONSORSHIP_ENABLED` - set to `true` only when the business sponsorship flow is ready to accept new sponsorship checkouts. Defaults to `false`.
- `FUNDING_ADMIN_AUTH_MODE` - `token` by default; `oidc` enables named accounts, MFA, API roles and revocable sessions.
- `FUNDING_ADMIN_TOKEN` - root secret required for production admin access in `token` mode; rejected as an authentication method in `oidc` mode.
- `FUNDING_ADMIN_SESSION_SECRET` - recommended separate HMAC secret for signed browser sessions in `token` mode.
- `FUNDING_ADMIN_SESSION_TTL_MINUTES` - token-mode session duration, defaulting to 60 minutes. OIDC sessions currently last one hour without automatic renewal.
- `FUNDING_ADMIN_OIDC_ISSUER`, `FUNDING_ADMIN_OIDC_CLIENT_ID`, `FUNDING_ADMIN_OIDC_CLIENT_SECRET`, `FUNDING_ADMIN_OIDC_OWNER_SUBJECTS`, `FUNDING_ADMIN_OIDC_MFA_ACR` - server-only identity configuration; see the [identity and alerts runbook](docs/operations/admin-identity-and-alerts.md).
- `FUNDING_OPERATIONS_WEBHOOK_URL`, `FUNDING_OPERATIONS_WEBHOOK_SECRET` - optional independent signed alert channel, enabled by configuring and starting the operations watcher.
- `SPONSOR_MEDIA_STORAGE_DRIVER` - sponsor media storage backend. Use `local` for filesystem storage or `ovh-s3` for OVH Object Storage.
- `FUNDING_SPONSOR_LOGO_STORAGE_DIR` - private API filesystem directory for uploaded sponsor logos when `SPONSOR_MEDIA_STORAGE_DRIVER` is `local`.
- `FUNDING_SPONSOR_LOGO_MAX_BYTES` - optional sponsor logo upload size limit, defaulting to 524288 bytes.
- `SPONSOR_MEDIA_REGION`, `SPONSOR_MEDIA_ENDPOINT`, `SPONSOR_MEDIA_PUBLIC_BUCKET`, `SPONSOR_MEDIA_PUBLIC_BASE_URL`, `SPONSOR_MEDIA_PRIVATE_BUCKET`, `SPONSOR_MEDIA_PRIVATE_BASE_URL`, `OVH_S3_ACCESS_KEY_ID`, `OVH_S3_SECRET_ACCESS_KEY` - required when `SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3`. The API stores uploaded controlled sponsor logos in the private bucket and never exposes the OVH credentials to browsers.
- `SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS`, `MAIL_REPLY_TO_NAME`, `MAIL_REPLY_TO_ADDRESS` - SMTP settings for low-volume transactional email. See [docs/email-smtp.md](docs/email-smtp.md).
- `FUNDING_ADMIN_NOTIFICATION_EMAIL` - optional internal notification recipient for publication-batch alerts.
- `FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX` - optional public OpenG7 reference lookup limit, defaulting to 30 requests per window.
- `FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX` - optional public reference recovery rate limit, defaulting to 10 requests per window.
- `FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS`, `FUNDING_EMAIL_QUEUE_BATCH_SIZE` - optional email queue worker settings.
- `SOCIAL_PUBLICATION_MODE` - `disabled` by default, `mock` for local/E2E social publishing, or `live` for real Facebook/LinkedIn publishing after credentials are configured.
- `SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL`, `SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID`, `SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN`, `SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL`, `SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID`, `SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN`, `SOCIAL_PUBLICATION_LINKEDIN_VERSION` - social provider settings used only by the API; never expose the tokens to browsers.
- `FUNDING_SPONSORSHIP_INVOICE_PREFIX`, `FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX`, `FUNDING_INVOICE_ISSUER_NAME`, `FUNDING_INVOICE_ISSUER_EMAIL`, `FUNDING_INVOICE_ISSUER_ADDRESS`, `FUNDING_INVOICE_TAX_ID`, `FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL`, `FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE`, `FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE` - optional sponsorship invoice/credit-note identity and legal text displayed in app-generated invoice and credit-note emails.

For the initial production launch, you can leave `DATABASE_URL` unset. Public transparency reads directly from Stripe so the platform can launch without PostgreSQL.

When `FUNDING_PLATFORM_ENV=production`, checkout mock fallbacks are disabled. Missing Stripe configuration returns an API error instead of simulating a successful checkout.

Example values are available in [.env.example](.env.example).

SMTP can be verified without sending a message:

```bash
npm run email:verify
```

Send a manual test only to an explicitly provided recipient:

```bash
npm run email:test -- --to=adresse@example.com
```

### Fast launch without PostgreSQL

When `DATABASE_URL` is absent and `STRIPE_SECRET_KEY` is configured, the public
transparency endpoint aggregates Stripe Checkout sessions and payouts directly
from Stripe. This is a limited deployment option:

```bash
GET http://localhost:3333/api/public/fund-transparency
```

This is the default quick-launch path. It avoids local persistence while still showing real Stripe totals.

### Optional private PostgreSQL

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

The current sequence runs through `021`. Read the
[migration procedure and replay limitation](docs/operations/database-migrations.md)
before updating an existing database: the runners currently replay every file,
and migrations `019`–`021` cannot be applied twice.

These create:

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

### Fundraiser admin

The admin dashboard is available at:

```text
/admin/fundraiser
```

Open `/admin/login`. In default `token` mode, the frontend exchanges
`FUNDING_ADMIN_TOKEN` through `POST /api/admin/session`. In `oidc` mode, it
redirects to the configured identity provider and requires verified MFA.
The browser then uses an HttpOnly cookie for a revocable server session.
The API checks authorization on every admin endpoint; Angular guards only
control navigation. Admin routes are loaded on demand from `admin.routes.ts`.

The [access and sessions page](docs/operations/admin-identity-and-alerts.md)
at `/admin/fundraiser/access` lets OIDC owners manage readers, operators and
owners, disable accounts and revoke sessions. Changing an account revokes its
sessions; the last active owner is protected. Token mode does not provide these
named-account guarantees. Independent alerts use `yarn operations:watch` or the
optional Compose overlay and remain disabled until configured and started.

The dashboard now uses the admin visual foundation described in
[Admin UX — lot 1](docs/admin-ux-lot-1.md). Run `yarn test:ui:admin` to build
and check this UI with synthetic API fixtures, without starting the API or a DB.
The [To do queue — lot 2](docs/admin-ux-lot-2.md) is available at
`/admin/fundraiser/attention`, with server pagination, URL filters, exact record
links and an independent dashboard summary. Its protected API is
`GET /api/admin/attention`. Missing invoices can be generated for one confirmed
record through the existing backfill endpoint, without sending email.
The [Contextual assistant — lot 3](docs/admin-ux-lot-3.md) adds dossier facts,
deterministic next steps and draft preparation to the cockpit and sponsorships.
`GET /api/admin/assistant/context` accepts an optional `sponsorshipId`.
Information requests show an editable preview and require human confirmation
through `POST /api/admin/sponsorships/request-information`; queue insertion
and audit are atomic and duplicate requests reuse the original email.
The [Sponsorship dossier — lot 4](docs/admin-ux-lot-4.md) adds seven linked tabs,
six independent milestones, persisted billing/publication/refund facts, session
selection in the cockpit and navigation badges from the same work queue.
`GET /api/admin/sponsorships/progress` accepts an optional `sponsorshipId` and
performs a read-only projection. Direct tab links use
`/admin/fundraiser/sponsors?sponsorshipId=<uuid>&tab=billing`.
The [Cockpit indicators, activity and system status — lot 5](docs/admin-ux-lot-5.md)
adds independent protected read endpoints under `/api/admin/cockpit/metrics`,
`/api/admin/cockpit/activity` and `/api/admin/cockpit/systems`. Amounts use integer
minor units per currency; missing fees keep net receipts unavailable. System
status shows dated evidence with expiration, without sending email or writing
test files. PostgreSQL integration uses an explicitly configured disposable
`cockpit_test` database; see the lot report for reproduction and coverage limits.
The [Global admin search — lot 6](docs/admin-ux-lot-6.md) adds
`POST /api/admin/search` with private JSON input, grouped dossier results and
bounded pagination. Use Ctrl+K / Cmd+K from the admin layout or shared navigation.
Search terms stay out of URLs and browser storage. Direct contribution links
accept `contributionId` before the list limit; invoice and publication pages
reload when their target changes on the same route. PostgreSQL search tests
require an explicitly configured fresh local `search_test` database.
The [Admin drawers and page harmonization — lot 7](docs/admin-ux-lot-7.md)
extends the shared FR/EN layout to the operational pages and adds accessible
inspection drawers, protected invoice/media previews and explicit action
confirmations. Stripe inspection returns minimal stored event facts without raw
webhook payloads. Audit and expense pages accept exact identifiers before list
limits. The PostgreSQL inspection test owns and removes its disposable container.
`GET /api/admin/dashboard` includes the additive `data_available` flag;
`false` means PostgreSQL is not configured and the UI must not present the
legacy zero-valued snapshot as an empty fund.

Selected operational endpoints (the feature guides in the
[documentation index](docs/README.md) describe the additional contracts):

```text
GET /api/admin/dashboard
POST /api/admin/search
GET /api/admin/stripe-event?eventId=evt_...
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
GET /api/admin/publication-batches
POST /api/admin/publication-batches
POST /api/admin/publication-batches/assign
POST /api/admin/publication-batches/unassign
POST /api/admin/publication-batches/schedule
POST /api/admin/publication-batches/publish
POST /api/admin/publication-batches/publish-social
POST /api/admin/publication-batches/cancel
GET /api/admin/publication-slots
POST /api/admin/publication-slots
POST /api/admin/publication-slots/update
POST /api/admin/publication-slots/assign-batch
POST /api/admin/publication-slots/assign-draft
POST /api/admin/publication-slots/publish
POST /api/admin/publication-slots/cancel
GET /api/admin/social-publication-jobs
GET /api/admin/audit-log
GET /api/admin/setup-status
POST /api/admin/email/test
GET /api/admin/email-queue
POST /api/admin/email-queue/retry
GET /api/admin/sponsorship-invoices
POST /api/admin/sponsorship-invoices/backfill
GET /api/admin/sponsorship-invoices/pdf?invoiceId=<uuid>
POST /api/admin/sponsorship-invoices/resend
GET /api/admin/sponsorship-credit-notes/pdf?creditNoteId=<uuid>
POST /api/admin/sponsorship-credit-notes/resend
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

The email queue page is available at `/admin/fundraiser/email-queue`. It lists
recent queued, sending, sent and failed emails, summarizes retryable failures,
and can manually retry an unsent message through `POST /api/admin/email-queue/retry`.
Manual retries are recorded in the admin audit log.

The sponsorship invoice page is available at `/admin/fundraiser/invoices`. It
lists app-generated sponsorship invoices, shows Stripe references and latest
email delivery status, shows credit notes generated after guided Stripe
refunds, downloads invoice or credit-note PDFs, and can resend either the
invoice email or the credit-note email to the recorded sponsor contact or a
corrected admin-entered address. The same page can run
`POST /api/admin/sponsorship-invoices/backfill` to generate missing invoices
for historical paid sponsorships without emailing sponsors automatically.

### Sponsorship review admin

The admin review screen is available at:

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
POST /api/admin/sponsorships/refund
POST /api/admin/sponsorships/publication
```

In `token` mode, first exchange `FUNDING_ADMIN_TOKEN` from `/admin/login` through
`POST /api/admin/session`. The browser admin then calls operational endpoints
with `Authorization: Bearer <sessionToken>`. The static token remains accepted
for scripts and backwards-compatible admin operations. In local development,
admin endpoints can be used without a token when `FUNDING_ADMIN_TOKEN` is unset,
but the frontend admin routes still expect a browser session. In `oidc` mode,
root tokens and legacy signed sessions are rejected; the API requires a valid
cookie session and sufficient role, plus the exact public origin on mutations.

The sponsorship publication endpoint prepares the public sponsor profile and
records feed placement metadata:

- public slug and short public summary
- feed target: `openg7` or `openg20`
- feed channels: `facebook` and/or `linkedin`
- feed status: `not_planned`, `planned`, `drafted`, or `published`
- optional public post URL once a publication exists

The publication-batch social endpoint can send a scheduled collective post to
Facebook or LinkedIn through `SOCIAL_PUBLICATION_MODE=mock|live`. It is always
an explicit admin action and writes an idempotent `social_publication_jobs`
record with the external post id, public URL, status, and any safe error.

When an admin refuses a sponsorship from `/admin/fundraiser/sponsors`, the
review flow requires an internal refusal reason, can send a sponsor-facing
email through the queued email system, and records the chosen refund handling
(`none`, manual refund required, or manual refund already completed) in the
admin audit metadata. The sponsorship record also tracks a refund workflow
status: `requested`, `processing`, `completed`, or `failed`. Stripe refunds
stay a separate deliberate action: the same admin page includes a guided
refund workflow that requires the current sponsorship version, asks the
admin to retype the public reference, calls `POST /api/admin/sponsorships/refund`,
marks the workflow as `processing`, creates a full or partial Stripe refund with an
idempotency key, marks the contribution as `refunded` when Stripe returns a
completed full refund, completes or fails the workflow from Stripe's response, can
queue a sponsor-facing refund confirmation email, and records the refund
id/status plus notification result in the admin audit log. If Stripe completes
the refund asynchronously, the `charge.refunded` webhook also marks the workflow
as `completed`. Admins can choose a partial amount and a Stripe refund reason
(`requested_by_customer`, `duplicate`, or `fraudulent`); partial refunds keep
the sponsorship payment status as `paid` while recording the refund amount and
reason on the sponsorship record. When a matching sponsorship invoice
exists, the refund also creates an app-generated credit note tied to the Stripe
refund; the credit note is visible and resendable from `/admin/fundraiser/invoices`,
with its own downloadable PDF.
The sponsor detail panel also includes an "Historique & audit" tab that merges
the sponsorship timeline with recent `admin_audit_log` entries for that
specific sponsorship, including the recorded admin actor. A dedicated
"Remboursements" tab summarizes the current refund workflow, dated milestones,
Stripe refund id, notes/errors, and refund-related admin audit entries.

Sponsor logos can be uploaded by admins through
`POST /api/admin/sponsorships/logo`. The API accepts PNG, JPEG, and WebP files
only, validates MIME type and file signature, stores the file outside the web
bundle in either the local private storage directory or the OVH private bucket,
records the controlled `/api/public/sponsor-logos/...` URL on the sponsorship,
and audits the upload. Admins can preview controlled logos through
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

Eligibility requires `public_display_consent=true`,
`sponsor_review_status=approved`, a company name and an approved, undeleted
presentation image. The existing policy allows `paid`, `refunded` and
`disputed` records; inclusion is not a statement of the current payment balance.
Amounts require separate consent. Private contacts, Stripe IDs and internal
notes are never exposed. See [pagination, totals and visibility](docs/public-sponsors.md)
and the separate [builders directory](docs/public-builders-and-support.md).

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

When PostgreSQL, SMTP email configuration, and the required migrations are
configured, the `checkout.session.completed` webhook queues the follow-up link
and creates an app-generated sponsorship invoice snapshot for the Stripe
customer email. The invoice includes a stable invoice number, issuer details,
sponsor recipient snapshot, Stripe references, line item, totals, tax label,
and a non-charity receipt disclaimer. Without email configuration, the immediate
Stripe return shows a tokenized follow-up action. Recovery from the follow-up
page or `/support` sends a new private link to the payment email when SMTP is
available. Admin owners in OIDC mode can also resend access from the dossier.
Text drafts are saved server-side with revision checks; saving a draft does not
submit it for review. See [recovery and drafts](docs/sponsorship-access-and-drafts.md).
Admins can still see paid but incomplete sponsorships from the admin screen. If
details are
resubmitted after approval, the sponsorship returns to `pending_review` before
any public display continues. Without PostgreSQL, Stripe-direct transparency
still works, but the recoverable sponsorship follow-up and public sponsor
profile lifecycle are not available.

API rate limits cover checkout, sponsorship follow-up, access recovery,
public reference lookup, reference recovery, admin authentication and sponsorship routes.
Configure the window and limits with
`FUNDING_RATE_LIMIT_WINDOW_MS`, `FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX`,
`FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX`,
`FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX`,
`FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX`, and
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

See [payment confirmation and recovery checks](docs/payment-trust-validation.md)
for the UI behavior, refund totals, and isolated PostgreSQL/browser tests.

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
endpoint can also be provided through `STRIPE_WEBHOOK_ENDPOINT_ID`. Replaying
an already processed event does not resend a logical email. Recover failed
processing through the idempotent webhook flow; use the confirmed admin resend
or email retry action when a new delivery is required.

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
See the [current transparency contract](docs/funding-transparency.md) for fee
completeness, source/freshness fields, monthly filters and exports.

### Public routing and performance

The main funding page stays eager; secondary public and admin pages load on
demand. The production initial-bundle budgets are 800 kB (warning) and 900 kB
(error). The build prerenders 24 routes, including `/404` and `/en/404`.
Nginx serves unknown URLs with localized HTTP 404 pages; only explicitly
declared client-rendered routes receive the application shell.

## Production deployment

The production stack uses Docker Compose, Traefik, Let's Encrypt, Nginx, and the Node funding API.

Full OVH VPS deployment documentation:

- [Docker deployment guide](docs/docker-deployment.md)
- [Command cheatsheet](docs/command-cheatsheet.md)
