# Production Launch Checklist

This checklist is for the first public OpenG7 Funding Platform launch. The launch path is intentionally simple: Angular frontend, Funding API, Stripe checkout, Stripe-direct public transparency, and no PostgreSQL.

## Launch Decision

- PostgreSQL is not used for the initial launch.
- Leave `DATABASE_URL` unset in production.
- Public transparency reads directly from Stripe through `STRIPE_SECRET_KEY`.
- Checkout mock fallbacks must stay disabled in production.
- NorthDragon and GitHub links remain external redirects; no Shopify iframe or repository mirroring is hosted by this app.

## Required Production Environment

Set these variables on the API host:

```bash
FUNDING_PLATFORM_ENV=production
FUNDING_API_PORT=<platform-provided-port-or-3333>
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
STRIPE_SECRET_KEY=<stripe-live-or-final-test-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-signing-secret>
```

Do not set this variable for the first launch:

```bash
DATABASE_URL=
```

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
- `/ecosystem`
- `/support`
- `/music`
- `/boutique`
- `/fonds-des-batisseurs/a-propos`
- `/fonds-des-batisseurs/transparence`

It also prerenders the English equivalents:

- `/en`
- `/en/ecosystem`
- `/en/support`
- `/en/music`
- `/en/boutique`
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
- Angular route fallback to `index.html` for public routes such as `/support`, `/music`, and `/boutique`.
- `/api/checkout-sessions` routed to the Funding API.
- `/api/public/fund-transparency` routed to the Funding API.
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
- `/ecosystem`
- `/support`
- `/music`
- `/boutique`
- `/fonds-des-batisseurs/a-propos`
- `/fonds-des-batisseurs/transparence`

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
- If no Stripe contributions exist yet, the page may show an empty public state.
- No personal contributor data is exposed.

## Final Preflight

- Confirm `DATABASE_URL` is absent.
- Confirm `FUNDING_PLATFORM_ENV=production`.
- Confirm `FUNDING_ALLOWED_ORIGINS` contains only the intended production frontend origins.
- Confirm `/dev/stripe-setup`, `/dev/webhooks`, and `/dev/api-keys` are not accessible from the production domain.
- Confirm all NorthDragon links open `https://northdragon.org` in a new tab.
- Confirm GitHub repository links open the intended OpenG7 repositories.
- Confirm no Shopify iframe, Facebook iframe, or third-party embed was introduced.
- Confirm the production deployment includes all required assets from `apps/funding-web/src/assets`.

## Future Work After Launch

- Add hosting-specific configuration once the production target is chosen.
- Add API rate limiting and security headers at the hosting/proxy layer.
- Add image optimization for large hero assets, especially WebP or AVIF variants.
- Consider Shopify Storefront API integration for the Boutique editorial previews.
- Consider PostgreSQL only if a local transparency journal becomes necessary later.
