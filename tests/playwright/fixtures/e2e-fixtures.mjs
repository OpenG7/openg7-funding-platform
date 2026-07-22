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
  })
});
