// Shared between scripts/e2e-seed.mjs, scripts/playwright-docker-up.mjs and the
// Playwright specs so the seeded database rows and the browser assertions never
// drift out of sync.

export const ADMIN_TOKEN = 'local-playwright-admin-token';

export const SPONSORSHIP_FIXTURES = Object.freeze({
  approve: Object.freeze({
    publicReference: 'OG7-E2E-APPROVE',
    companyName: 'E2E Playwright Fixture Approve Inc.',
    contactName: 'E2E Playwright Approve',
    contactEmail: 'e2e-playwright-fixture-approve@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-approve',
    followupToken: 'e2e-playwright-fixture-followup-token-approve-000000',
    amountCents: 50000,
    reviewStatus: 'pending_review',
    // Needed for the admin invoices backfill query, which only picks up
    // contributions with a non-null stripe_session_id.
    stripeSessionId: 'cs_e2e_playwright_fixture_approve_000000'
  }),
  reject: Object.freeze({
    publicReference: 'OG7-E2E-REJECT',
    companyName: 'E2E Playwright Fixture Reject Inc.',
    contactName: 'E2E Playwright Reject',
    contactEmail: 'e2e-playwright-fixture-reject@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-reject',
    followupToken: 'e2e-playwright-fixture-followup-token-reject-0000000',
    amountCents: 25000,
    reviewStatus: 'pending_review'
  }),
  // Seeded already approved (rather than approved via the admin UI, like the
  // two fixtures above) so the public sponsor-navigation spec can assert on
  // the post-approval follow-up page and the /commanditaires directory
  // without depending on another spec file running first.
  directory: Object.freeze({
    publicReference: 'OG7-E2E-DIRECTORY',
    companyName: 'E2E Playwright Fixture Directory Inc.',
    contactName: 'E2E Playwright Directory',
    contactEmail: 'e2e-playwright-fixture-directory@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-directory',
    followupToken: 'e2e-playwright-fixture-followup-token-directory-00000',
    amountCents: 50000,
    reviewStatus: 'approved'
  }),
  // Seeded already approved with a fake Stripe payment intent id so the
  // admin refund spec can exercise the refund -> credit note -> email
  // pipeline against the dev-mode refund mock (no real Stripe call).
  refund: Object.freeze({
    publicReference: 'OG7-E2E-REFUND',
    companyName: 'E2E Playwright Fixture Refund Inc.',
    contactName: 'E2E Playwright Refund',
    contactEmail: 'e2e-playwright-fixture-refund@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-refund',
    followupToken: 'e2e-playwright-fixture-followup-token-refund-0000000',
    amountCents: 75000,
    reviewStatus: 'approved',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_refund_000000',
    stripeSessionId: 'cs_e2e_playwright_fixture_refund_000000'
  }),
  // Separate fixture from `refund` so the partial-refund spec doesn't collide
  // with the full-refund spec's own mutation of the same row.
  partialRefund: Object.freeze({
    publicReference: 'OG7-E2E-PARTIAL-REFUND',
    companyName: 'E2E Playwright Fixture Partial Refund Inc.',
    contactName: 'E2E Playwright Partial Refund',
    contactEmail: 'e2e-playwright-fixture-partial-refund@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-partial-refund',
    followupToken: 'e2e-playwright-fixture-followup-token-partial-refund-0',
    amountCents: 100000,
    reviewStatus: 'approved',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_partial_refund_00000',
    stripeSessionId: 'cs_e2e_playwright_fixture_partial_refund_00000'
  }),
  // Covers the rejection panel's own refund handling (manual_required /
  // manual_completed), a DB-only flag distinct from the Stripe-guided refund
  // panel -- no Stripe payment intent needed.
  rejectRefund: Object.freeze({
    publicReference: 'OG7-E2E-REJECT-REFUND',
    companyName: 'E2E Playwright Fixture Reject Refund Inc.',
    contactName: 'E2E Playwright Reject Refund',
    contactEmail: 'e2e-playwright-fixture-reject-refund@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-reject-refund',
    followupToken: 'e2e-playwright-fixture-followup-token-reject-refund-0',
    amountCents: 40000,
    reviewStatus: 'pending_review'
  }),
  logo: Object.freeze({
    publicReference: 'OG7-E2E-LOGO',
    companyName: 'E2E Playwright Fixture Logo Inc.',
    contactName: 'E2E Playwright Logo',
    contactEmail: 'e2e-playwright-fixture-logo@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-logo',
    followupToken: 'e2e-playwright-fixture-followup-token-logo-000000000',
    amountCents: 50000,
    reviewStatus: 'pending_review'
  }),
  // Seeded already approved with a feed target/channel already set (as if an
  // admin had already saved the per-sponsor feed placement), so the
  // publication batch spec can create a draft immediately instead of
  // depending on admin-sponsorship-publication.spec.ts having run first.
  publicationBatch: Object.freeze({
    publicReference: 'OG7-E2E-PUBLICATION-BATCH',
    companyName: 'E2E Playwright Fixture Publication Batch Inc.',
    contactName: 'E2E Playwright Publication Batch',
    contactEmail: 'e2e-playwright-fixture-publication-batch@example.com',
    websiteUrl: 'https://example.com/e2e-playwright-fixture-publication-batch',
    followupToken: 'e2e-playwright-fixture-followup-token-publication-batch',
    amountCents: 50000,
    reviewStatus: 'approved',
    feedTarget: 'openg7',
    feedChannels: ['facebook']
  }),
  // Backs admin-refund-integrity.spec.ts (test 90): a large-enough amount
  // that two partial refunds can each pass the single-request cap
  // (amount <= amountCents) while their sum still overflows it, which is
  // exactly the case the Stripe stub's cumulative-refund guard exists to
  // catch (see tests/stripe-stub/server.mjs).
  //
  // reviewStatus is 'rejected' rather than 'approved' on purpose: the
  // refund route only cares about payment status (getSponsorshipRefundTarget
  // in fund-contributions.repository.ts filters on `status`, never
  // `sponsor_review_status`), and admin-publications-page.component.ts's
  // default sort ranks pending_review, then approved, before everything
  // else with only a 6-item page 1 -- an 'approved' fixture here would
  // compete with admin-publication-batches.spec.ts's own fixture for one of
  // those slots. 'rejected' sorts last and stays out of the way.
  multiPartialRefund: Object.freeze({
    publicReference: 'OG7-E2E-MULTI-PARTIAL-REFUND',
    companyName: 'E2E Playwright Fixture Multi Partial Refund Inc.',
    contactName: 'E2E Playwright Multi Partial Refund',
    contactEmail: 'e2e-playwright-fixture-multi-partial-refund@example.com',
    websiteUrl:
      'https://example.com/e2e-playwright-fixture-multi-partial-refund',
    followupToken:
      'e2e-playwright-fixture-followup-token-multi-partial-refund-0',
    amountCents: 100000,
    reviewStatus: 'rejected',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_multi_partial_refund',
    stripeSessionId: 'cs_e2e_playwright_fixture_multi_partial_refund'
  }),
  // Backs admin-refund-integrity.spec.ts (test 91): kept separate from every
  // other refund fixture so two "admins" (two API requests carrying the same
  // captured version) racing each other never collides with an unrelated
  // spec's own mutation of the row. reviewStatus is 'rejected' for the same
  // page-1-ranking reason as multiPartialRefund above.
  concurrentRefund: Object.freeze({
    publicReference: 'OG7-E2E-CONCURRENT-REFUND',
    companyName: 'E2E Playwright Fixture Concurrent Refund Inc.',
    contactName: 'E2E Playwright Concurrent Refund',
    contactEmail: 'e2e-playwright-fixture-concurrent-refund@example.com',
    websiteUrl:
      'https://example.com/e2e-playwright-fixture-concurrent-refund',
    followupToken: 'e2e-playwright-fixture-followup-token-concurrent-refund',
    amountCents: 60000,
    reviewStatus: 'rejected',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_concurrent_refund',
    stripeSessionId: 'cs_e2e_playwright_fixture_concurrent_refund'
  })
});

// --- Stripe API stub (tests/stripe-stub/) -----------------------------
// Shared between scripts/playwright-docker-up.mjs (env vars for the `api`
// container) and tests/playwright/support/stripe-webhook.ts (signs requests
// with the same webhook secret). Neither value is a real Stripe credential:
// STRIPE_SECRET_KEY only has to be non-empty to make apps/funding-api/src
// construct a Stripe client (main.ts:293), and that client is itself pointed
// at the local stub via STRIPE_API_HOST rather than api.stripe.com.
export const STRIPE_TEST_SECRET_KEY =
  'sk_test_e2e_playwright_stub_000000000000000000000000';
export const STRIPE_TEST_WEBHOOK_SECRET =
  'whsec_e2e_playwright_stub_test_secret_00000000000000';

// Payment-intent/charge/balance-transaction fixtures registered with the
// Stripe stub (scripts/e2e-seed.mjs) and, where noted, a matching
// fund_contributions row seeded directly in Postgres -- the same
// division of labour real production has: Stripe is the source of truth
// for money movement, Postgres is populated by webhook delivery.
export const WEBHOOK_FIXTURES = Object.freeze({
  // Test 79: exact duplicate delivery of the same payment_intent.succeeded
  // event id must only ever produce one paid contribution / one ledger row.
  idempotence: Object.freeze({
    publicReference: 'OG7-E2E-WEBHOOK-IDEMPOTENCE',
    contactEmail: 'e2e-playwright-fixture-webhook-idempotence@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_idempotence',
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_idempotence',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_webhook_idempotence',
    stripeEventId: 'evt_e2e_playwright_fixture_webhook_idempotence',
    amountCents: 5000,
    feeCents: 175
  }),
  // Test 80: a `?checkout=success` browser return must stay non-authoritative
  // until this fixture's payment_intent.succeeded webhook is actually
  // delivered.
  checkoutAuthoritative: Object.freeze({
    publicReference: 'OG7-E2E-WEBHOOK-CHECKOUT-AUTH',
    contactEmail: 'e2e-playwright-fixture-webhook-checkout-auth@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_checkout_auth',
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_checkout_auth',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_webhook_checkout_auth',
    stripeEventId: 'evt_e2e_playwright_fixture_webhook_checkout_auth',
    amountCents: 2500,
    feeCents: 105
  }),
  // Test 81: charge.updated arriving after Stripe corrects the balance
  // transaction's fee must update the existing ledger row in place, never
  // insert a second one.
  feeBackfill: Object.freeze({
    publicReference: 'OG7-E2E-WEBHOOK-FEE-BACKFILL',
    contactEmail: 'e2e-playwright-fixture-webhook-fee-backfill@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_fee_backfill',
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_fee_backfill',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_webhook_fee_backfill',
    stripeEventIdSucceeded:
      'evt_e2e_playwright_fixture_webhook_fee_succeeded',
    stripeEventIdUpdated: 'evt_e2e_playwright_fixture_webhook_fee_updated',
    amountCents: 8000,
    initialFeeCents: 300,
    correctedFeeCents: 260
  }),
  // Test 82: charge.updated delivered before payment_intent.succeeded must
  // converge to the same final state as the normal delivery order.
  outOfOrder: Object.freeze({
    publicReference: 'OG7-E2E-WEBHOOK-OUT-OF-ORDER',
    contactEmail: 'e2e-playwright-fixture-webhook-out-of-order@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_webhook_out_of_order',
    stripeChargeId: 'ch_e2e_playwright_fixture_webhook_out_of_order',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_webhook_out_of_order',
    stripeEventIdUpdated: 'evt_e2e_playwright_fixture_webhook_order_updated',
    stripeEventIdSucceeded:
      'evt_e2e_playwright_fixture_webhook_order_succeeded',
    amountCents: 6000,
    feeCents: 210
  }),
  // Test 83: simulates Stripe's own "resend event" feature -- a second,
  // *different* event id describing the same checkout session -- to prove
  // idempotency covers the session-keyed side effects (invoice, follow-up
  // email), not just the top-level stripe_events gate on event.id.
  replaySponsorship: Object.freeze({
    stripeSessionId: 'cs_e2e_playwright_fixture_webhook_replay',
    stripeEventIdFirst: 'evt_e2e_playwright_fixture_webhook_replay_a',
    stripeEventIdResend: 'evt_e2e_playwright_fixture_webhook_replay_b',
    publicReference: 'OG7-2026-REPLAY1',
    followupToken: 'e2e-playwright-fixture-followup-token-webhook-replay-0',
    contactEmail: 'e2e-playwright-fixture-webhook-replay@example.com',
    amountCents: 50000
  })
});

// Stripe stub fixtures for stripe-backfill-reconciliation.spec.ts (tests
// 84-86). Deliberately have NO seeded fund_contributions/fund_transactions
// row -- the whole point is proving the backfill script (re)creates them
// from Stripe alone, the way it would for payments that predate PostgreSQL
// being enabled.
export const BACKFILL_FIXTURES = Object.freeze({
  // Test 84: a Stripe payment with project metadata but no local row yet.
  matchedSession: Object.freeze({
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_matched',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_matched',
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_matched',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_backfill_matched',
    publicReference: 'OG7-2026-BKFILL1',
    contactEmail: 'e2e-playwright-fixture-backfill-matched@example.com',
    amountCents: 12000,
    feeCents: 400
  }),
  // Test 85: a Stripe payment with no matching project metadata -- backfill
  // must report it as scanned-but-unmatched rather than importing it.
  unmatchedSession: Object.freeze({
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_unmatched',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_unmatched',
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_unmatched',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_backfill_unmatched',
    amountCents: 9000,
    feeCents: 300
  }),
  // Test 86: a sponsorship checkout session restored by backfill -- must
  // never queue the follow-up/invoice emails the live webhook path sends.
  sponsorshipSession: Object.freeze({
    stripeSessionId: 'cs_e2e_playwright_fixture_backfill_sponsor',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_backfill_sponsor',
    stripeChargeId: 'ch_e2e_playwright_fixture_backfill_sponsor',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_backfill_sponsor',
    publicReference: 'OG7-2026-BKFILL2',
    contactEmail: 'e2e-playwright-fixture-backfill-sponsor@example.com',
    amountCents: 75000,
    feeCents: 2200
  })
});

// Backs funding-accounting-integrity.spec.ts (tests 87-89): one full
// gross/fee/refund/expense scenario plus two excluded-status contributions.
export const ACCOUNTING_FIXTURES = Object.freeze({
  scenario: Object.freeze({
    publicReference: 'OG7-E2E-ACCOUNTING-SCENARIO',
    contactEmail: 'e2e-playwright-fixture-accounting-scenario@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_scenario',
    stripeChargeId: 'ch_e2e_playwright_fixture_accounting_scenario',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_accounting_scenario',
    stripeEventIdSucceeded:
      'evt_e2e_playwright_fixture_accounting_succeeded',
    stripeEventIdRefunded: 'evt_e2e_playwright_fixture_accounting_refunded',
    stripeRefundId: 're_e2e_playwright_fixture_accounting_refund',
    stripeRefundBalanceTransactionId:
      'txn_e2e_playwright_fixture_accounting_refund',
    amountCents: 10000,
    feeCents: 320,
    partialRefundCents: 2000,
    expenseName: 'E2E Playwright Fixture Accounting Expense',
    expenseAmountCents: 1500
  }),
  // Test 89: driven to a terminal excluded status by a real webhook within
  // the test itself (payment_intent.payment_failed / checkout.session.expired
  // -- neither calls out to Stripe, see stripe-webhook.service.ts), so the
  // test can assert an exact before/after delta of zero rather than trying
  // to isolate a handful of fixture rows out of a shared, cumulative dev
  // database's aggregate totals.
  excludedFailed: Object.freeze({
    publicReference: 'OG7-E2E-ACCOUNTING-FAILED',
    contactEmail: 'e2e-playwright-fixture-accounting-failed@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_failed',
    stripeEventId: 'evt_e2e_playwright_fixture_accounting_failed',
    amountCents: 4000
  }),
  // No pre-seeded row: checkout.session.expired creates it from scratch via
  // upsertCheckoutSessionFromWebhook, same as the replaySponsorship fixture.
  excludedExpired: Object.freeze({
    stripeSessionId: 'cs_e2e_playwright_fixture_accounting_expired',
    stripeEventId: 'evt_e2e_playwright_fixture_accounting_expired',
    publicReference: 'OG7-2026-ACCTEXP1',
    contactEmail: 'e2e-playwright-fixture-accounting-expired@example.com',
    amountCents: 3000
  }),
  // Test 89's "fully refunded" case: included in gross total_received (the
  // ledger's double-entry design never hides gross history), netted to zero
  // in current_available_estimate. Kept separate from `scenario` (partial
  // refund) so the two don't interfere with each other's assertions.
  fullyRefunded: Object.freeze({
    publicReference: 'OG7-E2E-ACCOUNTING-FULL-REFUND',
    contactEmail: 'e2e-playwright-fixture-accounting-full-refund@example.com',
    stripePaymentIntentId: 'pi_e2e_playwright_fixture_accounting_full_refund',
    stripeChargeId: 'ch_e2e_playwright_fixture_accounting_full_refund',
    stripeBalanceTransactionId:
      'txn_e2e_playwright_fixture_accounting_full_refund',
    stripeEventIdSucceeded:
      'evt_e2e_playwright_fixture_accounting_full_refund_a',
    stripeEventIdRefunded:
      'evt_e2e_playwright_fixture_accounting_full_refund_b',
    stripeRefundId: 're_e2e_playwright_fixture_accounting_full_refund',
    stripeRefundBalanceTransactionId:
      'txn_e2e_playwright_fixture_accounting_full_refund_r',
    amountCents: 6000,
    feeCents: 200
  })
});

// Seeded directly into email_messages (rather than produced by an admin
// action, like every fund_contributions fixture above) so
// admin-email-queue.spec.ts has a deterministic, retryable row to click
// "Relancer" on. SMTP is disabled in local/CI (docker-compose.yml defaults
// SMTP_ENABLED to false), so retrying it always resolves the same way: the
// send is attempted and fails with EMAIL_DISABLED, leaving the message
// 'failed' rather than 'sent'.
export const EMAIL_QUEUE_FIXTURE = Object.freeze({
  idempotencyKey: 'e2e-playwright-fixture-email-queue-retry',
  templateKey: 'e2e_playwright_fixture',
  recipientEmail: 'e2e-playwright-fixture-email-queue@example.com',
  fromEmail: 'no-reply@example.com',
  subject: 'E2E Playwright: message de test pour la relance de la file courriel.',
  textBody: 'E2E Playwright fixture email body (text).',
  htmlBody: '<p>E2E Playwright fixture email body (html).</p>'
});
