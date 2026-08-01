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
import { createHash } from 'node:crypto';

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
import { loadDotEnv } from './lib/load-dotenv.mjs';

loadDotEnv('.env');

const POSTGRES_DB = process.env.POSTGRES_DB || 'openg7_funding';
const POSTGRES_USER = process.env.POSTGRES_USER || 'openg7_funding';

const sqlLiteral = (value) => `'${value.replace(/'/g, "''")}'`;
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const cleanupOnly = process.argv.includes('--cleanup');
const fixtures = Object.values(SPONSORSHIP_FIXTURES);
const webhookFixtures = Object.values(WEBHOOK_FIXTURES);
// replaySponsorship is deliberately excluded from the pending-row seed
// below: checkout.session.completed creates its row from scratch (see
// stripe-webhook.service.ts), the same way checkout.session.expired does
// for excludedExpired. Pre-seeding it here as well would insert a row
// carrying its public_reference *before* the webhook ever runs, and the
// webhook's own insert of the same public_reference would then collide
// with it on fund_contributions' unique index.
const webhookPendingFixtures = webhookFixtures.filter(
  (fixture) => fixture !== WEBHOOK_FIXTURES.replaySponsorship
);
// Every Stripe event id these specs deliver, across every run: stripe_events
// and fund_transactions are never touched by the fund_contributions
// delete/insert cycle above, so without this a fixture's event id stays
// permanently marked 'processed' after its first-ever run, and every
// subsequent run sees a false `duplicate: true` instead of exercising the
// webhook handler at all (confirmed the hard way -- this is not
// theoretical). ON CONFLICT/idempotency inside the handler is exactly what
// tests 79/83 assert on *within* a single run; across runs, the fixtures
// need a clean slate the same way fund_contributions gets one.
const allFixtureStripeEventIds = [
  ...webhookFixtures.flatMap((fixture) =>
    [
      fixture.stripeEventId,
      fixture.stripeEventIdSucceeded,
      fixture.stripeEventIdUpdated,
      fixture.stripeEventIdFirst,
      fixture.stripeEventIdResend
    ].filter(Boolean)
  ),
  ...[
    ACCOUNTING_FIXTURES.scenario,
    ACCOUNTING_FIXTURES.excludedFailed,
    ACCOUNTING_FIXTURES.excludedExpired,
    ACCOUNTING_FIXTURES.fullyRefunded
  ].flatMap((fixture) =>
    [
      fixture.stripeEventId,
      fixture.stripeEventIdSucceeded,
      fixture.stripeEventIdRefunded
    ].filter(Boolean)
  )
];
const stripeEventsDelete = `
DELETE FROM stripe_events
WHERE stripe_event_id IN (${allFixtureStripeEventIds.map(sqlLiteral).join(', ')});`;
const fundTransactionsByEventDelete = `
DELETE FROM fund_transactions
WHERE stripe_event_id IN (${allFixtureStripeEventIds.map(sqlLiteral).join(', ')});`;

// stripe-backfill-reconciliation.spec.ts creates real fund_contributions/
// stripe_checkout_sessions/fund_transactions rows by actually running the
// backfill CLI (not through fund_contributions' usual delete/insert cycle
// above), and uses synthetic `stripe-backfill:<type>:<objectId>` event ids
// (see stripe-backfill.service.ts) rather than the ids above -- clean those
// up by the Stripe object id / public_reference instead.
const backfillObjectIds = [
  BACKFILL_FIXTURES.matchedSession.stripePaymentIntentId,
  BACKFILL_FIXTURES.unmatchedSession.stripePaymentIntentId,
  BACKFILL_FIXTURES.sponsorshipSession.stripePaymentIntentId
];
const backfillSessionIds = [
  BACKFILL_FIXTURES.matchedSession.stripeSessionId,
  BACKFILL_FIXTURES.unmatchedSession.stripeSessionId,
  BACKFILL_FIXTURES.sponsorshipSession.stripeSessionId,
  WEBHOOK_FIXTURES.replaySponsorship.stripeSessionId,
  ACCOUNTING_FIXTURES.excludedExpired.stripeSessionId
];
const backfillContributionRefs = [
  BACKFILL_FIXTURES.matchedSession.publicReference,
  BACKFILL_FIXTURES.sponsorshipSession.publicReference
];
const fundTransactionsByObjectDelete = `
DELETE FROM fund_transactions
WHERE stripe_object_id IN (${backfillObjectIds.map(sqlLiteral).join(', ')});`;
const stripeCheckoutSessionsDelete = `
DELETE FROM stripe_checkout_sessions
WHERE stripe_session_id IN (${backfillSessionIds.map(sqlLiteral).join(', ')});`;
const backfillContributionsDelete = `
DELETE FROM fund_contributions
WHERE public_reference IN (${backfillContributionRefs.map(sqlLiteral).join(', ')});`;

// excludedExpired is deliberately absent here: checkout.session.expired
// creates its row from scratch (see stripe-webhook.service.ts), so it must
// never be pre-seeded.
const accountingPendingFixtures = [
  ACCOUNTING_FIXTURES.scenario,
  ACCOUNTING_FIXTURES.excludedFailed,
  ACCOUNTING_FIXTURES.fullyRefunded
];

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

const sponsorMediaInsertStatements = fixtures
  .map((fixture) => {
    const fixtureKey = `e2e/${fixture.publicReference.toLowerCase()}`;
    return `
INSERT INTO sponsor_media_assets (
  contribution_id, kind, review_status, uploaded_by, original_filename,
  original_mime_type, original_size_bytes, original_storage_key,
  processed_size_bytes, processed_storage_key, public_storage_key, public_url,
  checksum_sha256, width, height, alt_text, reviewed_at, reviewed_by
)
SELECT
  id, 'supporting_image', 'approved', 'admin', 'presentation.png',
  'image/png', 68, ${sqlLiteral(`${fixtureKey}/original.png`)},
  44, ${sqlLiteral(`${fixtureKey}/processed.webp`)},
  ${sqlLiteral(`${fixtureKey}/public.webp`)},
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
  ${sqlLiteral(sha256Hex(`${fixture.publicReference}:presentation`))},
  1, 1, ${sqlLiteral(`Photo de presentation ${fixture.companyName}`)}, NOW(),
  'e2e-seed'
FROM fund_contributions
WHERE public_reference = ${sqlLiteral(fixture.publicReference)};`;
  })
  .join('\n');

const emailQueueDelete = `
DELETE FROM email_messages
WHERE idempotency_key = ${sqlLiteral(EMAIL_QUEUE_FIXTURE.idempotencyKey)};`;

// Keep the row visible as "queued" without letting the background worker
// process it before the Playwright retry test clicks "Relancer". The retry
// endpoint sets next_attempt_at back to NOW() before claiming the message.
const emailQueueInsert = `
INSERT INTO email_messages (
  idempotency_key, template_key, recipient_email, from_email, subject,
  text_body, html_body, status, next_attempt_at
) VALUES (
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.idempotencyKey)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.templateKey)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.recipientEmail)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.fromEmail)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.subject)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.textBody)},
  ${sqlLiteral(EMAIL_QUEUE_FIXTURE.htmlBody)},
  'queued',
  NOW() + INTERVAL '1 day'
);`;

// personal_support contributions the webhook/accounting specs seed as
// "pending" and then flip themselves by delivering a real signed webhook, or
// seed directly in a terminal status (failed/expired) that never needs one.
const webhookContributionDelete = (fixture) => `
DELETE FROM fund_contributions
WHERE sponsor_contact_email = ${sqlLiteral(fixture.contactEmail)}
   OR public_reference = ${sqlLiteral(fixture.publicReference)};`;

const webhookContributionInsert = (fixture, status) => `
INSERT INTO fund_contributions (
  contribution_type, amount_cents, currency, status,
  public_display_consent, display_amount_consent, non_charity_acknowledged,
  email_private, public_reference, stripe_payment_intent_id
) VALUES (
  'personal_support', ${fixture.amountCents}, 'cad', ${sqlLiteral(status)},
  TRUE, TRUE, TRUE,
  ${sqlLiteral(fixture.contactEmail)}, ${sqlLiteral(fixture.publicReference)},
  ${fixture.stripePaymentIntentId ? sqlLiteral(fixture.stripePaymentIntentId) : 'NULL'}
);`;

const webhookFixtureDeletes = webhookFixtures
  .map(webhookContributionDelete)
  .join('\n');
const webhookFixtureInserts = webhookPendingFixtures
  .map((fixture) => webhookContributionInsert(fixture, 'pending'))
  .join('\n');

const accountingPendingDeletes = accountingPendingFixtures
  .map(webhookContributionDelete)
  .join('\n');
const accountingPendingInserts = accountingPendingFixtures
  .map((fixture) => webhookContributionInsert(fixture, 'pending'))
  .join('\n');
// No insert for excludedExpired: only cleaned up, never pre-seeded (see
// accountingPendingFixtures above).
const accountingExpiredDelete = webhookContributionDelete(
  ACCOUNTING_FIXTURES.excludedExpired
);

const accountingExpenseDelete = `
DELETE FROM fund_allocations
WHERE project_name = ${sqlLiteral(ACCOUNTING_FIXTURES.scenario.expenseName)};`;
const accountingExpenseInsert = `
INSERT INTO fund_allocations (
  project_name, public_description, amount_allocated, currency, status, published_at
) VALUES (
  ${sqlLiteral(ACCOUNTING_FIXTURES.scenario.expenseName)},
  'E2E Playwright: depense de test pour le scenario comptable.',
  ${ACCOUNTING_FIXTURES.scenario.expenseAmountCents}, 'cad', 'published', NOW()
);`;

// getContributionTransparencySummary (fund-transparency.repository.ts) only
// uses the fund_transactions ledger for total_fees/total_refunded/
// total_payouts once at least one such row exists; on a genuinely empty
// ledger it falls back to summing fund_contributions.status='refunded'
// instead -- a *different* number. The very first charge.refunded webhook
// ever delivered against a fresh database flips that switch mid-test,
// making a before/after delta around it meaningless (confirmed against a
// clean volume: this is what broke funding-accounting-integrity.spec.ts's
// first run). Seeding one permanent, negligible, never-deleted ledger row
// up front keeps the switch in the same position for every run, on a fresh
// database or not -- this works around the read path, it does not touch it.
const ledgerSentinelInsert = `
INSERT INTO fund_transactions (
  stripe_event_id, stripe_object_id, stripe_balance_transaction_id,
  type, amount, fee, net, currency, status, created_at,
  public_category, metadata_json
) VALUES (
  'e2e-playwright-ledger-sentinel', 'e2e-playwright-ledger-sentinel-charge', NULL,
  'charge.refunded', 1, 0, 1, 'cad', 'succeeded', NOW(),
  'refund', '{"source":"e2e-playwright-ledger-sentinel"}'::jsonb
)
ON CONFLICT (stripe_event_id) DO NOTHING;`;

const sql = cleanupOnly
  ? [
      deleteStatements,
      emailQueueDelete,
      webhookFixtureDeletes,
      accountingPendingDeletes,
      accountingExpiredDelete,
      accountingExpenseDelete,
      fundTransactionsByEventDelete,
      fundTransactionsByObjectDelete,
      stripeEventsDelete,
      stripeCheckoutSessionsDelete,
      backfillContributionsDelete
    ].join('\n')
  : [
      deleteStatements,
      insertStatements,
      sponsorMediaInsertStatements,
      emailQueueDelete,
      emailQueueInsert,
      webhookFixtureDeletes,
      webhookFixtureInserts,
      accountingPendingDeletes,
      accountingPendingInserts,
      accountingExpiredDelete,
      accountingExpenseDelete,
      accountingExpenseInsert,
      // Cleanup before insert: every run gets a genuinely clean slate for
      // these fixtures' stripe_events/fund_transactions/
      // stripe_checkout_sessions rows, not just fund_contributions.
      fundTransactionsByEventDelete,
      fundTransactionsByObjectDelete,
      stripeEventsDelete,
      stripeCheckoutSessionsDelete,
      backfillContributionsDelete,
      ledgerSentinelInsert
    ].join('\n');

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

// --- Stripe stub -----------------------------------------------------

const seedStripeStub = async () => {
  await resetStripeStub();

  if (cleanupOnly) {
    return;
  }

  // Every sponsorship fixture with a stripePaymentIntentId gets a matching
  // PaymentIntent+Charge+BalanceTransaction registered, including the
  // pre-existing full/partial refund fixtures: refunds now go through the
  // real stub (/v1/refunds) instead of the createDevelopmentRefundResult
  // dev-mode mock, so the stub needs an original amount to validate against.
  for (const fixture of fixtures) {
    if (!fixture.stripePaymentIntentId) {
      continue;
    }
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      fee: 0
    });
  }

  // replaySponsorship has no stripePaymentIntentId/chargeId at all (see
  // webhookPendingFixtures above) -- checkout.session.completed never calls
  // the Stripe API, so it needs no stub-side backing data either.
  for (const fixture of webhookPendingFixtures) {
    const feeCents = fixture.initialFeeCents ?? fixture.feeCents ?? 0;
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      chargeId: fixture.stripeChargeId,
      balanceTransactionId: fixture.stripeBalanceTransactionId,
      fee: feeCents
    });
  }

  // excludedFailed is deliberately not registered here:
  // payment_intent.payment_failed never calls the Stripe API (see
  // stripe-webhook.service.ts), so it needs no stub-side backing data.
  for (const fixture of [
    ACCOUNTING_FIXTURES.scenario,
    ACCOUNTING_FIXTURES.fullyRefunded
  ]) {
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      chargeId: fixture.stripeChargeId,
      balanceTransactionId: fixture.stripeBalanceTransactionId,
      fee: fixture.feeCents
    });
  }

  // Backfill fixtures: registered as both a checkout session (what
  // stripe.checkout.sessions.list scans) and a payment intent (what the
  // resolved session's payment_intent points at) -- matchedSession and
  // sponsorshipSession carry `project: 'openg7'` metadata so the backfill
  // script's project match succeeds; unmatchedSession deliberately omits it.
  await registerStripePaymentIntent({
    id: BACKFILL_FIXTURES.matchedSession.stripePaymentIntentId,
    amount: BACKFILL_FIXTURES.matchedSession.amountCents,
    chargeId: BACKFILL_FIXTURES.matchedSession.stripeChargeId,
    balanceTransactionId:
      BACKFILL_FIXTURES.matchedSession.stripeBalanceTransactionId,
    fee: BACKFILL_FIXTURES.matchedSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: BACKFILL_FIXTURES.matchedSession.stripeSessionId,
    paymentIntentId: BACKFILL_FIXTURES.matchedSession.stripePaymentIntentId,
    amountTotal: BACKFILL_FIXTURES.matchedSession.amountCents,
    customerEmail: BACKFILL_FIXTURES.matchedSession.contactEmail,
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'personal_support',
      publicReference: BACKFILL_FIXTURES.matchedSession.publicReference,
      nonCharityAcknowledged: 'true'
    }
  });

  await registerStripePaymentIntent({
    id: BACKFILL_FIXTURES.unmatchedSession.stripePaymentIntentId,
    amount: BACKFILL_FIXTURES.unmatchedSession.amountCents,
    chargeId: BACKFILL_FIXTURES.unmatchedSession.stripeChargeId,
    balanceTransactionId:
      BACKFILL_FIXTURES.unmatchedSession.stripeBalanceTransactionId,
    fee: BACKFILL_FIXTURES.unmatchedSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: BACKFILL_FIXTURES.unmatchedSession.stripeSessionId,
    paymentIntentId: BACKFILL_FIXTURES.unmatchedSession.stripePaymentIntentId,
    amountTotal: BACKFILL_FIXTURES.unmatchedSession.amountCents,
    metadata: {
      project: 'some-other-project',
      contributionType: 'personal_support'
    }
  });

  await registerStripePaymentIntent({
    id: BACKFILL_FIXTURES.sponsorshipSession.stripePaymentIntentId,
    amount: BACKFILL_FIXTURES.sponsorshipSession.amountCents,
    chargeId: BACKFILL_FIXTURES.sponsorshipSession.stripeChargeId,
    balanceTransactionId:
      BACKFILL_FIXTURES.sponsorshipSession.stripeBalanceTransactionId,
    fee: BACKFILL_FIXTURES.sponsorshipSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: BACKFILL_FIXTURES.sponsorshipSession.stripeSessionId,
    paymentIntentId: BACKFILL_FIXTURES.sponsorshipSession.stripePaymentIntentId,
    amountTotal: BACKFILL_FIXTURES.sponsorshipSession.amountCents,
    customerEmail: BACKFILL_FIXTURES.sponsorshipSession.contactEmail,
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'sponsorship_interest',
      publicReference: BACKFILL_FIXTURES.sponsorshipSession.publicReference,
      nonCharityAcknowledged: 'true'
    }
  });
};

try {
  await seedStripeStub();
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
