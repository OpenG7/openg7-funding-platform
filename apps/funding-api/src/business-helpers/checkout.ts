import type Stripe from 'stripe';

export const stripeCheckoutSessionStatus = (
  session: Stripe.Checkout.Session
): 'pending' | 'paid' | 'expired' => {
  if (session.payment_status === 'paid') {
    return 'paid';
  }

  return session.status === 'expired' ? 'expired' : 'pending';
};

export const checkoutSessionPaidAtIso = (
  session: Stripe.Checkout.Session,
  status: 'pending' | 'paid' | 'expired'
): string | null =>
  status === 'paid' ? new Date(session.created * 1000).toISOString() : null;
