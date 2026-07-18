# Production Launch Checklist

This checklist is for the first public OpenG7 Funding Platform launch. The default launch path is intentionally simple: Angular frontend, Funding API, Stripe checkout, Stripe-direct public transparency, and no PostgreSQL.

## Launch Decision

- PostgreSQL is optional for the fundraiser MVP.
- Leave `DATABASE_URL` unset for the simplest Stripe-direct launch.
- If `DATABASE_URL` is unset, public transparency reads directly from Stripe through `STRIPE_SECRET_KEY`.
- If PostgreSQL is enabled, keep it private and apply the fundraiser MVP migrations before taking real payments.
- Checkout mock fallbacks must stay disabled in production.
- NorthDragon and GitHub links remain external redirects; no Shopify iframe or repository mirroring is hosted by this app.

## Required Production Environment

Set these variables on the API host:

```bash
FUNDING_PLATFORM_ENV=production
FUNDING_API_PORT=<platform-provided-port-or-3333>
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false
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

For the PostgreSQL-backed fundraiser MVP, configure the private database values from `docs/docker-deployment.md` and apply all versioned database migrations before deployment.

If the frontend and API are served from different origins, the frontend host must either proxy `/api` to the Funding API or inject:

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

Confirm the build writes `dist/apps/funding-web/prerendered-routes.json` with those routes before deployment.
Each public route should include a language-specific canonical URL and `hreflang` alternates for `fr-CA`, `en`, and `x-default`.

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

The host should serve the prerendered route files directly when present, then fall back to `index.csr.html` or `index.html` for unknown client-side routes depending on the host capabilities.

The API must run:

```bash
corepack yarn workspace @openg7/funding-api start
```

The hosting layer must provide:

- HTTPS for the public frontend.
- HTTPS for the API or an HTTPS frontend proxy to `/api`.
- Angular route fallback to `index.html` for public routes such as `/fonds-des-batisseurs`, `/batisseurs`, `/commanditaires`, `/politique-utilisation-remboursement`, `/support`, `/music`, and `/boutique`.
- `/api/checkout-sessions` routed to the Funding API.
- `/api/public/fund-transparency` routed to the Funding API.
- `/api/public/sponsorships` routed to the Funding API.
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
- No personal contributor data is exposed.

## PostgreSQL-Backed Rehearsal

Run this rehearsal on staging or a private production-like VPS before choosing
the PostgreSQL-backed launch path for real payments:

1. Start from a clean private PostgreSQL volume and a clean
   `openg7-sponsor-logos` volume.
2. Configure `DATABASE_URL`, `FUNDING_ADMIN_TOKEN`,
   `FUNDING_ADMIN_SESSION_SECRET`, `FUNDING_SPONSOR_LOGO_STORAGE_DIR`, Stripe
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
6. Open `/admin/login`, create an admin browser session with
   `FUNDING_ADMIN_TOKEN` through `POST /api/admin/session`, then continue to
   `/admin/fundraiser/sponsors` and review the paid sponsorship.
   Confirm the guided Stripe refund panel and optional sponsor email fields are
   present for a paid sponsorship, but do not submit it during the normal launch
   rehearsal. Also open `/admin/fundraiser/invoices` and confirm the page has
   the credit-note area and PDF download controls ready for refunded invoices.
   If historical paid sponsorships predate app-generated invoices, run the
   missing-invoice backfill from that page once and confirm the result is
   audited before resending any invoice email.
   Open `/admin/fundraiser/email-queue` and confirm the queue summary,
   failed-message filter, and manual retry controls load for the admin session.
7. Upload a small PNG/JPEG/WebP logo, confirm `GET /api/admin/sponsorships/logo`
   returns a private preview, approve the sponsorship, and confirm
   `/commanditaires` shows the logo only after consent and approval.
8. Replace the logo and confirm the previous controlled file is no longer
   served through `/api/public/sponsor-logos/<file>`.
9. Delete the logo through `POST /api/admin/sponsorships/logo/delete` and confirm
   the public sponsor entry falls back safely without exposing the deleted file.
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
- Confirm sponsor logo upload limits, storage directory, and `openg7-sponsor-logos` volume backups are configured.
- Confirm `scripts/backup.sh` creates and offloads `openg7-sponsor-logos-*.tar.gz` once sponsor logo uploads are enabled.
- Confirm admin sponsor logo preview, replacement cleanup, and delete flows work before public sponsorship display is enabled.
- Confirm `/dev/stripe-setup`, `/dev/webhooks`, and `/dev/api-keys` are not accessible from the production domain.
- Confirm all NorthDragon links open `https://northdragon.org` in a new tab.
- Confirm GitHub repository links open the intended OpenG7 repositories.
- Confirm the public usage/refund policy reflects the current Stripe, sponsorship, privacy, and support process before accepting real payments.
- Confirm no Shopify iframe, Facebook iframe, or third-party embed was introduced.
- Confirm the production deployment includes all required assets from `apps/funding-web/src/assets`.

## Future Work After Launch

- Add hosting-specific configuration once the production target is chosen.
- Keep hosting/proxy rate limits and security headers aligned with the API-level limits.
- Add image optimization for large hero assets, especially WebP or AVIF variants.
- Consider Shopify Storefront API integration for the Boutique editorial previews.
- Automate the PostgreSQL-backed rehearsal once the final production target is chosen.
