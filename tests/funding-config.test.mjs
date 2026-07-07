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
    'charge.dispute.created'
  ]) {
    assert.ok(source.includes(eventType));
  }

  assert.ok(source.includes('insertStripeEventRecord'));
  assert.ok(source.includes('markStripeEventProcessed'));
  assert.ok(source.includes('markStripeEventFailed'));
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
