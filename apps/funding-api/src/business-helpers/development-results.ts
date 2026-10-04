import { randomBytes } from 'node:crypto';

import type { CheckoutRequest, CheckoutResult } from '@openg7/funding-core';
import type Stripe from 'stripe';

export const createDevelopmentCheckoutResult = (
  request: CheckoutRequest
): CheckoutResult => ({
  checkoutId: `stripe-dev-fallback-${request.projectId}-${request.amount}`,
  redirectUrl: request.successUrl,
  status: 'mocked'
});

// Mirrors createDevelopmentCheckoutResult: lets the admin refund workflow
// (credit note, refund email, audit log) run end-to-end in local/E2E
// environments where STRIPE_SECRET_KEY is empty, without calling Stripe.
// Only the fields the refund handler actually reads (id/amount/currency/
// status) are populated; production always goes through the real SDK call.
export const createDevelopmentRefundResult = (params: {
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentIntentId: string;
}): Stripe.Refund =>
  ({
    id: `re_dev_${randomBytes(12).toString('hex')}`,
    amount: params.amountCents,
    currency: params.currency,
    status: 'succeeded',
    payment_intent: params.paymentIntentId
  }) as Stripe.Refund;
