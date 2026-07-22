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
  })
});
