import type Stripe from 'stripe';

import {
  resolveBalanceTransaction,
  resolveCharge,
  resolvePaymentIntent
} from '../stripe-object-normalization.js';
import { stripeSessionBelongsToProject } from '../stripe-project-scope.js';

import type {
  StripeContribution,
  StripeTransparencyFact,
  StripeTransparencyOptions
} from './contracts.js';

const toContribution = async (
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  paymentIntent: Stripe.PaymentIntent
): Promise<StripeContribution | null> => {
  if (
    session.payment_status !== 'paid' &&
    paymentIntent.status !== 'succeeded'
  ) {
    return null;
  }

  const charge = await resolveCharge(stripe, paymentIntent.latest_charge, {
    expand: ['balance_transaction']
  });
  const balanceTransaction = await resolveBalanceTransaction(
    stripe,
    charge?.balance_transaction
  );
  const amount =
    paymentIntent.amount_received ||
    session.amount_total ||
    paymentIntent.amount ||
    0;
  const fee = balanceTransaction?.fee ?? 0;
  const net = balanceTransaction?.net ?? amount - fee;
  const currency =
    balanceTransaction?.currency ??
    paymentIntent.currency ??
    session.currency ??
    'cad';

  // This projection has one currency; an FX settlement must not mix gross and net.
  if (currency !== paymentIntent.currency) {
    throw new Error('Unsupported currency conversion in public transparency');
  }

  return {
    amount,
    fee,
    feePending: balanceTransaction === null,
    net,
    refunded: charge?.amount_refunded ?? 0,
    currency,
    created: paymentIntent.created || session.created
  };
};

/** Exhaust every page or fail; a partial aggregate must never look complete. */
async function* stripePages<T extends { id: string }>(
  list: (startingAfter?: string) => Promise<{ data: T[]; has_more: boolean }>
): AsyncGenerator<T> {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await list(cursor);
    for (const item of page.data) yield item;
    if (!page.has_more) return;
    const next = page.data.at(-1)?.id;
    if (!next || cursors.has(next)) {
      throw new Error('Incomplete Stripe pagination in public transparency');
    }
    cursors.add(next);
    cursor = next;
  } while (cursor);
}

export async function* collectStripeTransparencyFacts(
  stripe: Stripe,
  options: StripeTransparencyOptions
): AsyncGenerator<StripeTransparencyFact> {
  const sessions = stripePages((startingAfter) =>
    stripe.checkout.sessions.list({
      limit: 100,
      expand: ['data.payment_intent'],
      ...(startingAfter ? { starting_after: startingAfter } : {})
    })
  );
  const paymentIntents = new Set<string>();
  let currency = 'cad';

  for await (const session of sessions) {
    const paymentIntent = await resolvePaymentIntent(
      stripe,
      session.payment_intent
    );
    if (
      !paymentIntent ||
      !stripeSessionBelongsToProject(session, paymentIntent, options.projectId)
    ) {
      continue;
    }

    if (paymentIntents.has(paymentIntent.id)) continue;

    const contribution = await toContribution(stripe, session, paymentIntent);
    if (!contribution) {
      continue;
    }
    paymentIntents.add(paymentIntent.id);

    yield { kind: 'contribution', contribution };
    currency = contribution.currency;
  }

  const payouts = stripePages((startingAfter) =>
    stripe.payouts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    })
  );
  for await (const payout of payouts) {
    // Payouts are account-wide transfers, reported only in the fund's currency.
    if (payout.status !== 'paid' || payout.currency !== currency) {
      continue;
    }

    yield {
      kind: 'payout',
      payout: {
        amount: payout.amount,
        currency: payout.currency,
        created: payout.created
      }
    };
  }
}
