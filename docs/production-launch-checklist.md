# Production Launch Checklist

This checklist covers the production Funding platform: Angular Web, Funding API,
private PostgreSQL, Stripe Checkout and named OIDC administration with MFA.
Use the [current platform status](platform-status.md) to identify delivered
features and open qualifications; the [configuration reference](technical/configuration.md)
and repository code define the startup contract.

Production requires PostgreSQL and OIDC even when business sponsorships are
disabled. Stripe-direct aggregate statistics remain a limited
[development configuration](technical/configuration.md#development-without-postgresql);
they do not provide a production launch path without a database.

Record the exact target, release revision, provider accounts and test/live mode,
operator, authorized actions, volume limits, recovery plan and evidence location
before any external operation. Deployment, production migrations, real refunds,
media deletion, publication and external sending require their own explicit
authorization under the [operational safeguards](../AGENTS.md#risque-eleve).
Completing this document does not authorize those operations.

## Launch Decision

- [ ] Identify the target URLs, full release SHA, Web/API image tags and digests,
      and successful CI runs for that revision.
- [ ] Prepare private PostgreSQL with the release's complete migration directory.
      Checkout requires durable operations, including
      [migration 031](../apps/funding-api/migrations/031_create_checkout_operations.sql).
      Follow the [migration procedure](operations/database-migrations.md#registre-et-réexécution);
      do not stop at a historical minimum schema.
- [ ] Prepare the OIDC provider, confidential client, MFA and first owner subjects
      before starting the production API. Keycloak hosting is optional; OIDC is
      mandatory. Follow the
      [first application startup](operations/keycloak-vps.md#premier-demarrage-oidc)
      or the [external-provider requirements](operations/admin-identity-and-alerts.md).
- [ ] Qualify Stripe on an identified test account and test URL before separately
      authorizing live activation. Keep mock Checkout disabled in production.
- [ ] Keep business sponsorships disabled until their complete private follow-up,
      email, media and administrative review journeys have passed.
- [ ] Decide separately whether to activate independent alerts or real social
      delivery. Keep social delivery disabled during the normal launch rehearsal.
- [ ] Keep NorthDragon and GitHub integrations as external links within their
      current documented scope.

## Required Production Environment

Start from [.env.example](../.env.example) and the
[configuration reference](technical/configuration.md). This excerpt shows the
mandatory application settings; it is not a complete VPS, SMTP or storage file.
Replace every synthetic value for the identified target before use:

```env
FUNDING_PLATFORM_ENV=production
FUNDING_API_PORT=3333
FUNDING_PUBLIC_BASE_URL=https://funding.example.com
FUNDING_ALLOWED_ORIGINS=https://funding.example.com
FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false
FUNDING_ADMIN_AUTH_MODE=oidc
FUNDING_ADMIN_OIDC_ISSUER=https://identity.example.com/realms/openg7
FUNDING_ADMIN_OIDC_CLIENT_ID=<confidential-client-id>
FUNDING_ADMIN_OIDC_CLIENT_SECRET=<independent-private-client-secret>
FUNDING_ADMIN_OIDC_OWNER_SUBJECTS=<verified-first-owner-subject>
FUNDING_ADMIN_OIDC_MFA_ACR=
FUNDING_PRIVATE_DATA_ENCRYPTION_KEY=<standard-base64-of-32-random-bytes>
DATABASE_URL=postgres://<runtime-user>:<url-encoded-runtime-password>@postgres:5432/<funding-db>
STRIPE_SECRET_KEY=<secret-for-the-explicitly-authorized-account-and-mode>
STRIPE_WEBHOOK_SECRET=<signing-secret-for-that-account-mode-and-endpoint>
SOCIAL_PUBLICATION_MODE=disabled
```

- [ ] Host Web and `/api` on the same HTTPS origin. Register the exact callback
      `https://<site>/api/admin/auth/callback`, without a wildcard.
- [ ] Verify signed MFA evidence: `amr` containing `mfa`, or an ACR whose MFA
      meaning is guaranteed by the provider. A healthy discovery/JWKS endpoint
      does not qualify login or MFA.
- [ ] On a new database, supply verified owner subjects explicitly or through
      the [managed Keycloak provisioning](operations/keycloak-provisioning.md).
      An empty list requires an existing active owner for that issuer.
- [ ] Use a restricted API database role in `DATABASE_URL`, separate from the
      migration owner. Follow the
      [runtime-role procedure](docker-deployment.md#compte-postgresql-applicatif).
      PostgreSQL publishes no public port and has no Traefik route.
- [ ] Generate the application encryption key as exactly 32 random bytes in
      standard base64 and retain an independent protected recovery copy.
- [ ] Keep secrets on the API or deployment host as appropriate, outside Git,
      images, browser bundles, public URLs and logs. Protect the host `.env` with mode
      `600`; token-mode admin secrets are not required for OIDC.
- [ ] Configure the selected
      [media backend](operations/ovh-object-storage.md), upload limits,
      [SMTP service](email-smtp.md), invoice identity and API rate limits from
      their owning guides. Qualify email recovery before offering it.
- [ ] Review configuration with `node scripts/services-check.mjs --env .env --env-only`.
      This checks configuration, not MFA, migrations, database privileges,
      encryption-key validity or provider delivery.

## Build Validation

Select the exact release commit and inspect its GitHub Actions results, including
[Admin acceptance](../.github/workflows/admin-acceptance.yml) and applicable
[build/deployment checks](../.github/workflows/deploy.yml). Record successful run
links for that revision; a merged PR or another revision's results are insufficient.

Use Node 22 and the Yarn version declared in [package.json](../package.json).
Apply the [validation matrix](development/validation.md) for the selected release:

```bash
corepack yarn install --immutable
corepack yarn lint
corepack yarn exec tsc --noEmit -p tsconfig.json
corepack yarn test
corepack yarn workspace @openg7/funding-web build --configuration production
corepack yarn docs:check
git diff --check
```

- [ ] Record the applicable PostgreSQL, identity, recovery and browser acceptance
      results, including failures and skipped checks. Disposable Docker, Mailpit,
      S3Mock and signed local OIDC tests qualify different guarantees from real
      provider rehearsals.
- [ ] Compare `dist/apps/funding-web/prerendered-routes.json` with
      [server routes](../apps/funding-web/src/app/app.routes.server.ts), including
      public FR/EN pages, both 404 documents and `/admin/oidc-setup`.
      Private follow-up and protected admin pages remain client-rendered.
- [ ] Verify bundle budgets against [angular.json](../angular.json).
      Check canonical URLs and `hreflang` against the chosen production domain;
      the current [SEO service](../apps/funding-web/src/app/features/funding/services/funding-seo.service.ts)
      targets `https://openg7.org`. Another host requires a separately reviewed
      configuration change before release.

## Deployment Wiring

Serve the Angular static production output from
`dist/apps/funding-web/browser` using the routing contract in
[Nginx](../apps/funding-web/nginx.conf). Public content is prerendered at build
time; financial data is loaded from the API in the browser.

- [ ] Serve prerendered public files and the public OIDC setup guide directly.
      Only known client-rendered routes receive `index.csr.html`; unknown URLs
      return localized HTTP 404 and `noindex`.
- [ ] Proxy `/api` through the same Web origin to the compiled API runtime.
      Verify public configuration/directories/transparency, Checkout, private
      follow-up, admin/authentication, media and the Stripe webhook routes.
- [ ] Keep PostgreSQL private and technical dashboards bound to loopback.
      Verify HTTPS, security headers, healthchecks and service dependencies.
- [ ] Verify Node 22 and Docker Compose are available on the migration host,
      including image-only deployments, and that the migration target matches
      the API database.
- [ ] For SSH delivery, independently verify the negotiated host key before
      configuring `VPS_SSH_FINGERPRINT`. The optional launch agent uses its own
      `PLA_SSH_HOST_FINGERPRINT`; follow the
      [delivery configuration](docker-deployment.md#github-actions-cicd).
- [ ] Deploy Web and API from the same full SHA with matching image tags.
      Prepare the checkout explicitly and follow the
      [deployment procedure](docker-deployment.md#deployment).
      The deployment script applies migrations; a verified backup must already
      exist before an authorized upgrade.

An existing database without a migration registry needs
[reviewed history adoption](operations/database-migrations.md#adoption-dune-base-existante-sans-registre)
after backup verification and rehearsal on an isolated copy. After authorized
application, `node scripts/db-migrate.mjs --plan` must report no pending migration
or history mismatch. The plan does not infer legacy history or detect manual
schema drift.

## Stripe Setup

- [ ] Identify and record the intended Stripe account, mode and endpoint.
      Verify business/support information and the exact HTTPS webhook URL:
      `https://<target-domain>/api/stripe/webhook`.
- [ ] Configure the endpoint's signing secret and the API secret for that same
      account and mode; keep test and live configuration separate.
- [ ] Match the endpoint subscriptions to the release's
      [Stripe contract](technical/stripe.md#stripe-webhook-endpoint), including
      `refund.updated` and `refund.failed` for asynchronous refund outcomes.
      Subscribe to `checkout.session.async_payment_succeeded` and
      `checkout.session.async_payment_failed` when delayed payment methods are
      explicitly enabled and qualified.
- [ ] Qualify the [durable Checkout contract](technical/checkout.md): a new
      contribution uses a new `idempotencyKey`; retries retain the same key and
      payload. Missing/invalid keys fail with `400`; unavailable durable storage
      fails with `503 CHECKOUT_STORAGE_UNAVAILABLE` before calling Stripe.
      Reconcile an uncertain result before starting another operation.
- [ ] Exercise webhook signature rejection, repeated and delayed delivery,
      failure/restart recovery and asynchronous refund outcomes on the approved
      test target. Follow the
      [refund integrity procedure](operations/stripe-refund-integrity.md).
      Dispute resolution and financial correction of a returned refund require
      separately prepared and authorized authoritative workflows; the current
      processing does not automate them.

## Smoke Tests

Use the [read-only smoke runbook](operations/production-smoke-tests.md) against
the explicitly identified URL. Replace the synthetic URL below with that target.
The public HTTP command performs GET requests:

```bash
node scripts/smoke-public.mjs --base-url https://funding.example.com --expect-secure-headers
```

- [ ] Verify public FR/EN navigation, static content without JavaScript, canonical
      URLs, policy/support links, responsive behavior and localized 404 responses.
- [ ] Verify Web/API health, public configuration and safe directory/transparency
      responses. Initial loading or provider failure must not appear as zero;
      financial aggregates require a successful API response.
- [ ] Verify anonymous access to protected admin data is refused and that
      private responses use `no-store`. Exercise owner login, MFA rejection,
      reader/operator/owner permissions, session expiry and revocation through
      the separate [identity rehearsal](operations/admin-identity-and-alerts.md#recette-des-accès-administrateurs).
- [ ] Confirm developer setup, webhook and API-key tools are unavailable on the
      production domain. Inspect public responses for private contacts,
      contribution references, tokens and secrets.

Creating a Checkout session, sending email, replaying an event, writing a storage
test object or publishing content is an external effect. Perform these only in
the authorized rehearsal below or under a separately authorized live operation.

## PostgreSQL-Backed Rehearsal

PostgreSQL is required for the production platform. Rehearse on a dedicated,
identified test target with synthetic data, Stripe test keys and a dedicated
inbox. Complete the
[target preparation](operations/integration-rehearsal.md#fiche-de-préparation-de-la-recette-réelle),
including permissions for each mutation, limits and cleanup. Keep real social
delivery disabled.

1. Prepare the private database, complete release schema, restricted runtime
   role, encryption key, OIDC/MFA and dedicated media storage. When testing
   sponsorship Checkout, explicitly enable business sponsorships on this test
   target. Preserve existing environments.
2. For each separately scoped rehearsal, complete the selected personal or
   enabled business Checkout through the released Web/API within the approved
   volume limits. Verify the return remains pending until Stripe confirms payment;
   neither a success URL nor browser state creates a paid contribution.
   Repeat the same request key/payload and replay the signed test event to
   verify one logical operation, contribution and financial record. Test
   conflicting payloads and uncertain/restarted requests.
3. For a paid sponsorship, use the private follow-up link, refresh, save details,
   resubmit and exercise draft conflicts. Verify access recovery through the
   dedicated inbox. The current return uses `suivi-commandite?token=...`.
   Tokens stay private and are removed from the browser URL;
   a fresh tab without stored access may require the original link or recovery.
   Follow the [access contract](sponsorship-access-and-drafts.md).
4. Authenticate with MFA, review the paid dossier and inspect invoices, PDF
   snapshots, the email queue and audit. Qualify refund success/failure,
   partial/full amounts, retries and credit notes only on synthetic test
   payments under the separately identified refund rehearsal.
   Historical backfills and invoice resends require their own bounded scope.
5. Upload valid PNG/JPEG/WebP media and verify invalid access, malformed files,
   oversized uploads and upload-count limits are refused. Review assets with
   alt text and approve the dossier; confirm approval still keeps the site
   profile private. Then separately authorize and confirm site publication.
6. Verify the [public sponsor contract](public-sponsors.md): consent, review,
   approved presentation image and site visibility govern the directory and
   public API media routes. Originals and optimized files stay in private
   storage; the API controls their delivery. Masking the profile or refusing an
   asset must remove public access. Test confirmed deletion only on a designated synthetic
   asset and verify the audit and object cleanup.
   [Historical public copies](operations/ovh-object-storage.md) need separate
   inventory and authorized removal; hiding a profile cannot revoke a copy
   already held outside the API.
7. Qualify actual email receipt, DNS alignment and retry/restart behavior.
   SMTP acceptance is distinct from inbox receipt. An uncertain delivery
   requires provider reconciliation before an explicitly confirmed retry;
   use the [SMTP guide](email-smtp.md).
8. Exercise a coherent encrypted backup and restoration on a fresh disposable
   target using the [recovery procedure](operations/backup-recovery.md).
   Keep restored application services stopped while running the read-only
   recovery audit. Reconcile Stripe state, pending work, media and public URLs
   before separately authorizing startup and verifying recovered journeys.
9. Record safe correlated outcomes and unresolved exceptions without raw
   webhook payloads, private URLs or tokens. If using the optional
   [production launch agent](../apps/production-launch-agent/README.md), review
   its dry-run for the same scope; its role setting grants no additional
   authorization.

## Final Preflight

- [ ] Record the target, operator, exact release SHA/digests, successful CI links,
      authorized operation and dated provider qualification evidence.
- [ ] Confirm production mode, same-origin HTTPS, OIDC/MFA, active owner access,
      restricted private PostgreSQL, encryption key and complete migration plan.
- [ ] Verify protected coherent backups of configuration, PostgreSQL and the
      selected local/S3 media backend, with manifests and checksums.
      Full backups use age encryption; arrange off-server transfer and retention
      explicitly, because `backup.sh` performs neither.
      Keep the decryption identity and application encryption key recoverable
      independently of the VPS.
- [ ] If hosting Keycloak, verify its separate
      [identity database backup](operations/keycloak-vps.md#sauvegarde-identite)
      and recovery procedure. The Funding backup does not capture it automatically.
- [ ] Rehearse the chosen restore/rollback plan on an isolated target.
      Image rollback does not undo database migrations.
- [ ] Verify SMTP receipt and recovery, media privacy and controlled API
      visibility, invoice identity and public usage/refund policy for enabled
      features. Storage tests create and delete objects; run them only on the
      explicitly authorized target.
- [ ] If alerts are enabled, verify the signed receiver, deduplication,
      failure delivery, retry, receiver recovery and independent watcher/VPS monitoring.
      If real social delivery is enabled, qualify provider accounts and rights;
      each publication still requires its own administrative approval.
- [ ] Check assets, external links, developer-route restrictions and public
      responses for confidential data. Complete human screen-reader, native
      zoom and physical-device checks.
- [ ] Record go/no-go, exceptions, rollback triggers and responsible operators.
      After authorized deployment, verify service health, HTTPS, public
      contracts, owner access and the release revision before closing the operation.

## Remaining Operational Checks

Track unresolved qualifications in the release record with an owner and expected
evidence. Keep local test results, actual provider delivery, human accessibility
checks and production activation as separate evidence. Use the
[integration rehearsal](operations/integration-rehearsal.md) and
[platform status](platform-status.md) to assess remaining work; this checklist
does not certify that an external operation has occurred.
