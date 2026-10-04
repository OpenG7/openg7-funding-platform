// Registers fixture objects through injected Stripe stub control ports.
// The caller owns configuration, client construction and SQL commit ordering.
export const seedStripeStub = async ({
  sponsorshipFixtures,
  webhookFixtures,
  accountingFixtures,
  backfillFixtures,
  cleanupOnly = false,
  ports
}) => {
  const {
    resetStripeStub,
    registerStripePaymentIntent,
    registerStripeCheckoutSession
  } = ports;

  await resetStripeStub();

  if (cleanupOnly) {
    return;
  }

  // Refund fixtures need their original amount in the provider stub.
  for (const fixture of Object.values(sponsorshipFixtures)) {
    if (!fixture.stripePaymentIntentId) {
      continue;
    }
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      fee: 0
    });
  }

  // checkout.session.completed does not resolve replaySponsorship through
  // the Stripe API, so it needs no provider-side backing object.
  for (const fixture of Object.values(webhookFixtures)) {
    if (fixture === webhookFixtures.replaySponsorship) {
      continue;
    }
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      chargeId: fixture.stripeChargeId,
      balanceTransactionId: fixture.stripeBalanceTransactionId,
      fee: fixture.initialFeeCents ?? fixture.feeCents ?? 0
    });
  }

  // Failed and expired webhooks do not call Stripe.
  for (const fixture of [
    accountingFixtures.scenario,
    accountingFixtures.fullyRefunded
  ]) {
    await registerStripePaymentIntent({
      id: fixture.stripePaymentIntentId,
      amount: fixture.amountCents,
      chargeId: fixture.stripeChargeId,
      balanceTransactionId: fixture.stripeBalanceTransactionId,
      fee: fixture.feeCents
    });
  }

  // Keep each backfill PaymentIntent before its checkout session. Matching
  // metadata belongs only to the two fixtures the backfill should import.
  await registerStripePaymentIntent({
    id: backfillFixtures.matchedSession.stripePaymentIntentId,
    amount: backfillFixtures.matchedSession.amountCents,
    chargeId: backfillFixtures.matchedSession.stripeChargeId,
    balanceTransactionId:
      backfillFixtures.matchedSession.stripeBalanceTransactionId,
    fee: backfillFixtures.matchedSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: backfillFixtures.matchedSession.stripeSessionId,
    paymentIntentId: backfillFixtures.matchedSession.stripePaymentIntentId,
    amountTotal: backfillFixtures.matchedSession.amountCents,
    customerEmail: backfillFixtures.matchedSession.contactEmail,
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'personal_support',
      publicReference: backfillFixtures.matchedSession.publicReference,
      nonCharityAcknowledged: 'true'
    }
  });

  await registerStripePaymentIntent({
    id: backfillFixtures.unmatchedSession.stripePaymentIntentId,
    amount: backfillFixtures.unmatchedSession.amountCents,
    chargeId: backfillFixtures.unmatchedSession.stripeChargeId,
    balanceTransactionId:
      backfillFixtures.unmatchedSession.stripeBalanceTransactionId,
    fee: backfillFixtures.unmatchedSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: backfillFixtures.unmatchedSession.stripeSessionId,
    paymentIntentId: backfillFixtures.unmatchedSession.stripePaymentIntentId,
    amountTotal: backfillFixtures.unmatchedSession.amountCents,
    metadata: {
      project: 'some-other-project',
      contributionType: 'personal_support'
    }
  });

  await registerStripePaymentIntent({
    id: backfillFixtures.sponsorshipSession.stripePaymentIntentId,
    amount: backfillFixtures.sponsorshipSession.amountCents,
    chargeId: backfillFixtures.sponsorshipSession.stripeChargeId,
    balanceTransactionId:
      backfillFixtures.sponsorshipSession.stripeBalanceTransactionId,
    fee: backfillFixtures.sponsorshipSession.feeCents
  });
  await registerStripeCheckoutSession({
    id: backfillFixtures.sponsorshipSession.stripeSessionId,
    paymentIntentId: backfillFixtures.sponsorshipSession.stripePaymentIntentId,
    amountTotal: backfillFixtures.sponsorshipSession.amountCents,
    customerEmail: backfillFixtures.sponsorshipSession.contactEmail,
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'sponsorship_interest',
      publicReference: backfillFixtures.sponsorshipSession.publicReference,
      nonCharityAcknowledged: 'true'
    }
  });
};
