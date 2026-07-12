import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { OPENG7_FUNDING_CONFIG } from '../dist/apps/funding-web/src/app/features/funding/config/openg7-funding.config.js';
import { createMockCheckoutResult } from '../dist/packages/funding-core/src/index.js';

const extractBetween = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label} start marker was not found`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label} end marker was not found`);
  return source.slice(startIndex, endIndex);
};

test('OpenG7 config uses required default values', () => {
  assert.equal(OPENG7_FUNDING_CONFIG.projectName, 'OpenG7');
  assert.equal(OPENG7_FUNDING_CONFIG.campaignTitle, 'Le Fonds des Bâtisseurs');
  assert.equal(OPENG7_FUNDING_CONFIG.currency, 'CAD');
  assert.equal(OPENG7_FUNDING_CONFIG.locale, 'fr-CA');
  assert.deepEqual(OPENG7_FUNDING_CONFIG.contributionAmounts, [5, 10, 25, 50]);
});

test('Funding core returns documented mock checkout result', () => {
  const result = createMockCheckoutResult({
    amount: 25,
    currency: 'CAD',
    projectId: 'openg7',
    successUrl: 'https://example.org/success',
    cancelUrl: 'https://example.org/cancel',
    contributionType: 'personal_support',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  });

  assert.equal(result.status, 'mocked');
  assert.ok(result.checkoutId.includes('25'));
});

test('Fundraiser MVP database migration creates required private tables', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql',
    'utf8'
  );

  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS stripe_events'));
  assert.ok(migration.includes('processing_status TEXT NOT NULL'));
  assert.ok(
    migration.includes('CREATE TABLE IF NOT EXISTS stripe_checkout_sessions')
  );
  assert.ok(
    migration.includes('CREATE TABLE IF NOT EXISTS fund_contributions')
  );
});

test('fund_contributions ON CONFLICT targets match its partial unique index', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql',
    'utf8'
  );
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_stripe_session_id\s+ON fund_contributions \(stripe_session_id\)\s+WHERE stripe_session_id IS NOT NULL/.test(
      migration
    ),
    'fund_contributions.stripe_session_id must stay a partial unique index'
  );

  const onConflictClauses = [
    ...repository.matchAll(
      /INSERT INTO fund_contributions[\s\S]*?ON CONFLICT \(stripe_session_id\)([\s\S]{0,80}?)(?:DO NOTHING|DO UPDATE)/g
    )
  ];

  assert.ok(
    onConflictClauses.length >= 2,
    'expected fund_contributions inserts in insertCheckoutSessionRecord and upsertCheckoutSessionFromWebhook'
  );

  for (const [, between] of onConflictClauses) {
    assert.ok(
      between.includes('WHERE stripe_session_id IS NOT NULL'),
      'ON CONFLICT (stripe_session_id) on fund_contributions must repeat the partial index predicate, or Postgres throws 42P10 at runtime'
    );
  }
});

test('PostgreSQL compose service is private and profile-gated', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');

  assert.ok(compose.includes('postgres:'));
  assert.ok(compose.includes('profiles:'));
  assert.ok(compose.includes('openg7-data'));
  assert.ok(compose.includes('internal: true'));
  assert.ok(compose.includes('FUNDING_ADMIN_SESSION_SECRET'));
  assert.ok(compose.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR'));
  assert.ok(compose.includes('openg7-sponsor-logos'));
  assert.equal(/['"]?5432:5432['"]?/.test(compose), false);
});

test('PostgreSQL restore helper rebuilds from backup with destructive safeguards', () => {
  const script = fs.readFileSync('scripts/restore-from-backup.sh', 'utf8');
  const docs = fs.readFileSync('docs/docker-deployment.md', 'utf8');

  assert.ok(
    script.includes(
      'POSTGRES_VOLUME_NAME="${POSTGRES_VOLUME_NAME:-openg7-postgres-data}"'
    )
  );
  assert.ok(script.includes('Type RESTORE OPENG7 to continue.'));
  assert.ok(script.includes('docker volume rm "${POSTGRES_VOLUME_NAME}"'));
  assert.ok(script.includes('psql -v ON_ERROR_STOP=1'));
  assert.ok(script.includes('bash scripts/check.sh'));
  assert.ok(docs.includes('bash scripts/restore-from-backup.sh'));
});

test('Stripe webhook service handles MVP idempotent event set', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );

  for (const eventType of [
    'checkout.session.completed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.updated',
    'charge.refunded',
    'charge.dispute.created',
    'payout.paid',
    'payout.failed'
  ]) {
    assert.ok(source.includes(eventType));
  }

  assert.ok(source.includes('insertStripeEventRecord'));
  assert.ok(source.includes('markStripeEventProcessed'));
  assert.ok(source.includes('markStripeEventFailed'));
});

test('Stripe charge.updated backfills contribution transaction fees', () => {
  const webhookSource = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const repositorySource = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(webhookSource.includes("event.type === 'charge.updated'"));
  assert.ok(webhookSource.includes('updateContributionFundTransactionBalance'));
  assert.ok(repositorySource.includes('UPDATE fund_transactions'));
  assert.ok(repositorySource.includes("type = 'payment_intent.succeeded'"));
  assert.ok(repositorySource.includes('stripe_balance_transaction_id = $2'));
  assert.ok(repositorySource.includes('fee = $4'));
  assert.ok(repositorySource.includes('net = $5'));
});

test('Checkout sessions require fundraiser metadata and consent fields', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(source.includes('allowedContributionAmounts.has(amount)'));
  assert.ok(source.includes("'personal_support'"));
  assert.ok(source.includes("'sponsorship_interest'"));
  assert.ok(source.includes('parsed.nonCharityAcknowledged !== true'));
  assert.ok(source.includes('resolveCheckoutReturnUrl'));

  for (const metadata of [
    "project: 'openg7'",
    "program: 'builders_fund'",
    'contributionType: parsed.contributionType',
    'publicDisplayConsent: String(parsed.publicDisplayConsent)',
    'displayAmountConsent: String(parsed.displayAmountConsent)',
    'nonCharityAcknowledged: String(parsed.nonCharityAcknowledged)',
    'requiresReview: String(requiresReview)'
  ]) {
    assert.ok(source.includes(metadata));
  }
});

test('resolveCheckoutReturnUrl allows http localhost/127.0.0.1 only outside production', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  const match = source.match(/const resolveCheckoutReturnUrl[\s\S]*?\n};/);
  assert.ok(match, 'expected to find resolveCheckoutReturnUrl function body');
  const fnSource = match[0];

  assert.ok(
    fnSource.includes("candidate.hostname === 'localhost'") &&
      fnSource.includes("candidate.hostname === '127.0.0.1'"),
    'expected an exact-equality check against localhost and 127.0.0.1 hostnames'
  );
  assert.ok(
    fnSource.includes("candidate.protocol === 'http:'"),
    'expected the dev allowance to require the http: protocol'
  );

  const devAllowanceMatch = fnSource.match(
    /if\s*\(([\s\S]{0,200}?candidate\.hostname === '127\.0\.0\.1'[\s\S]{0,50}?)\)\s*\{/
  );
  assert.ok(
    devAllowanceMatch,
    'expected an if-condition guarding the localhost allowance'
  );
  assert.ok(
    /!isProduction/.test(devAllowanceMatch[1]),
    'the localhost/127.0.0.1 http allowance must be gated behind !isProduction so it never applies in production'
  );

  assert.equal(
    /^\s*if\s*\(\s*candidate\.hostname === '(localhost|127\.0\.0\.1)'/m.test(
      fnSource
    ),
    false,
    'the localhost/127.0.0.1 allowance must not be reachable unconditionally (without an isProduction guard)'
  );
});

test('Public transparency can read aggregate data from fund contributions', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('has_fund_contributions'));
  assert.ok(source.includes('FROM fund_contributions'));
  assert.ok(source.includes("data_source: 'database'"));
  assert.ok(source.includes("status IN ('paid', 'refunded', 'disputed')"));
  assert.equal(/SELECT[\s\S]*email_private/.test(source), false);
});

test('Public builders are exposed only through consented public fields', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('public_builders'));
  assert.ok(source.includes('public_display_consent IS TRUE'));
  assert.ok(source.includes('public_name IS NOT NULL'));
  assert.ok(source.includes('display_amount_consent IS TRUE'));
  assert.equal(source.includes('email_private AS'), false);
});

test('Stripe-direct transparency marks its public data source', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-transparency.service.ts',
    'utf8'
  );

  assert.ok(source.includes("data_source: 'stripe_direct'"));
});

test('Builders page is routed and prerendered in both languages', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');

  assert.ok(routes.includes("path: 'batisseurs'"));
  assert.ok(serverRoutes.includes("path: 'batisseurs'"));
  assert.ok(serverRoutes.includes("path: 'en/batisseurs'"));
  assert.ok(sitemap.includes('https://openg7.org/batisseurs'));
  assert.ok(sitemap.includes('https://openg7.org/en/batisseurs'));
});

test('Sponsorship details migration adds optional company follow-up columns', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/003_add_sponsorship_details.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_company_name',
    'sponsor_contact_name',
    'sponsor_contact_email',
    'sponsor_website_url',
    'sponsor_logo_url',
    'sponsor_message',
    'sponsor_details_submitted_at'
  ]) {
    assert.ok(migration.includes(column));
  }
});

test('recordSponsorshipDetails upserts against the partial unique index', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  const match = source.match(
    /export const recordSponsorshipDetails[\s\S]*?ON CONFLICT \(stripe_session_id\)([\s\S]{0,80}?)DO UPDATE/
  );

  assert.ok(
    match,
    'expected recordSponsorshipDetails to upsert on stripe_session_id'
  );
  assert.ok(match[1].includes('WHERE stripe_session_id IS NOT NULL'));
});

test('Sponsorship details endpoint validates required fields and payment state', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(source.includes("'/sponsorship-details'"));
  assert.ok(source.includes("'/api/sponsorship-details'"));
  assert.ok(source.includes('isNonEmptySponsorText(parsed.companyName'));
  assert.ok(source.includes('isNonEmptySponsorText(parsed.contactName'));
  assert.ok(source.includes('isValidSponsorEmail(parsed.contactEmail)'));
  assert.ok(source.includes('isValidOptionalHttpsUrl(parsed.websiteUrl)'));
  assert.ok(source.includes('isValidOptionalHttpsUrl(parsed.logoUrl)'));
  assert.ok(
    /normalizeContributionType\(sessionMetadata\.contributionType\)\s*!==\s*'sponsorship_interest'/.test(
      source
    )
  );
  assert.ok(source.includes("session.payment_status !== 'paid'"));
  assert.ok(source.includes('recordSponsorshipDetails(dbPool'));
});

test('Checkout requires a public display name when public display consent is granted', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(
    source.includes('parsed.publicDisplayConsent === true') &&
      source.includes(
        "'Public display name is required when public display consent is granted.'"
      ),
    'expected main.ts to require publicDisplayName when publicDisplayConsent is true'
  );
  assert.ok(
    /isNonEmptySponsorText\(\s*parsed\.publicDisplayName/.test(source),
    'expected publicDisplayName to be validated as non-empty bounded text'
  );
});

test('publicDisplayName is discarded server-side when public display consent is not granted', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  const match = source.match(/const publicDisplayName =\s*([\s\S]{0,160}?);/);
  assert.ok(
    match,
    'expected to find the publicDisplayName derivation before it is sent to Stripe/DB'
  );
  assert.ok(
    /parsed\.publicDisplayConsent === true/.test(match[1]),
    'expected publicDisplayName to only be kept when publicDisplayConsent is true, so a name typed without consent is never sent to Stripe metadata or persisted to public_name'
  );
});

test('fund_contributions writes public_name on both the checkout-creation and webhook paths', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );

  assert.ok(
    /export const insertCheckoutSessionRecord[\s\S]*?public_name/.test(
      repository
    ),
    'expected insertCheckoutSessionRecord to write public_name'
  );
  assert.ok(
    /export const upsertCheckoutSessionFromWebhook[\s\S]*?public_name/.test(
      repository
    ),
    'expected upsertCheckoutSessionFromWebhook to write public_name'
  );
  assert.ok(
    repository.includes(
      'public_name = COALESCE(EXCLUDED.public_name, fund_contributions.public_name)'
    ),
    'expected the webhook upsert to preserve an existing public_name when a later event omits it'
  );
});

test('Stripe webhook service reads publicDisplayName from checkout session metadata', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );

  assert.ok(source.includes('metadata.publicDisplayName'));
  assert.ok(source.includes('publicName:'));
});

test('Public display name input has matching i18n keys in both locales', () => {
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  for (const locale of [fr, en]) {
    const contribution = locale.funding.home.contribution;
    assert.ok(contribution.publicDisplayNameLabel);
    assert.ok(contribution.publicDisplayNamePlaceholder);
  }
});

test('Custom contribution amount input accepts only decimal numeric values', () => {
  const source = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const styles = fs.readFileSync('apps/funding-web/src/styles.css', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(source.includes('class="custom-amount-input"'));
  assert.ok(source.includes('type="text"'));
  assert.ok(source.includes('inputmode="decimal"'));
  assert.ok(source.includes('pattern="[0-9]+([.,][0-9]{0,2})?"'));
  assert.ok(source.includes('sanitizeCustomContributionValue'));
  assert.ok(source.includes("normalizedValue.replace(/[^0-9.]/g, '')"));
  assert.ok(source.includes("decimalParts.join('').slice(0, 2)"));
  assert.ok(source.includes('parseCustomContributionAmount'));
  assert.ok(source.includes('/^\\d+(?:\\.\\d{0,2})?$/.test(value)'));
  assert.ok(source.includes('!this.hasInvalidCustomContribution()'));
  assert.ok(source.includes('normalizeCustomContributionFromEvent'));
  assert.ok(styles.includes(".custom-amount-input[aria-invalid='true']"));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.home.contribution.amountFormatHint);
    assert.ok(locale.funding.home.contribution.amountFormatError);
  }
});

test('Business sponsorship contribution choice is temporarily disabled', () => {
  const source = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const styles = fs.readFileSync('apps/funding-web/src/styles.css', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(source.includes('readonly sponsorshipSelectionEnabled = false'));
  assert.ok(source.includes('[disabled]="!sponsorshipSelectionEnabled"'));
  assert.ok(source.includes("type === 'sponsorship_interest'"));
  assert.ok(source.includes('!this.sponsorshipSelectionEnabled'));
  assert.ok(source.includes('funding.home.contribution.sponsorship.disabled'));
  assert.ok(styles.includes('.contribution-type-card:disabled'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.home.contribution.sponsorship.disabled);
  }
});

test('Sponsor follow-up screen has matching i18n keys in both locales', () => {
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  for (const locale of [fr, en]) {
    const checkout = locale.funding.home.checkout;
    assert.ok(checkout.sponsorTitle);
    assert.ok(checkout.sponsorCopy);
    assert.ok(checkout.sponsorForm.companyNameLabel);
    assert.ok(checkout.sponsorForm.contactNameLabel);
    assert.ok(checkout.sponsorForm.contactEmailLabel);
    assert.ok(checkout.sponsorForm.submit);
    assert.ok(checkout.sponsorForm.successTitle);
    assert.ok(checkout.sponsorForm.nextStepsLink);
  }
});

test('Sponsorship review and follow-up migrations add private workflow columns', () => {
  const reviewMigration = fs.readFileSync(
    'apps/funding-api/migrations/004_add_sponsorship_review.sql',
    'utf8'
  );
  const followupMigration = fs.readFileSync(
    'apps/funding-api/migrations/005_add_sponsorship_followup_token.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_review_status',
    'sponsor_review_note',
    'sponsor_reviewed_at'
  ]) {
    assert.ok(reviewMigration.includes(column));
  }

  assert.ok(followupMigration.includes('sponsorship_followup_token_hash'));
  assert.ok(
    followupMigration.includes(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_followup_token_hash'
    )
  );
  assert.ok(
    followupMigration.includes(
      'WHERE sponsorship_followup_token_hash IS NOT NULL'
    )
  );
});

test('Checkout creates sponsorship follow-up URL and DB hash without raw Stripe metadata', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const checkoutMetadataBlock = extractBetween(
    source,
    'const checkoutMetadata',
    'const session = await stripe.checkout.sessions.create',
    'checkout metadata'
  );

  assert.ok(source.includes('createSponsorshipFollowupToken'));
  assert.ok(source.includes('hashSponsorshipFollowupToken'));
  assert.ok(source.includes("'followup_token'"));
  assert.equal(
    checkoutMetadataBlock.includes('sponsorshipFollowupToken,'),
    false
  );
  assert.ok(source.includes('sponsorshipFollowupTokenHash'));
});

test('Sponsorship follow-up endpoints are token based and do not require Stripe session ids', () => {
  const source = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(source.includes("'/sponsorship-followup'"));
  assert.ok(source.includes("'/api/sponsorship-followup'"));
  assert.ok(source.includes("'/sponsorship-followup/details'"));
  assert.ok(source.includes("'/api/sponsorship-followup/details'"));
  assert.ok(source.includes('isValidFollowupToken'));
  assert.ok(source.includes('getSponsorshipFollowupByTokenHash'));
  assert.ok(source.includes('recordSponsorshipDetailsForContribution'));
});

test('Sponsorship follow-up email is sent from checkout completion only when recoverable', () => {
  const webhook = fs.readFileSync(
    'apps/funding-api/src/stripe-webhook.service.ts',
    'utf8'
  );
  const email = fs.readFileSync(
    'apps/funding-api/src/email-notification.service.ts',
    'utf8'
  );

  assert.ok(webhook.includes('sendSponsorshipFollowupEmail'));
  assert.ok(webhook.includes('buildSponsorshipFollowupUrl'));
  assert.ok(webhook.includes('extractSponsorshipFollowupTokenFromSession'));
  assert.ok(webhook.includes('followupToken'));
  assert.ok(webhook.includes('followupEmail'));
  assert.ok(webhook.includes('markSponsorshipFollowupEmailResult'));
  assert.ok(email.includes('RESEND_API_KEY'));
  assert.ok(email.includes('FUNDING_EMAIL_FROM'));
});

test('Sponsorship follow-up tokens expire and details edits return to review', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const followupPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'utf8'
  );
  const recordDetailsBody = extractBetween(
    repository,
    'export const recordSponsorshipDetailsForContribution',
    'export const markSponsorshipFollowupEmailResult',
    'sponsorship follow-up recording'
  );

  assert.ok(api.includes('FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS'));
  assert.ok(api.includes('getSponsorshipFollowupTokenCutoffIso'));
  assert.ok(
    repository.includes(
      'sponsorship_followup_token_created_at >= $2::timestamptz'
    )
  );
  assert.ok(
    recordDetailsBody.includes("sponsor_review_status = 'pending_review'")
  );
  assert.ok(recordDetailsBody.includes('sponsor_reviewed_at = NULL'));
  assert.ok(followupPage.includes('history.replaceState'));
  assert.ok(followupPage.includes("url.searchParams.delete('token')"));
});

test('Sensitive sponsorship API routes have in-process rate limiting', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const envExample = fs.readFileSync('.env.example', 'utf8');

  assert.ok(api.includes('createRateLimiter'));
  assert.ok(api.includes('getRequestRateLimiter'));
  assert.ok(api.includes('enforceRateLimit'));
  assert.ok(api.includes('Retry-After'));
  assert.ok(api.includes('FUNDING_RATE_LIMIT_WINDOW_MS'));
  assert.ok(api.includes('FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_ADMIN_RATE_LIMIT_MAX'));
  assert.ok(api.includes('FUNDING_ADMIN_SESSION_SECRET'));
  assert.ok(api.includes('FUNDING_ADMIN_SESSION_TTL_MINUTES'));
  assert.ok(api.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR'));
  assert.ok(api.includes('FUNDING_SPONSOR_LOGO_MAX_BYTES'));
  assert.ok(
    envExample.includes('FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS=30')
  );
  assert.ok(envExample.includes('FUNDING_ADMIN_RATE_LIMIT_MAX=120'));
  assert.ok(envExample.includes('FUNDING_ADMIN_SESSION_SECRET='));
  assert.ok(envExample.includes('FUNDING_ADMIN_SESSION_TTL_MINUTES=60'));
  assert.ok(envExample.includes('FUNDING_SPONSOR_LOGO_STORAGE_DIR='));
  assert.ok(envExample.includes('FUNDING_SPONSOR_LOGO_MAX_BYTES=524288'));
});

test('Sponsorship follow-up page is routed but not added to the sitemap', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');

  assert.ok(routes.includes("path: 'fonds-des-batisseurs/suivi-commandite'"));
  assert.equal(sitemap.includes('suivi-commandite'), false);
});

test('Public builders hide sponsorships until admin approval is recorded', () => {
  const source = fs.readFileSync(
    'apps/funding-api/src/fund-transparency.repository.ts',
    'utf8'
  );

  assert.ok(source.includes('has_sponsor_review_status'));
  assert.ok(source.includes("sponsor_review_status = 'approved'"));
  assert.ok(source.includes("contribution_type <> 'sponsorship_interest'"));
});

test('Sponsorship publication migration adds public profile and feed fields', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql',
    'utf8'
  );

  for (const column of [
    'sponsor_public_slug',
    'sponsor_public_summary',
    'sponsor_feed_target',
    'sponsor_feed_channels',
    'sponsor_feed_status',
    'sponsor_feed_public_url',
    'sponsor_feed_notes',
    'sponsor_visibility_updated_at'
  ]) {
    assert.ok(migration.includes(column));
  }

  assert.ok(migration.includes('idx_fund_contributions_sponsor_public_slug'));
});

test('Admin audit and publication draft migration adds private back-office tables', () => {
  const migration = fs.readFileSync(
    'apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql',
    'utf8'
  );

  for (const tableOrColumn of [
    'CREATE TABLE IF NOT EXISTS admin_audit_log',
    'CREATE TABLE IF NOT EXISTS sponsor_publication_drafts',
    'actor TEXT NOT NULL',
    'metadata JSONB NOT NULL',
    'contribution_id UUID NOT NULL REFERENCES fund_contributions(id)',
    'disclosure_text TEXT NOT NULL',
    'status TEXT NOT NULL DEFAULT',
    'public_url TEXT',
    'idx_admin_audit_log_created_at',
    'idx_sponsor_publication_drafts_unique_channel'
  ]) {
    assert.ok(migration.includes(tableOrColumn));
  }
});

test('Public sponsorships are exposed only after consent and approval', () => {
  const repository = fs.readFileSync(
    'apps/funding-api/src/fund-contributions.repository.ts',
    'utf8'
  );
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');

  assert.ok(api.includes("'/public/sponsorships'"));
  assert.ok(api.includes("'/api/public/sponsorships'"));
  assert.ok(repository.includes('listPublicSponsorships'));
  assert.ok(repository.includes('public_display_consent IS TRUE'));
  assert.ok(repository.includes("sponsor_review_status = 'approved'"));
  assert.equal(repository.includes('sponsor_contact_email AS'), false);
  assert.equal(repository.includes('email_private AS'), false);
});

test('Admin sponsorship publication endpoint validates feed placement fields', () => {
  const api = fs.readFileSync('apps/funding-api/src/main.ts', 'utf8');
  const service = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-admin.service.ts',
    'utf8'
  );

  assert.ok(api.includes("'/admin/sponsorships/publication'"));
  assert.ok(api.includes("'/api/admin/sponsorships/publication'"));
  assert.ok(api.includes('isValidOptionalPublicSlug'));
  assert.ok(api.includes('isAllowedSponsorFeedTarget'));
  assert.ok(api.includes('parseSponsorFeedChannelsFromRequest'));
  assert.ok(api.includes('isAllowedSponsorFeedStatus'));
  assert.ok(service.includes('/admin/sponsorships/publication'));
});

test('Sponsors page is routed, prerendered, translated, and indexed', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(routes.includes("path: 'commanditaires'"));
  assert.ok(serverRoutes.includes("path: 'commanditaires'"));
  assert.ok(serverRoutes.includes("path: 'en/commanditaires'"));
  assert.ok(sitemap.includes('https://openg7.org/commanditaires'));
  assert.ok(sitemap.includes('https://openg7.org/en/commanditaires'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.nav.sponsors);
    assert.ok(locale.funding.seo.sponsors.title);
    assert.ok(locale.funding.sponsorsPage.hero.title);
    assert.ok(locale.funding.sponsorsPage.feedStatus.published);
  }
});

test('Usage and refund policy page is routed, linked, documented, and indexed', () => {
  const routes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.ts',
    'utf8'
  );
  const serverRoutes = fs.readFileSync(
    'apps/funding-web/src/app/app.routes.server.ts',
    'utf8'
  );
  const i18nService = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding-i18n.service.ts',
    'utf8'
  );
  const fundingPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts',
    'utf8'
  );
  const policyPage = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/pages/usage-refund-policy-page/usage-refund-policy-page.component.ts',
    'utf8'
  );
  const sitemap = fs.readFileSync('apps/funding-web/src/sitemap.xml', 'utf8');
  const docs = [
    fs.readFileSync('README.md', 'utf8'),
    fs.readFileSync('docs/docker-deployment.md', 'utf8'),
    fs.readFileSync('docs/production-launch-checklist.md', 'utf8')
  ].join('\n');
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(routes.includes('UsageRefundPolicyPageComponent'));
  assert.ok(routes.includes("path: 'politique-utilisation-remboursement'"));
  assert.ok(
    serverRoutes.includes("path: 'politique-utilisation-remboursement'")
  );
  assert.ok(
    serverRoutes.includes("path: 'en/politique-utilisation-remboursement'")
  );
  assert.ok(i18nService.includes("| '/politique-utilisation-remboursement'"));
  assert.ok(i18nService.includes("'/politique-utilisation-remboursement'"));
  assert.ok(
    sitemap.includes('https://openg7.org/politique-utilisation-remboursement')
  );
  assert.ok(
    sitemap.includes(
      'https://openg7.org/en/politique-utilisation-remboursement'
    )
  );
  assert.ok(fundingPage.includes('policyPath'));
  assert.ok(fundingPage.includes('funding.home.contribution.policyLink'));
  assert.ok(policyPage.includes('funding.seo.policy.title'));
  assert.ok(policyPage.includes('funding.policyPage.sections.refunds'));
  assert.ok(policyPage.includes('funding.policyPage.sections.sponsorship'));
  assert.ok(docs.includes('/politique-utilisation-remboursement'));
  assert.ok(docs.includes('/en/politique-utilisation-remboursement'));

  for (const locale of [fr, en]) {
    assert.ok(locale.funding.seo.policy.title);
    assert.ok(locale.funding.home.contribution.policyLink);
    assert.ok(locale.funding.policyPage.hero.title);
    assert.ok(locale.funding.policyPage.sections.nature.items.noReceipt);
    assert.ok(locale.funding.policyPage.sections.refunds.items.request);
    assert.ok(locale.funding.policyPage.sections.disputes.items.stripe);
    assert.ok(locale.funding.policyPage.sections.sponsorship.items.followup);
    assert.ok(locale.funding.policyPage.sections.visibility.items.feed);
    assert.ok(locale.funding.policyPage.sections.privacy.items.privateData);
  }
});
