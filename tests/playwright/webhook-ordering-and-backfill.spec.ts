import { expect, test } from './support/test.js';

import { WEBHOOK_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { updateStripeBalanceTransaction } from './support/stripe-stub-client.mjs';
import {
  buildChargeUpdatedEvent,
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

// Covers webhook handling for events that arrive after the fact or out of
// Stripe's usual delivery order -- both routed through the Stripe API stub
// (tests/stripe-stub/) so charge.updated can resolve a real, mutable balance
// transaction.

test.describe('Stripe webhook fee correction and delivery order', () => {
  test('backfills the Stripe fee from charge.updated without creating a duplicate transaction', async ({
    request
  }) => {
    const fixture = WEBHOOK_FIXTURES.feeBackfill;

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

    const afterSucceeded = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    // Stripe settles the charge with a corrected fee (a common real-world
    // occurrence for cross-border cards) and sends charge.updated.
    await updateStripeBalanceTransaction(fixture.stripeBalanceTransactionId, {
      fee: fixture.correctedFeeCents
    });
    const updatedSigned = buildSignedWebhookRequest(
      buildChargeUpdatedEvent({
        eventId: fixture.stripeEventIdUpdated,
        chargeId: fixture.stripeChargeId,
        paymentIntentId: fixture.stripePaymentIntentId,
        balanceTransactionId: fixture.stripeBalanceTransactionId,
        amountCents: fixture.amountCents
      })
    );
    const updatedResponse = await request.post('/api/stripe/webhook', {
      data: updatedSigned.body,
      headers: updatedSigned.headers
    });
    expect(updatedResponse.status()).toBe(200);
    const updatedBody = await updatedResponse.json();
    expect(updatedBody.updated).toBe(true);

    const afterUpdated = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    const feeDeltaCents = Math.round(
      (afterUpdated.total_fees - afterSucceeded.total_fees) * 100
    );
    expect(feeDeltaCents).toBe(
      fixture.correctedFeeCents - fixture.initialFeeCents
    );
    // updateContributionFundTransactionBalance is an UPDATE, never an
    // INSERT: gross received and the contribution count must be unchanged.
    expect(afterUpdated.total_received).toBeCloseTo(
      afterSucceeded.total_received,
      2
    );
    expect(afterUpdated.contributions_count).toBe(
      afterSucceeded.contributions_count
    );
  });

  test('converges to the same final state when charge.updated is delivered before payment_intent.succeeded', async ({
    request
  }) => {
    const fixture = WEBHOOK_FIXTURES.outOfOrder;

    const before = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    // No fund_transactions row exists yet for this payment intent, so
    // updateContributionFundTransactionBalance's
    // `WHERE stripe_object_id = $1 AND type = 'payment_intent.succeeded'`
    // matches nothing. It must acknowledge a no-op, not error.
    const updatedSigned = buildSignedWebhookRequest(
      buildChargeUpdatedEvent({
        eventId: fixture.stripeEventIdUpdated,
        chargeId: fixture.stripeChargeId,
        paymentIntentId: fixture.stripePaymentIntentId,
        balanceTransactionId: fixture.stripeBalanceTransactionId,
        amountCents: fixture.amountCents
      })
    );
    const updatedResponse = await request.post('/api/stripe/webhook', {
      data: updatedSigned.body,
      headers: updatedSigned.headers
    });
    expect(updatedResponse.status()).toBe(200);
    const updatedBody = await updatedResponse.json();
    expect(updatedBody.updated).toBe(false);

    const afterOutOfOrderUpdate = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterOutOfOrderUpdate.total_received).toBeCloseTo(
      before.total_received,
      2
    );

    // payment_intent.succeeded now arrives and resolves its own fresh
    // charge/balance transaction from the stub, independent of the earlier
    // no-op -- the final state must be exactly what a normally-ordered
    // delivery would have produced.
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

    const afterSucceeded = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterSucceeded.total_received - before.total_received).toBeCloseTo(
      fixture.amountCents / 100,
      2
    );
    expect(afterSucceeded.total_fees - before.total_fees).toBeCloseTo(
      fixture.feeCents / 100,
      2
    );
  });
});
