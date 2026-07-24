import { expect, test } from './support/test.js';

import { ADMIN_TOKEN, ACCOUNTING_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { updateStripeBalanceTransaction } from './support/stripe-stub-client.mjs';
import {
  buildCheckoutSessionExpiredEvent,
  buildChargeRefundedEvent,
  buildPaymentIntentPaymentFailedEvent,
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

// Covers the public/admin accounting surfaces end to end, driven by real
// webhook deliveries (via the Stripe stub, tests/stripe-stub/) rather than
// pre-seeded totals, so every assertion is a before/after delta scoped to
// this spec's own fixtures -- robust against however much other data the
// shared local dev database already holds.
//
// The formulas asserted here are the ones the code actually computes today
// (see apps/funding-api/src/fund-transparency.repository.ts): published
// expenses are never netted out of the available balance, and the admin
// dashboard's total_refunded (contribution-status based) can disagree with
// the public page's total_refunded (Stripe-ledger based) after a partial
// refund. Neither is "fixed" here -- these tests document the real current
// behavior per the decision to test what exists, not what the equation
// intuitively should be.

test.describe('Funding accounting integrity', () => {
  test('keeps gross, fees, refunds, net revenue, and available balance mathematically consistent', async ({
    request
  }) => {
    const fixture = ACCOUNTING_FIXTURES.scenario;

    const before = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    const dashboardBefore = await (
      await request.get('/api/admin/dashboard', {
        headers: { 'x-funding-admin-token': ADMIN_TOKEN }
      })
    ).json();

    const succeededSigned = buildSignedWebhookRequest(
      buildPaymentIntentSucceededEvent({
        eventId: fixture.stripeEventIdSucceeded,
        paymentIntentId: fixture.stripePaymentIntentId,
        chargeId: fixture.stripeChargeId,
        amountCents: fixture.amountCents
      })
    );
    const succeededResponse = await request.post('/api/stripe/webhook', {
      data: succeededSigned.body,
      headers: succeededSigned.headers
    });
    expect(succeededResponse.status()).toBe(200);

    await updateStripeBalanceTransaction(
      fixture.stripeRefundBalanceTransactionId,
      {
        amount: fixture.partialRefundCents,
        fee: 0,
        net: fixture.partialRefundCents
      }
    );
    const refundedSigned = buildSignedWebhookRequest(
      buildChargeRefundedEvent({
        eventId: fixture.stripeEventIdRefunded,
        chargeId: fixture.stripeChargeId,
        paymentIntentId: fixture.stripePaymentIntentId,
        chargeBalanceTransactionId: fixture.stripeBalanceTransactionId,
        refundId: fixture.stripeRefundId,
        refundBalanceTransactionId: fixture.stripeRefundBalanceTransactionId,
        amountCents: fixture.amountCents,
        refundedAmountCents: fixture.partialRefundCents
      })
    );
    const refundedResponse = await request.post('/api/stripe/webhook', {
      data: refundedSigned.body,
      headers: refundedSigned.headers
    });
    expect(refundedResponse.status()).toBe(200);

    const after = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    const dashboardAfter = await (
      await request.get('/api/admin/dashboard', {
        headers: { 'x-funding-admin-token': ADMIN_TOKEN }
      })
    ).json();

    const grossDelta = after.total_received - before.total_received;
    const feesDelta = after.total_fees - before.total_fees;
    const refundedDelta = after.total_refunded - before.total_refunded;
    const netDelta = after.total_net - before.total_net;
    const availableDelta =
      after.current_available_estimate - before.current_available_estimate;

    expect(grossDelta).toBeCloseTo(fixture.amountCents / 100, 2);
    expect(feesDelta).toBeCloseTo(fixture.feeCents / 100, 2);
    expect(refundedDelta).toBeCloseTo(fixture.partialRefundCents / 100, 2);
    expect(netDelta).toBeCloseTo(grossDelta - feesDelta, 2);
    // current_available_estimate = total_net - total_refunded. If the
    // published expense below were netted out, this equality would fail by
    // exactly expenseAmountCents / 100 -- it isn't, because
    // calculateCurrentAvailableEstimate never subtracts fund_allocations.
    expect(availableDelta).toBeCloseTo(netDelta - refundedDelta, 2);

    const allocation = (after.latest_public_allocations ?? []).find(
      (item: { project_name?: string }) =>
        item.project_name === fixture.expenseName
    );
    expect(allocation).toBeTruthy();

    // Documented asymmetry: a partial refund never flips
    // fund_contributions.status to 'refunded', so the admin dashboard's
    // status-based total_refunded stays flat here even though the public
    // page's ledger-based total_refunded (asserted above) moved.
    const dashboardRefundedDelta =
      dashboardAfter.totals.total_refunded - dashboardBefore.totals.total_refunded;
    expect(dashboardRefundedDelta).toBeCloseTo(0, 2);
  });

  test('keeps the admin CSV export, public JSON report, and public CSV export consistent with the API totals', async ({
    page,
    request
  }) => {
    const fixture = ACCOUNTING_FIXTURES.scenario;
    const apiSummary = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/contributions');
    const csvDownloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export CSV', exact: true })
      .click();
    const csvDownload = await csvDownloadPromise;
    const csvStream = await csvDownload.createReadStream();
    const csvChunks: Buffer[] = [];
    for await (const chunk of csvStream) {
      csvChunks.push(chunk as Buffer);
    }
    const adminCsv = Buffer.concat(csvChunks).toString('utf-8');
    expect(adminCsv).toContain(fixture.publicReference);

    await page.goto('/fonds-des-batisseurs/transparence');
    const reportDownloadPromise = page.waitForEvent('download');
    await page
      .locator('.hero-actions')
      .getByRole('button', { name: 'Télécharger le rapport', exact: true })
      .click();
    const reportDownload = await reportDownloadPromise;
    const reportStream = await reportDownload.createReadStream();
    const reportChunks: Buffer[] = [];
    for await (const chunk of reportStream) {
      reportChunks.push(chunk as Buffer);
    }
    const report = JSON.parse(Buffer.concat(reportChunks).toString('utf-8'));
    // downloadReport() is a client-side JSON.stringify of the same already-
    // fetched report signal, so this is a strong regression lock: it should
    // never be able to disagree with a fresh API call.
    expect(report.total_received).toBeCloseTo(apiSummary.total_received, 2);
    expect(report.total_fees).toBeCloseTo(apiSummary.total_fees, 2);
    expect(report.total_net).toBeCloseTo(apiSummary.total_net, 2);
    expect(report.current_available_estimate).toBeCloseTo(
      apiSummary.current_available_estimate,
      2
    );

    const registryCsvDownloadPromise = page.waitForEvent('download');
    await page
      .locator('.reports-panel')
      .getByRole('button', { name: 'Exporter en CSV', exact: true })
      .click();
    const registryCsvDownload = await registryCsvDownloadPromise;
    const registryCsvStream = await registryCsvDownload.createReadStream();
    const registryCsvChunks: Buffer[] = [];
    for await (const chunk of registryCsvStream) {
      registryCsvChunks.push(chunk as Buffer);
    }
    const registryCsv = Buffer.concat(registryCsvChunks).toString('utf-8');
    const registryRows = registryCsv.trim().split('\n');
    // Header row + one row per monthly_summary entry: the client-side CSV
    // must reflect the same underlying data the JSON API returns, not a
    // stale or independently-computed copy.
    expect(registryRows.length - 1).toBe(apiSummary.monthly_summary.length);
  });

  test('excludes failed and expired contributions from public totals, and nets a fully refunded one to zero', async ({
    request
  }) => {
    const failedFixture = ACCOUNTING_FIXTURES.excludedFailed;
    const beforeFailed = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    const failedSigned = buildSignedWebhookRequest(
      buildPaymentIntentPaymentFailedEvent({
        eventId: failedFixture.stripeEventId,
        paymentIntentId: failedFixture.stripePaymentIntentId,
        amountCents: failedFixture.amountCents
      })
    );
    const failedResponse = await request.post('/api/stripe/webhook', {
      data: failedSigned.body,
      headers: failedSigned.headers
    });
    expect(failedResponse.status()).toBe(200);

    const afterFailed = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterFailed.total_received).toBeCloseTo(
      beforeFailed.total_received,
      2
    );
    expect(afterFailed.contributions_count).toBe(
      beforeFailed.contributions_count
    );

    const expiredFixture = ACCOUNTING_FIXTURES.excludedExpired;
    const expiredSigned = buildSignedWebhookRequest(
      buildCheckoutSessionExpiredEvent({
        eventId: expiredFixture.stripeEventId,
        sessionId: expiredFixture.stripeSessionId,
        amountCents: expiredFixture.amountCents,
        publicReference: expiredFixture.publicReference,
        contactEmail: expiredFixture.contactEmail
      })
    );
    const expiredResponse = await request.post('/api/stripe/webhook', {
      data: expiredSigned.body,
      headers: expiredSigned.headers
    });
    expect(expiredResponse.status()).toBe(200);

    const afterExpired = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterExpired.total_received).toBeCloseTo(
      afterFailed.total_received,
      2
    );
    expect(afterExpired.contributions_count).toBe(
      afterFailed.contributions_count
    );

    const fullFixture = ACCOUNTING_FIXTURES.fullyRefunded;
    const beforeFull = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    const succeededSigned = buildSignedWebhookRequest(
      buildPaymentIntentSucceededEvent({
        eventId: fullFixture.stripeEventIdSucceeded,
        paymentIntentId: fullFixture.stripePaymentIntentId,
        chargeId: fullFixture.stripeChargeId,
        amountCents: fullFixture.amountCents
      })
    );
    await request.post('/api/stripe/webhook', {
      data: succeededSigned.body,
      headers: succeededSigned.headers
    });

    await updateStripeBalanceTransaction(
      fullFixture.stripeRefundBalanceTransactionId,
      {
        amount: fullFixture.amountCents,
        fee: 0,
        net: fullFixture.amountCents
      }
    );
    const refundedSigned = buildSignedWebhookRequest(
      buildChargeRefundedEvent({
        eventId: fullFixture.stripeEventIdRefunded,
        chargeId: fullFixture.stripeChargeId,
        paymentIntentId: fullFixture.stripePaymentIntentId,
        chargeBalanceTransactionId: fullFixture.stripeBalanceTransactionId,
        refundId: fullFixture.stripeRefundId,
        refundBalanceTransactionId:
          fullFixture.stripeRefundBalanceTransactionId,
        amountCents: fullFixture.amountCents,
        // Refunded amount equals the original amount -- a full refund.
        refundedAmountCents: fullFixture.amountCents
      })
    );
    const refundedResponse = await request.post('/api/stripe/webhook', {
      data: refundedSigned.body,
      headers: refundedSigned.headers
    });
    expect(refundedResponse.status()).toBe(200);

    const afterFull = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    const grossDelta = afterFull.total_received - beforeFull.total_received;
    const availableDelta =
      afterFull.current_available_estimate -
      beforeFull.current_available_estimate;

    // Gross history is never hidden, even once fully refunded...
    expect(grossDelta).toBeCloseTo(fullFixture.amountCents / 100, 2);
    // ...but the available balance nets back to (minus the unrecoverable
    // Stripe fee) zero: (amount - fee) - amount = -fee.
    expect(availableDelta).toBeCloseTo(-fullFixture.feeCents / 100, 2);
  });
});
