#!/usr/bin/env node
// Seeds (or removes) fixture "sponsorship_interest" rows used by the
// Playwright admin-review E2E spec. The `data` Docker network is internal
// (no published Postgres port), so this shells out to
// `docker compose exec postgres psql` instead of connecting over TCP from
// the host, the same way scripts/db-migrate.mjs and scripts/db-psql.sh do.
//
// Also seeds the personal_support "pending" contributions the webhook/
// accounting specs flip to paid themselves (by delivering a real, signed
// webhook -- see tests/playwright/support/stripe-webhook.ts), and registers
// every fixture that carries a Stripe id with the Stripe stub
// (tests/stripe-stub/) so /v1/refunds and the webhook/backfill code paths
// have real Stripe-shaped objects to resolve.
import { spawnSync } from 'node:child_process';

import {
  ACCOUNTING_FIXTURES,
  BACKFILL_FIXTURES,
  EMAIL_QUEUE_FIXTURE,
  SPONSORSHIP_FIXTURES,
  WEBHOOK_FIXTURES
} from '../tests/playwright/fixtures/e2e-fixtures.mjs';
import {
  registerStripeCheckoutSession,
  registerStripePaymentIntent,
  resetStripeStub
} from '../tests/playwright/support/stripe-stub-client.mjs';
import { buildE2eSeedSql } from './lib/e2e-seed/plan.mjs';
import { seedStripeStub } from './lib/e2e-seed/stripe-stub.mjs';
import { loadDotEnv } from './lib/load-dotenv.mjs';

loadDotEnv(process.env.OPENG7_E2E_ENV_FILE ?? '.env');

const POSTGRES_DB = process.env.POSTGRES_DB || 'openg7_funding';
const POSTGRES_USER = process.env.POSTGRES_USER || 'openg7_funding';

const cleanupOnly = process.argv.includes('--cleanup');
const fixtures = Object.values(SPONSORSHIP_FIXTURES);
const sql = buildE2eSeedSql({
  sponsorshipFixtures: SPONSORSHIP_FIXTURES,
  webhookFixtures: WEBHOOK_FIXTURES,
  accountingFixtures: ACCOUNTING_FIXTURES,
  backfillFixtures: BACKFILL_FIXTURES,
  emailQueueFixture: EMAIL_QUEUE_FIXTURE,
  cleanupOnly
});

const result = spawnSync(
  'docker',
  [
    'compose',
    '--profile',
    'database',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    POSTGRES_USER,
    '-d',
    POSTGRES_DB
  ],
  {
    // A failed seed/cleanup must not leave partially removed fixtures behind.
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit']
  }
);

if (result.status !== 0) {
  console.error(
    cleanupOnly
      ? 'Failed to remove Playwright sponsorship fixtures.'
      : 'Failed to seed Playwright sponsorship fixtures.'
  );
  process.exit(result.status ?? 1);
}

console.log(
  cleanupOnly
    ? 'Removed Playwright sponsorship and email queue fixtures.'
    : `Seeded ${fixtures.length} Playwright sponsorship fixture(s) and 1 email queue fixture.`
);

try {
  await seedStripeStub({
    sponsorshipFixtures: SPONSORSHIP_FIXTURES,
    webhookFixtures: WEBHOOK_FIXTURES,
    accountingFixtures: ACCOUNTING_FIXTURES,
    backfillFixtures: BACKFILL_FIXTURES,
    cleanupOnly,
    ports: {
      resetStripeStub,
      registerStripePaymentIntent,
      registerStripeCheckoutSession
    }
  });
} catch (error) {
  console.error(
    'Failed to seed the Stripe stub (tests/stripe-stub/). Is docker-compose.e2e.yml up?',
    error
  );
  process.exit(1);
}

console.log(
  cleanupOnly ? 'Reset the Stripe stub.' : 'Seeded the Stripe stub fixtures.'
);
