import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { OPENG7_FUNDING_CONFIG } from '../dist/apps/funding-web/src/app/features/funding/config/openg7-funding.config.js';
import { createMockCheckoutResult } from '../dist/packages/funding-core/src/index.js';

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
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS fund_contributions'));
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
    migration.includes(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_contributions_stripe_session_id\n  ON fund_contributions (stripe_session_id)\n  WHERE stripe_session_id IS NOT NULL'
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
  assert.equal(/['"]?5432:5432['"]?/.test(compose), false);
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
  const routes = fs.readFileSync('apps/funding-web/src/app/app.routes.ts', 'utf8');
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

  assert.ok(match, 'expected recordSponsorshipDetails to upsert on stripe_session_id');
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
