import { createHash } from 'node:crypto';

import Stripe from 'stripe';

import { STRIPE_TEST_WEBHOOK_SECRET } from '../fixtures/e2e-fixtures.mjs';

// Only used locally to compute HMAC signatures via
// Stripe.webhooks.generateTestHeaderString -- never makes a network call, so
// the key it's constructed with is never sent anywhere and doesn't need to
// be valid.
const signer = new Stripe('sk_test_e2e_playwright_signer_only');

export interface SignedWebhookRequest {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export const nowUnixSeconds = (): number => Math.floor(Date.now() / 1000);

export const hashFollowupToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const buildStripeEvent = (
  id: string,
  type: string,
  dataObject: Record<string, unknown>
): Record<string, unknown> => ({
  id,
  object: 'event',
  type,
  livemode: false,
  created: nowUnixSeconds(),
  data: { object: dataObject }
});

// Signs a fabricated Stripe event the same way the real Stripe-Signature
// header is computed, using the shared STRIPE_TEST_WEBHOOK_SECRET the `api`
// container is also configured with (see scripts/playwright-docker-up.mjs).
// This is what lets tests POST straight to /api/stripe/webhook and be
// accepted by apps/funding-api/src/stripe-webhook.service.ts's own
// signature verification -- no test-only bypass in production code.
export const buildSignedWebhookRequest = (
  event: Record<string, unknown>
): SignedWebhookRequest => {
  const body = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({
    payload: body,
    secret: STRIPE_TEST_WEBHOOK_SECRET
  });
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header
    }
  };
};

export const buildPaymentIntentSucceededEvent = (params: {
  readonly eventId: string;
  readonly paymentIntentId: string;
  readonly chargeId: string;
  readonly amountCents: number;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'payment_intent.succeeded', {
    id: params.paymentIntentId,
    object: 'payment_intent',
    amount: params.amountCents,
    amount_received: params.amountCents,
    currency: params.currency ?? 'cad',
    status: 'succeeded',
    created: nowUnixSeconds(),
    latest_charge: params.chargeId,
    metadata: {}
  });

export const buildPaymentIntentPaymentFailedEvent = (params: {
  readonly eventId: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'payment_intent.payment_failed', {
    id: params.paymentIntentId,
    object: 'payment_intent',
    amount: params.amountCents,
    currency: params.currency ?? 'cad',
    status: 'requires_payment_method',
    created: nowUnixSeconds(),
    metadata: {}
  });

export const buildCheckoutSessionExpiredEvent = (params: {
  readonly eventId: string;
  readonly sessionId: string;
  readonly amountCents: number;
  readonly publicReference: string;
  readonly contactEmail?: string;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'checkout.session.expired', {
    id: params.sessionId,
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'unpaid',
    amount_total: params.amountCents,
    currency: params.currency ?? 'cad',
    created: nowUnixSeconds(),
    client_reference_id: params.publicReference,
    customer_details: params.contactEmail
      ? { email: params.contactEmail }
      : null,
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'personal_support',
      publicReference: params.publicReference,
      publicDisplayConsent: 'true',
      displayAmountConsent: 'true',
      nonCharityAcknowledged: 'true'
    }
  });

export const buildChargeUpdatedEvent = (params: {
  readonly eventId: string;
  readonly chargeId: string;
  readonly paymentIntentId: string;
  readonly balanceTransactionId: string;
  readonly amountCents: number;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'charge.updated', {
    id: params.chargeId,
    object: 'charge',
    amount: params.amountCents,
    currency: params.currency ?? 'cad',
    status: 'succeeded',
    created: nowUnixSeconds(),
    payment_intent: params.paymentIntentId,
    balance_transaction: params.balanceTransactionId,
    amount_refunded: 0
  });

export const buildChargeRefundedEvent = (params: {
  readonly eventId: string;
  readonly chargeId: string;
  readonly paymentIntentId: string;
  readonly chargeBalanceTransactionId: string;
  readonly refundId: string;
  readonly refundBalanceTransactionId: string;
  readonly amountCents: number;
  readonly refundedAmountCents: number;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'charge.refunded', {
    id: params.chargeId,
    object: 'charge',
    amount: params.amountCents,
    currency: params.currency ?? 'cad',
    status: 'succeeded',
    created: nowUnixSeconds(),
    payment_intent: params.paymentIntentId,
    balance_transaction: params.chargeBalanceTransactionId,
    amount_refunded: params.refundedAmountCents,
    refunds: {
      object: 'list',
      data: [
        {
          id: params.refundId,
          object: 'refund',
          amount: params.refundedAmountCents,
          currency: params.currency ?? 'cad',
          balance_transaction: params.refundBalanceTransactionId
        }
      ],
      has_more: false
    }
  });

export const buildCheckoutSessionCompletedEvent = (params: {
  readonly eventId: string;
  readonly sessionId: string;
  readonly amountCents: number;
  readonly publicReference: string;
  readonly followupToken: string;
  readonly contactEmail: string;
  readonly currency?: string;
}): Record<string, unknown> =>
  buildStripeEvent(params.eventId, 'checkout.session.completed', {
    id: params.sessionId,
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: params.amountCents,
    currency: params.currency ?? 'cad',
    created: nowUnixSeconds(),
    client_reference_id: params.publicReference,
    customer_details: { email: params.contactEmail },
    metadata: {
      project: 'openg7',
      projectId: 'openg7',
      contributionType: 'sponsorship_interest',
      publicReference: params.publicReference,
      publicDisplayConsent: 'true',
      displayAmountConsent: 'true',
      nonCharityAcknowledged: 'true',
      requiresReview: 'true',
      sponsorshipFollowupToken: params.followupToken,
      sponsorshipFollowupTokenHash: hashFollowupToken(params.followupToken)
    }
  });
