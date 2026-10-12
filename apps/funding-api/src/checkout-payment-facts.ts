import type Stripe from 'stripe';

import { normalizeContributionPublicReference } from './contribution-public-reference.js';
import type { CheckoutSessionWebhookInput } from './contributions-write.repository.js';

/** A local paid status or an unpaid Session is never monetary evidence. */
export const confirmedCheckoutSessionPaymentFacts = (
  session: Stripe.Checkout.Session
): CheckoutSessionWebhookInput['trustedPaymentFacts'] => {
  const amountCents = session.amount_total;
  const currency = session.currency;
  if (
    session.payment_status !== 'paid' ||
    amountCents === null ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    typeof currency !== 'string' ||
    !currency
  )
    return undefined;
  const intent =
    typeof session.payment_intent === 'object' ? session.payment_intent : null;
  if (
    intent?.status !== undefined &&
    (intent.status !== 'succeeded' ||
      (intent.amount_received || intent.amount) !== amountCents ||
      typeof intent.currency !== 'string' ||
      intent.currency.toUpperCase() !== currency.toUpperCase())
  )
    return undefined;
  return {
    amountCents,
    currency,
    publicReference: normalizeContributionPublicReference(
      session.metadata?.publicReference ?? session.client_reference_id
    )
  };
};
