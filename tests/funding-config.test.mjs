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
