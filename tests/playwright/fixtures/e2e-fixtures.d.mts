// Generated from e2e-fixtures.mjs using TypeScript declaration emit.
// Regenerate when fixture exports change; do not narrow this list by hand.
export const ADMIN_TOKEN: 'local-playwright-admin-token';
export const SPONSORSHIP_FIXTURES: Readonly<{
  acceptanceReview: Readonly<{
    publicReference: 'OG7-E2E-ACCEPTANCE';
    companyName: 'E2E Acceptance Atelier Nord Inc.';
    contactName: 'E2E Acceptance';
    contactEmail: 'acceptance@example.invalid';
    websiteUrl: 'https://example.invalid/acceptance';
    followupToken: 'e2e-acceptance-followup-token-local-only-000000';
    amountCents: 50000;
    reviewStatus: 'pending_review';
    stripeSessionId: 'cs_e2e_acceptance_review';
  }>;
  approve: Readonly<{
    publicReference: 'OG7-E2E-APPROVE';
    companyName: 'E2E Playwright Fixture Approve Inc.';
    contactName: 'E2E Playwright Approve';
    contactEmail: 'e2e-playwright-fixture-approve@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-approve';
    followupToken: 'e2e-playwright-fixture-followup-token-approve-000000';
    amountCents: 50000;
    reviewStatus: 'pending_review';
    stripeSessionId: 'cs_e2e_playwright_fixture_approve_000000';
  }>;
  reject: Readonly<{
    publicReference: 'OG7-E2E-REJECT';
    companyName: 'E2E Playwright Fixture Reject Inc.';
    contactName: 'E2E Playwright Reject';
    contactEmail: 'e2e-playwright-fixture-reject@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-reject';
    followupToken: 'e2e-playwright-fixture-followup-token-reject-0000000';
    amountCents: 25000;
    reviewStatus: 'pending_review';
  }>;
  directory: Readonly<{
    publicReference: 'OG7-E2E-DIRECTORY';
    companyName: 'E2E Playwright Fixture Directory Inc.';
    contactName: 'E2E Playwright Directory';
    contactEmail: 'e2e-playwright-fixture-directory@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-directory';
    followupToken: 'e2e-playwright-fixture-followup-token-directory-00000';
    amountCents: 50000;
    reviewStatus: 'approved';
  }>;
  followupEditing: Readonly<{
    publicReference: 'OG7-E2E-FOLLOWUP-EDIT';
    companyName: 'E2E Followup Editing Inc.';
    contactName: 'E2E Followup Editing';
    contactEmail: 'followup-editing@example.invalid';
    websiteUrl: 'https://example.invalid/followup-editing';
    followupToken: 'e2e-followup-editing-local-only-token-00000000';
    amountCents: 50000;
    reviewStatus: 'approved';
  }>;
  refund: Readonly<{
    publicReference: 'OG7-E2E-REFUND';
    companyName: 'E2E Playwright Fixture Refund Inc.';
    contactName: 'E2E Playwright Refund';
    contactEmail: 'e2e-playwright-fixture-refund@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-refund';
    followupToken: 'e2e-playwright-fixture-followup-token-refund-0000000';
    amountCents: 75000;
    reviewStatus: 'approved';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_refund_000000';
    stripeSessionId: 'cs_e2e_playwright_fixture_refund_000000';
  }>;
  partialRefund: Readonly<{
    publicReference: 'OG7-E2E-PARTIAL-REFUND';
    companyName: 'E2E Playwright Fixture Partial Refund Inc.';
    contactName: 'E2E Playwright Partial Refund';
    contactEmail: 'e2e-playwright-fixture-partial-refund@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-partial-refund';
    followupToken: 'e2e-playwright-fixture-followup-token-partial-refund-0';
    amountCents: 100000;
    reviewStatus: 'approved';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_partial_refund_00000';
    stripeSessionId: 'cs_e2e_playwright_fixture_partial_refund_00000';
  }>;
  rejectRefund: Readonly<{
    publicReference: 'OG7-E2E-REJECT-REFUND';
    companyName: 'E2E Playwright Fixture Reject Refund Inc.';
    contactName: 'E2E Playwright Reject Refund';
    contactEmail: 'e2e-playwright-fixture-reject-refund@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-reject-refund';
    followupToken: 'e2e-playwright-fixture-followup-token-reject-refund-0';
    amountCents: 40000;
    reviewStatus: 'pending_review';
  }>;
  logo: Readonly<{
    publicReference: 'OG7-E2E-LOGO';
    companyName: 'E2E Playwright Fixture Logo Inc.';
    contactName: 'E2E Playwright Logo';
    contactEmail: 'e2e-playwright-fixture-logo@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-logo';
    followupToken: 'e2e-playwright-fixture-followup-token-logo-000000000';
    amountCents: 50000;
    reviewStatus: 'pending_review';
  }>;
  publicationBatch: Readonly<{
    publicReference: 'OG7-E2E-PUBLICATION-BATCH';
    companyName: 'E2E Playwright Fixture Publication Batch Inc.';
    contactName: 'E2E Playwright Publication Batch';
    contactEmail: 'e2e-playwright-fixture-publication-batch@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-publication-batch';
    followupToken: 'e2e-playwright-fixture-followup-token-publication-batch';
    amountCents: 50000;
    reviewStatus: 'approved';
    feedTarget: 'openg7';
    feedChannels: string[];
  }>;
  multiPartialRefund: Readonly<{
    publicReference: 'OG7-E2E-MULTI-PARTIAL-REFUND';
    companyName: 'E2E Playwright Fixture Multi Partial Refund Inc.';
    contactName: 'E2E Playwright Multi Partial Refund';
    contactEmail: 'e2e-playwright-fixture-multi-partial-refund@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-multi-partial-refund';
    followupToken: 'e2e-playwright-fixture-followup-token-multi-partial-refund-0';
    amountCents: 100000;
    reviewStatus: 'rejected';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_multi_partial_refund';
    stripeSessionId: 'cs_e2e_playwright_fixture_multi_partial_refund';
  }>;
  concurrentRefund: Readonly<{
    publicReference: 'OG7-E2E-CONCURRENT-REFUND';
    companyName: 'E2E Playwright Fixture Concurrent Refund Inc.';
    contactName: 'E2E Playwright Concurrent Refund';
    contactEmail: 'e2e-playwright-fixture-concurrent-refund@example.com';
    websiteUrl: 'https://example.com/e2e-playwright-fixture-concurrent-refund';
    followupToken: 'e2e-playwright-fixture-followup-token-concurrent-refund';
    amountCents: 60000;
    reviewStatus: 'rejected';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_concurrent_refund';
    stripeSessionId: 'cs_e2e_playwright_fixture_concurrent_refund';
  }>;
}>;
export const STRIPE_TEST_SECRET_KEY: 'sk_test_e2e_playwright_stub_000000000000000000000000';
export const STRIPE_TEST_WEBHOOK_SECRET: 'whsec_e2e_playwright_stub_test_secret_00000000000000';
export const WEBHOOK_FIXTURES: Readonly<{
  idempotence: Readonly<{
    publicReference: 'OG7-E2E-WEBHOOK-IDEMPOTENCE';
    contactEmail: 'e2e-playwright-fixture-webhook-idempotence@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_idempotence';
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_idempotence';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_webhook_idempotence';
    stripeEventId: 'evt_e2e_playwright_fixture_webhook_idempotence';
    amountCents: 5000;
    feeCents: 175;
  }>;
  checkoutAuthoritative: Readonly<{
    publicReference: 'OG7-E2E-WEBHOOK-CHECKOUT-AUTH';
    contactEmail: 'e2e-playwright-fixture-webhook-checkout-auth@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_checkout_auth';
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_checkout_auth';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_webhook_checkout_auth';
    stripeEventId: 'evt_e2e_playwright_fixture_webhook_checkout_auth';
    amountCents: 2500;
    feeCents: 105;
  }>;
  feeBackfill: Readonly<{
    publicReference: 'OG7-E2E-WEBHOOK-FEE-BACKFILL';
    contactEmail: 'e2e-playwright-fixture-webhook-fee-backfill@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_fee_backfill';
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_fee_backfill';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_webhook_fee_backfill';
    stripeEventIdSucceeded: 'evt_e2e_playwright_fixture_webhook_fee_succeeded';
    stripeEventIdUpdated: 'evt_e2e_playwright_fixture_webhook_fee_updated';
    amountCents: 8000;
    initialFeeCents: 300;
    correctedFeeCents: 260;
  }>;
  outOfOrder: Readonly<{
    publicReference: 'OG7-E2E-WEBHOOK-OUT-OF-ORDER';
    contactEmail: 'e2e-playwright-fixture-webhook-out-of-order@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_out_of_order';
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_out_of_order';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_webhook_out_of_order';
    stripeEventIdUpdated: 'evt_e2e_playwright_fixture_webhook_order_updated';
    stripeEventIdSucceeded: 'evt_e2e_playwright_fixture_webhook_order_succeeded';
    amountCents: 6000;
    feeCents: 210;
  }>;
  replaySponsorship: Readonly<{
    stripeSessionId: 'cs_e2e_playwright_fixture_webhook_replay';
    stripeEventIdFirst: 'evt_e2e_playwright_fixture_webhook_replay_a';
    stripeEventIdResend: 'evt_e2e_playwright_fixture_webhook_replay_b';
    publicReference: 'OG7-2026-REPLAY1';
    followupToken: 'e2e-playwright-fixture-followup-token-webhook-replay-0';
    contactEmail: 'e2e-playwright-fixture-webhook-replay@example.com';
    amountCents: 50000;
  }>;
}>;
export const BACKFILL_FIXTURES: Readonly<{
  matchedSession: Readonly<{
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_matched';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_matched';
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_matched';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_backfill_matched';
    publicReference: 'OG7-2026-BKFILL1';
    contactEmail: 'e2e-playwright-fixture-backfill-matched@example.com';
    amountCents: 12000;
    feeCents: 400;
  }>;
  unmatchedSession: Readonly<{
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_unmatched';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_unmatched';
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_unmatched';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_backfill_unmatched';
    amountCents: 9000;
    feeCents: 300;
  }>;
  sponsorshipSession: Readonly<{
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_sponsor';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_sponsor';
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_sponsor';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_backfill_sponsor';
    publicReference: 'OG7-2026-BKFILL2';
    contactEmail: 'e2e-playwright-fixture-backfill-sponsor@example.com';
    amountCents: 75000;
    feeCents: 2200;
  }>;
}>;
export const ACCOUNTING_FIXTURES: Readonly<{
  scenario: Readonly<{
    publicReference: 'OG7-E2E-ACCOUNTING-SCENARIO';
    contactEmail: 'e2e-playwright-fixture-accounting-scenario@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_scenario';
    stripeChargeId: 'ch_e2e_playwright_fixture_accounting_scenario';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_accounting_scenario';
    stripeEventIdSucceeded: 'evt_e2e_playwright_fixture_accounting_succeeded';
    stripeEventIdRefunded: 'evt_e2e_playwright_fixture_accounting_refunded';
    stripeRefundId: 're_e2e_playwright_fixture_accounting_refund';
    stripeRefundBalanceTransactionId: 'txn_e2e_playwright_fixture_accounting_refund';
    amountCents: 10000;
    feeCents: 320;
    partialRefundCents: 2000;
    expenseName: 'E2E Playwright Fixture Accounting Expense';
    expenseAmountCents: 1500;
  }>;
  excludedFailed: Readonly<{
    publicReference: 'OG7-E2E-ACCOUNTING-FAILED';
    contactEmail: 'e2e-playwright-fixture-accounting-failed@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_failed';
    stripeEventId: 'evt_e2e_playwright_fixture_accounting_failed';
    amountCents: 4000;
  }>;
  excludedExpired: Readonly<{
    stripeSessionId: 'cs_e2e_playwright_fixture_accounting_expired';
    stripeEventId: 'evt_e2e_playwright_fixture_accounting_expired';
    publicReference: 'OG7-2026-ACCTEXP1';
    contactEmail: 'e2e-playwright-fixture-accounting-expired@example.com';
    amountCents: 3000;
  }>;
  fullyRefunded: Readonly<{
    publicReference: 'OG7-E2E-ACCOUNTING-FULL-REFUND';
    contactEmail: 'e2e-playwright-fixture-accounting-full-refund@example.com';
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_full_refund';
    stripeChargeId: 'ch_e2e_playwright_fixture_accounting_full_refund';
    stripeBalanceTransactionId: 'txn_e2e_playwright_fixture_accounting_full_refund';
    stripeEventIdSucceeded: 'evt_e2e_playwright_fixture_accounting_full_refund_a';
    stripeEventIdRefunded: 'evt_e2e_playwright_fixture_accounting_full_refund_b';
    stripeRefundId: 're_e2e_playwright_fixture_accounting_full_refund';
    stripeRefundBalanceTransactionId: 'txn_e2e_playwright_fixture_accounting_full_refund_r';
    amountCents: 6000;
    feeCents: 200;
  }>;
}>;
export const EMAIL_QUEUE_FIXTURE: Readonly<{
  idempotencyKey: 'e2e-playwright-fixture-email-queue-retry';
  templateKey: 'e2e_playwright_fixture';
  recipientEmail: 'e2e-playwright-fixture-email-queue@example.com';
  fromEmail: 'no-reply@example.com';
  subject: 'E2E Playwright: message de test pour la relance de la file courriel.';
  textBody: 'E2E Playwright fixture email body (text).';
  htmlBody: '<p>E2E Playwright fixture email body (html).</p>';
}>;
