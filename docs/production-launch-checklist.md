# Production Launch Checklist

This checklist covers the selected OpenG7 deployment scope. The minimal path is
Angular, Funding API, Stripe Checkout and Stripe-direct aggregate transparency.
The full platform adds private PostgreSQL and the configured operational services.

The minimal launch path does not include the full sponsor follow-up,
public directories or persistent administration. Those features require private
PostgreSQL; access recovery also requires working email. Start with the
[current platform status](platform-status.md) and the
[controlled integration rehearsal](operations/integration-rehearsal.md) to choose
the scope being validated.

Before updating an existing database, read the
[migration replay limitation](operations/database-migrations.md). The current
deployment runner reapplies every migration; `019`–`021` cannot be replayed.
A successful rehearsal on a fresh database does not resolve this deployment issue.

## Launch Decision

- PostgreSQL is optional only for the limited Stripe-direct path.
- Leave `DATABASE_URL` unset for the simplest Stripe-direct launch.
- If `DATABASE_URL` is unset, public transparency reads directly from Stripe through `STRIPE_SECRET_KEY`.
- Persistent sponsorship, directories, admin state, OIDC and alert episodes require private PostgreSQL and the applicable migrations through `021`.
- Checkout mock fallbacks must stay disabled in production.
- NorthDragon and GitHub links remain external redirects; no Shopify iframe or repository mirroring is hosted by this app.

## Required Production Environment

Set these variables on the API host:

```bash
FUNDING_PLATFORM_ENV=production
FUNDING_API_PORT=<platform-provided-port-or-3333>
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false
FUNDING_ADMIN_AUTH_MODE=token
FUNDING_ADMIN_TOKEN=<long-random-root-admin-secret>
FUNDING_ADMIN_SESSION_SECRET=<different-long-random-session-secret>
FUNDING_ADMIN_SESSION_TTL_MINUTES=60
FUNDING_SPONSOR_LOGO_STORAGE_DIR=/app/var/sponsor-logos
FUNDING_SPONSOR_LOGO_MAX_BYTES=524288
STRIPE_SECRET_KEY=<stripe-live-or-final-test-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-signing-secret>
```

Do not set this variable for the simplest Stripe-direct launch:

```bash
DATABASE_URL=
```

These admin secret/session values describe `token` mode. For named accounts,
choose `FUNDING_ADMIN_AUTH_MODE=oidc` and follow the
[identity and alerts runbook](operations/admin-identity-and-alerts.md), including
MFA, owner subjects and same-origin Web/API hosting. Root tokens are rejected in
OIDC mode. Enable the separate operations watcher only after testing its receiver.

For the PostgreSQL-backed platform, configure the private database values from
[the Docker guide](docker-deployment.md) and prepare the required migrations
before deployment according to the migration procedure above.

Proxy `/api` through the Web origin for OIDC. For the public API and legacy token
mode, a separate API origin can also be configured through:

```js
window.__OPENG7_FUNDING_API_BASE_URL__ = 'https://api.openg7.org/api';
```

## Build Validation

Run these before deployment:

```bash
corepack yarn install
corepack yarn lint
corepack yarn test
corepack yarn workspace @openg7/funding-web build --configuration production
```

The production web build uses Angular SSG and prerenders these public French routes:

- `/`
- `/fonds-des-batisseurs`
- `/ecosystem`
- `/support`
- `/music`
- `/boutique`
- `/batisseurs`
- `/commanditaires`
- `/politique-utilisation-remboursement`
- `/fonds-des-batisseurs/a-propos`
- `/fonds-des-batisseurs/transparence`
- `/404` (error document, excluded from indexing)

It also prerenders the English equivalents:

- `/en`
- `/en/fonds-des-batisseurs`
- `/en/ecosystem`
- `/en/support`
- `/en/music`
- `/en/boutique`
- `/en/batisseurs`
- `/en/commanditaires`
- `/en/politique-utilisation-remboursement`
- `/en/fonds-des-batisseurs/a-propos`
- `/en/fonds-des-batisseurs/transparence`
- `/en/404` (error document, excluded from indexing)

Confirm the build writes `dist/apps/funding-web/prerendered-routes.json` with those routes before deployment.
The build currently prerenders 24 routes. Indexable public pages include a
language-specific canonical URL and `hreflang` alternates for `fr-CA`, `en`
and `x-default`; error documents use `noindex`. The production initial bundle
has an 800 kB warning budget and a 900 kB error budget.

Known note: if Angular reports a `.tsbuildinfo` path mismatch on Windows, remove only the generated cache and rebuild:

```powershell
if (Test-Path ".angular/cache") { Remove-Item ".angular/cache" -Recurse -Force }
corepack yarn workspace @openg7/funding-web build --configuration production
```

## Deployment Wiring

The frontend must serve the Angular production output:

```text
dist/apps/funding-web/browser
```

Serve prerendered files directly. Only known client-rendered routes (admin and
private sponsor follow-up) receive `index.csr.html`. Unknown URLs must return
HTTP 404 with the FR/EN error document, as in `apps/funding-web/nginx.conf`.
Do not replace this behavior with an unrestricted successful SPA fallback.

The API must run:

```bash
corepack yarn workspace @openg7/funding-api start
```

The hosting layer must provide:

- HTTPS for the public frontend.
- HTTPS for the API or an HTTPS frontend proxy to `/api`.
- Prerendered public files, an explicit allowlist of client-rendered routes, and localized HTTP 404 responses for unknown paths.
- `/api/checkout-sessions` routed to the Funding API.
- `/api/public/fund-transparency` routed to the Funding API.
- `/api/public/sponsorships` routed to the Funding API.
- `/api/public/builders`, `/api/public/funding-config`, private sponsor follow-up and `/api/admin/*` routed to the Funding API.
- `/api/public/sponsor-logos/*` routed to the Funding API.
- `/api/stripe/webhook` routed to the Funding API.

## Stripe Setup

In Stripe Dashboard:

- Confirm the account is ready for real payments.
- Confirm the public business/support information is correct.
- Create a webhook endpoint pointing to:

```text
https://<production-domain>/api/stripe/webhook
```

- Subscribe the webhook to:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.updated` (late fee/net enrichment)
  - `charge.refunded`
  - `charge.dispute.created`
  - `payout.paid`
  - `payout.failed`
- Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
- Use the final intended `STRIPE_SECRET_KEY` on the API host.

## Smoke Tests

After deployment, verify these public routes:

- `/`
- `/fonds-des-batisseurs`
- `/ecosystem`
- `/support`
- `/music`
- `/boutique`
- `/batisseurs`
- `/commanditaires`
- `/politique-utilisation-remboursement`
- `/fonds-des-batisseurs/a-propos`
- `/fonds-des-batisseurs/transparence`
- `/en`
- `/en/fonds-des-batisseurs`
- `/en/batisseurs`
- `/en/commanditaires`
- `/en/politique-utilisation-remboursement`
- `/en/fonds-des-batisseurs/transparence`

Verify these API endpoints:

```bash
GET /health
GET /api/public/fund-transparency
POST /api/checkout-sessions
```

Expected checkout behavior:

- With valid Stripe configuration, `POST /api/checkout-sessions` returns `status: "redirected"` and a Stripe checkout URL.
- With missing Stripe configuration in production, the API fails or returns an error. It must not return `status: "mocked"`.

Expected transparency behavior:

- `/fonds-des-batisseurs/transparence` loads aggregate public values.
- `/batisseurs` loads public builder profiles when consented data exists, or a safe empty state.
- `/commanditaires` loads approved public sponsor profiles when consented data exists, or a safe empty state.
- `/politique-utilisation-remboursement` explains contribution use, refunds, disputes, sponsorship approval, feed visibility, and privacy limits.
- If no Stripe contributions exist yet, the page may show an empty public state.
- No private contributor contact details or payment references are exposed.

Also verify unknown FR/EN URLs return HTTP 404 and `noindex`, and that a direct
visit to a known admin or follow-up route still loads its client-rendered shell.
Public sponsor and builder pages may expose only the fields explicitly allowed
by consent; contact details and private payment references remain excluded.

## PostgreSQL-Backed Rehearsal

Run this rehearsal on staging or a private production-like VPS before choosing
the PostgreSQL-backed launch path for real payments:

1. Start from a clean private PostgreSQL volume and a clean
   `openg7-sponsor-logos` volume.
2. Configure `DATABASE_URL`, the selected admin authentication mode,
   `SPONSOR_MEDIA_STORAGE_DRIVER`, Stripe
   test keys, and a signed Stripe webhook secret.
3. Apply every versioned migration, then run `corepack yarn test` and
   `corepack yarn workspace @openg7/funding-web build --configuration production`.
4. Complete one Stripe test checkout for `sponsorship_interest` and confirm the
   signed webhook stores the private contribution row with a hashed follow-up
   token. Confirm the browser return uses `followup_token` and does not rely on
   `session_id`.
5. Open the sponsor follow-up link, refresh it, close the tab, reopen the same
   link, submit company details, submit them a second time, and confirm the
   commandite remains a single paid row that returns to manual review.
6. Open `/admin/login`, create a token-mode session through
   `POST /api/admin/session` or authenticate with MFA in OIDC mode, then continue to
   `/admin/fundraiser/sponsors` and review the paid sponsorship.
   Confirm the guided Stripe refund panel and optional sponsor email fields are
   present for a paid sponsorship, but do not submit it during the normal launch
   rehearsal. Also open `/admin/fundraiser/invoices` and confirm the page has
   the credit-note area and PDF download controls ready for refunded invoices.
   Confirm the sponsorship detail panel shows the refund workflow badge and
   that the refund history tab exposes milestones, notes/errors, and refund
   audit entries. Confirm the guided refund form exposes partial amount and
   Stripe reason controls. Confirm a guided refund cannot be launched again
   while the workflow is processing or after a manual completed refund.
   If historical paid sponsorships predate app-generated invoices, run the
   missing-invoice backfill from that page once and confirm the result is
   audited before resending any invoice email.
   Open `/admin/fundraiser/email-queue` and confirm the queue summary,
   failed-message filter, and manual retry controls load for the admin session.
7. Through the sponsor follow-up token, upload a small PNG/JPEG/WebP logo and a
   presentation photo. Confirm both stay private and that the sponsorship is
   not included in the review reminder until a presentation photo exists.
8. Confirm `GET /api/admin/sponsorships/media` returns protected previews, then
   approve the assets through `POST /api/admin/sponsorships/media/review` with
   alt text. Approve the sponsorship and confirm `/commanditaires` shows only
   the optimized media after consent and approval.
9. Refuse or delete a media asset through the admin flow and confirm its public
   copy is unavailable while its original remains private. Also exercise the
   legacy logo path: upload through `POST /api/admin/sponsorships/logo`, confirm
   its private preview with `GET /api/admin/sponsorships/logo`, replace it and
   confirm the previous controlled file is no longer served through
   `/api/public/sponsor-logos/<file>`, then delete it through
   `POST /api/admin/sponsorships/logo/delete`.
10. Run `bash scripts/backup.sh`, confirm both PostgreSQL and
    `openg7-sponsor-logos-*.tar.gz` archives are present, then rehearse
    `bash scripts/restore-from-backup.sh --sponsor-logos-backup <archive>` on a
    disposable environment.
11. Replay the same signed Stripe test webhook event and confirm idempotence:
    no duplicate contribution, no duplicate public sponsor, and no unexpected
    status regression. Use `corepack yarn stripe:events:resend evt_...` for
    test mode. To target the production Stripe webhook endpoint explicitly, use:

    ```bash
    corepack yarn stripe:events:resend:live evt_... --endpoint we_...
    ```

    Run the same command with `--dry-run` first when recovering real
    post-payment events.

12. Fetch and inspect API logs after the rehearsal:
    `docker compose logs --tail=300 api`. Look specifically for webhook errors,
    PostgreSQL errors, orphaned sponsorships, follow-up form errors, logo
    processing errors, duplicate handling, and idempotence warnings.
13. Run the production launch agent in dry-run mode, then execute it with
    `PLA_ROLE=operator` only after the manual checks above pass.

## Final Preflight

- Confirm the chosen launch mode.
- For Stripe-direct launch, confirm `DATABASE_URL` is absent.
- For PostgreSQL-backed launch, confirm PostgreSQL is private, reachable only by the API, and migrations are applied.
- For PostgreSQL-backed launch, protect database backups as private secrets because `stripe_events.payload` stores signed Stripe webhook payloads for idempotence and auditability.
- Confirm `FUNDING_PLATFORM_ENV=production`.
- Confirm `FUNDING_ALLOWED_ORIGINS` contains only the intended production frontend origins.
- Confirm sponsorship follow-up and admin rate limit variables are set for the expected traffic volume.
- Confirm sponsor logo and media upload limits and the selected sponsor media storage driver are configured.
- Confirm schema readiness for media (`017`), achievements (`018`), recovery/drafts (`019`), OIDC (`020`) and alerts (`021`); resolve the migration replay limitation before repeated deployment.
- In OIDC mode, verify MFA, reader/operator/owner authorization, account disabling and session revocation with the real test identity provider.
- If independent alerts are enabled, verify the signed receiver, deduplication and separate monitoring of the watcher/VPS.
- If `SPONSOR_MEDIA_STORAGE_DRIVER=local`, confirm `scripts/backup.sh` creates and offloads `openg7-sponsor-logos-*.tar.gz`; this volume now contains both legacy logos and `media-assets`.
- If `SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3`, confirm `npm run storage:check` and `npm run storage:test` pass on the VPS.
- Confirm a sponsor can upload JPEG/PNG/WebP through a valid follow-up token, while an invalid token and an oversized or malformed file are refused.
- Confirm private media preview, admin approval/refusal, alt text, replacement cleanup and delete flows work before public sponsorship display is enabled.
- Confirm the original remains private, only the approved WebP copy is public, and a sponsorship without a presentation photo is excluded from review reminders.
- Confirm `/dev/stripe-setup`, `/dev/webhooks`, and `/dev/api-keys` are not accessible from the production domain.
- Confirm all NorthDragon links open `https://northdragon.org` in a new tab.
- Confirm GitHub repository links open the intended OpenG7 repositories.
- Confirm the public usage/refund policy reflects the current Stripe, sponsorship, privacy, and support process before accepting real payments.
- Confirm no Shopify iframe, Facebook iframe, or third-party embed was introduced.
- Confirm the production deployment includes all required assets from `apps/funding-web/src/assets`.

## Remaining Operational Checks

- Exercise the real OIDC provider and external alert receiver before activation.
- Keep hosting/proxy rate limits and security headers aligned with the API-level limits.
- Keep the existing responsive WebP variants and production bundle budgets verified when assets change.
- Consider Shopify Storefront API integration for the Boutique editorial previews.
- Run the controlled provider and full-VPS recovery rehearsal on an identified test target; local Docker, OIDC, Mailpit and S3Mock tests already exist.
- Complete human screen-reader, native zoom and physical-device checks described in the integration rehearsal.
