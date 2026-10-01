import type Stripe from 'stripe';

/** Authenticated read only. Account details never leave this adapter. */
export async function readStripeConnection(stripe: Stripe): Promise<void> {
  const account = await stripe.accounts.retrieve({
    timeout: 2000,
    maxNetworkRetries: 0
  });
  if (account.object !== 'account' || !account.id?.startsWith('acct_'))
    throw new Error('Stripe account check failed');
}
