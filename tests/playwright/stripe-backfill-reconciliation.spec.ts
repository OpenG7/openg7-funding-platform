import { expect, test } from './support/test.js';

import { ADMIN_TOKEN, BACKFILL_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { runStripeBackfill } from './support/stripe-backfill-cli.js';

// Covers apps/funding-api/src/stripe-backfill.service.ts, the real
// (one-directional, Stripe -> Postgres) mechanism this codebase has for
// restoring payments that exist in Stripe but not yet locally -- e.g.
// because they were made before PostgreSQL was enabled. There is no
// bidirectional reconciliation feature in the codebase (only documented as
// a future intent in docs/ARCHITECTURE.md), so these tests exercise the
// backfill script's own scanned/matched/inserted/skipped counters rather
// than a ReconciliationRun API that doesn't exist.
//
// The Stripe stub (tests/stripe-stub/) is seeded with these sessions but
// deliberately has no corresponding fund_contributions/fund_transactions row
// -- that absence is the whole point of the scenario.

const findContributionByReference = async (
  request: import('@playwright/test').APIRequestContext,
  publicReference: string
) => {
  const response = await request.get('/api/admin/contributions', {
    headers: { 'x-funding-admin-token': ADMIN_TOKEN }
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return (body.contributions ?? []).filter(
    (contribution: { public_reference?: string }) =>
      contribution.public_reference === publicReference
  );
};

test.describe('Stripe backfill reconciliation', () => {
  test('reconciles a Stripe payment created before PostgreSQL was enabled', async ({
    request
  }) => {
    const fixture = BACKFILL_FIXTURES.matchedSession;

    const beforeRuns = await findContributionByReference(
      request,
      fixture.publicReference
    );

    runStripeBackfill();

    const afterFirstRun = await findContributionByReference(
      request,
      fixture.publicReference
    );
    expect(afterFirstRun).toHaveLength(1);
    expect(afterFirstRun[0].amount_cents ?? afterFirstRun[0].amount).toBeTruthy();

    // Re-running backfill (e.g. the operator running it again, or a
    // scheduled rerun) must not duplicate the contribution or its ledger
    // transaction -- hasLogicalFundTransaction / the synthetic
    // stripe-backfill:<type>:<objectId> event id both guard against that.
    runStripeBackfill();

    const afterSecondRun = await findContributionByReference(
      request,
      fixture.publicReference
    );
    expect(afterSecondRun).toHaveLength(1);
    expect(afterSecondRun[0].id).toBe(afterFirstRun[0].id);

    expect(beforeRuns).toHaveLength(0);
  });

  test('distinguishes project-matched Stripe sessions from unmatched ones during a scan', async () => {
    // includeUnmatched defaults to false (matches the CLI's own default),
    // so backfill's own summary is the only signal for "this Stripe payment
    // exists but doesn't belong to this project" versus "this one does and
    // was imported" -- the closest real equivalent to a missing/orphaned
    // distinction, since there is no bidirectional reconciliation report.
    const summary = runStripeBackfill(['--dry-run']);

    expect(summary.checkoutSessions.scanned).toBeGreaterThanOrEqual(3);
    // matchedSession and sponsorshipSession both carry project: 'openg7'.
    expect(summary.checkoutSessions.matched).toBeGreaterThanOrEqual(2);
    // unmatchedSession carries a different project id.
    expect(summary.checkoutSessions.skippedUnmatched).toBeGreaterThanOrEqual(
      1
    );
  });

  test('restores a missing sponsorship transaction without sending duplicate sponsor emails or invoices', async ({
    request
  }) => {
    const fixture = BACKFILL_FIXTURES.sponsorshipSession;

    runStripeBackfill();

    const contributions = await findContributionByReference(
      request,
      fixture.publicReference
    );
    expect(contributions).toHaveLength(1);

    // Backfill only writes fund_contributions/fund_transactions
    // (backfillCheckoutSessions in stripe-backfill.service.ts never calls
    // queueSponsorshipFollowupEmail/createSponsorshipInvoiceForStripeSession
    // -- those only run from the live checkout.session.completed webhook
    // handler, see webhook-idempotence.spec.ts's replay test for the case
    // where exactly one of each *should* exist).
    const emailQueueResponse = await request.get('/api/admin/email-queue', {
      headers: { 'x-funding-admin-token': ADMIN_TOKEN }
    });
    expect(emailQueueResponse.ok()).toBe(true);
    const emailQueueBody = await emailQueueResponse.json();
    const matchingEmails = (emailQueueBody.messages ?? []).filter(
      (message: { recipient_email?: string }) =>
        message.recipient_email === fixture.contactEmail
    );
    expect(matchingEmails).toHaveLength(0);

    const invoicesResponse = await request.get(
      '/api/admin/sponsorship-invoices',
      { headers: { 'x-funding-admin-token': ADMIN_TOKEN } }
    );
    expect(invoicesResponse.ok()).toBe(true);
    const invoicesBody = await invoicesResponse.json();
    const matchingInvoices = (invoicesBody.invoices ?? []).filter(
      (invoice: { stripe_session_id?: string }) =>
        invoice.stripe_session_id === fixture.stripeSessionId
    );
    expect(matchingInvoices).toHaveLength(0);
  });
});
