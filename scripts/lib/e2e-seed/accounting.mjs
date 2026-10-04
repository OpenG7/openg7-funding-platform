import { sqlLiteral } from './sql.mjs';

/** Build fixture-owned accounting SQL without accessing any external service. */
export const buildAccountingSeedFragments = ({
  webhookFixtures,
  accountingFixtures,
  backfillFixtures,
  emailQueueFixture
}) => {
  const allWebhookFixtures = Object.values(webhookFixtures);
  // The Checkout webhooks create these rows themselves, so pre-seeding them
  // would collide with fund_contributions' unique public_reference.
  const webhookPendingFixtures = allWebhookFixtures.filter(
    (fixture) => fixture !== webhookFixtures.replaySponsorship
  );
  const accountingPendingFixtures = [
    accountingFixtures.scenario,
    accountingFixtures.excludedFailed,
    accountingFixtures.fullyRefunded
  ];

  // Clear every delivered event across runs; within a run, the webhook's own
  // idempotency still handles duplicate and out-of-order deliveries.
  const allFixtureStripeEventIds = [
    ...allWebhookFixtures.flatMap((fixture) =>
      [
        fixture.stripeEventId,
        fixture.stripeEventIdSucceeded,
        fixture.stripeEventIdUpdated,
        fixture.stripeEventIdFirst,
        fixture.stripeEventIdResend
      ].filter(Boolean)
    ),
    ...[
      accountingFixtures.scenario,
      accountingFixtures.excludedFailed,
      accountingFixtures.excludedExpired,
      accountingFixtures.fullyRefunded
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

  // Backfill writes synthetic event ids, so those rows are selected by object,
  // session and public reference rather than by delivered webhook event id.
  const backfillObjectIds = [
    backfillFixtures.matchedSession.stripePaymentIntentId,
    backfillFixtures.unmatchedSession.stripePaymentIntentId,
    backfillFixtures.sponsorshipSession.stripePaymentIntentId
  ];
  const backfillSessionIds = [
    backfillFixtures.matchedSession.stripeSessionId,
    backfillFixtures.unmatchedSession.stripeSessionId,
    backfillFixtures.sponsorshipSession.stripeSessionId,
    webhookFixtures.replaySponsorship.stripeSessionId,
    accountingFixtures.excludedExpired.stripeSessionId
  ];
  const backfillContributionRefs = [
    backfillFixtures.matchedSession.publicReference,
    backfillFixtures.sponsorshipSession.publicReference
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

  // The coordinator adds sponsorship fixtures before building publication
  // cleanup, which must run before contribution/media cascades.
  const publicationFixtures = [
    ...allWebhookFixtures,
    ...accountingPendingFixtures,
    accountingFixtures.excludedExpired,
    ...backfillContributionRefs.map((publicReference) => ({ publicReference }))
  ];

  const emailQueueDelete = `
DELETE FROM email_messages
WHERE idempotency_key = ${sqlLiteral(emailQueueFixture.idempotencyKey)};`;
  // Keep the message queued until the retry endpoint moves its attempt to NOW().
  const emailQueueInsert = `
INSERT INTO email_messages (
  idempotency_key, template_key, recipient_email, from_email, subject,
  text_body, html_body, status, next_attempt_at
) VALUES (
  ${sqlLiteral(emailQueueFixture.idempotencyKey)},
  ${sqlLiteral(emailQueueFixture.templateKey)},
  ${sqlLiteral(emailQueueFixture.recipientEmail)},
  ${sqlLiteral(emailQueueFixture.fromEmail)},
  ${sqlLiteral(emailQueueFixture.subject)},
  ${sqlLiteral(emailQueueFixture.textBody)},
  ${sqlLiteral(emailQueueFixture.htmlBody)},
  'queued',
  NOW() + INTERVAL '1 day'
);`;

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

  const webhookFixtureDeletes = allWebhookFixtures
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
  // expired is cleanup-only: checkout.session.expired creates its contribution.
  const accountingExpiredDelete = webhookContributionDelete(
    accountingFixtures.excludedExpired
  );

  const accountingExpenseDelete = `
DELETE FROM fund_allocations
WHERE project_name = ${sqlLiteral(accountingFixtures.scenario.expenseName)};`;
  const accountingExpenseInsert = `
INSERT INTO fund_allocations (
  project_name, public_description, amount_allocated, currency, status, published_at
) VALUES (
  ${sqlLiteral(accountingFixtures.scenario.expenseName)},
  'E2E Playwright: depense de test pour le scenario comptable.',
  ${accountingFixtures.scenario.expenseAmountCents}, 'cad', 'published', NOW()
);`;

  // The transparency read path switches to ledger totals as soon as one row
  // exists. This permanent, negligible row keeps fresh and repeated runs alike.
  // No cleanup fragment selects it.
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

  return {
    emailQueueDelete,
    emailQueueInsert,
    webhookFixtureDeletes,
    webhookFixtureInserts,
    accountingPendingDeletes,
    accountingPendingInserts,
    accountingExpiredDelete,
    accountingExpenseDelete,
    accountingExpenseInsert,
    fundTransactionsByEventDelete,
    fundTransactionsByObjectDelete,
    stripeEventsDelete,
    stripeCheckoutSessionsDelete,
    backfillContributionsDelete,
    ledgerSentinelInsert,
    publicationFixtures
  };
};
