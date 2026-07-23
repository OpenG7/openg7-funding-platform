#!/usr/bin/env node
// Seeds (or removes) fixture "sponsorship_interest" rows used by the
// Playwright admin-review E2E spec. The `data` Docker network is internal
// (no published Postgres port), so this shells out to
// `docker compose exec postgres psql` instead of connecting over TCP from
// the host, the same way scripts/db-migrate.mjs and scripts/db-psql.sh do.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  EMAIL_QUEUE_FIXTURE,
  SPONSORSHIP_FIXTURES
} from '../tests/playwright/fixtures/e2e-fixtures.mjs';
import { loadDotEnv } from './lib/load-dotenv.mjs';

loadDotEnv('.env');

const POSTGRES_DB = process.env.POSTGRES_DB || 'openg7_funding';
const POSTGRES_USER = process.env.POSTGRES_USER || 'openg7_funding';

const sqlLiteral = (value) => `'${value.replace(/'/g, "''")}'`;
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const cleanupOnly = process.argv.includes('--cleanup');
const fixtures = Object.values(SPONSORSHIP_FIXTURES);

const deleteStatements = fixtures
  .map(
    (fixture) => `
DELETE FROM fund_contributions
WHERE sponsor_contact_email = ${sqlLiteral(fixture.contactEmail)}
   OR public_reference = ${sqlLiteral(fixture.publicReference)};`
  )
  .join('\n');

const insertStatements = fixtures
  .map((fixture) => {
    const reviewStatus = fixture.reviewStatus ?? 'pending_review';
    const reviewedAt = reviewStatus === 'pending_review' ? 'NULL' : 'NOW()';
    const stripePaymentIntentId = fixture.stripePaymentIntentId
      ? sqlLiteral(fixture.stripePaymentIntentId)
      : 'NULL';
    const stripeSessionId = fixture.stripeSessionId
      ? sqlLiteral(fixture.stripeSessionId)
      : 'NULL';
    const feedTarget = fixture.feedTarget
      ? sqlLiteral(fixture.feedTarget)
      : 'NULL';
    const feedChannels = fixture.feedChannels
      ? `${sqlLiteral(JSON.stringify(fixture.feedChannels))}::jsonb`
      : "'[]'::jsonb";

    return `
INSERT INTO fund_contributions (
  contribution_type, amount_cents, currency, status, paid_at,
  public_display_consent, display_amount_consent, non_charity_acknowledged,
  sponsor_company_name, sponsor_contact_name, sponsor_contact_email,
  sponsor_website_url, sponsor_details_submitted_at, sponsor_review_status,
  sponsor_reviewed_at, sponsorship_followup_token_hash,
  sponsorship_followup_token_created_at, public_reference,
  stripe_payment_intent_id, stripe_session_id,
  sponsor_feed_target, sponsor_feed_channels
) VALUES (
  'sponsorship_interest', ${fixture.amountCents}, 'cad', 'paid', NOW(),
  TRUE, TRUE, TRUE,
  ${sqlLiteral(fixture.companyName)}, ${sqlLiteral(fixture.contactName)},
  ${sqlLiteral(fixture.contactEmail)}, ${sqlLiteral(fixture.websiteUrl)},
  NOW(), ${sqlLiteral(reviewStatus)},
  ${reviewedAt}, ${sqlLiteral(sha256Hex(fixture.followupToken))}, NOW(),
  ${sqlLiteral(fixture.publicReference)}, ${stripePaymentIntentId},
  ${stripeSessionId}, ${feedTarget}, ${feedChannels}
);`;
  })
  .join('\n');

const emailQueueDelete = `
DELETE FROM email_messages
WHERE idempotency_key = ${sqlLiteral(EMAIL_QUEUE_FIXTURE.idempotencyKey)};`;

const emailQueueInsert = `
INSERT INTO email_messages (
  idempotency_key, template_key, recipient_email, from_email, subject,
  text_body, html_body, status
) VALUES (
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.idempotencyKey)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.templateKey)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.recipientEmail)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.fromEmail)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.subject)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.textBody)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.htmlBody)},
  'queued'
);`;

const sql = cleanupOnly
  ? `${deleteStatements}\n${emailQueueDelete}`
  : `${deleteStatements}\n${insertStatements}\n${emailQueueDelete}\n${emailQueueInsert}`;

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
