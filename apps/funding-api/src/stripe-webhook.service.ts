import Stripe from 'stripe';
import type { Pool } from 'pg';

import { insertFundTransaction } from './fund-transparency.repository.js';

interface ProcessWebhookDependencies {
  readonly stripe: Stripe;
  readonly webhookSecret: string;
  readonly pool: Pool | null;
}

const allowedEvents = new Set([
  'payment_intent.succeeded',
  'charge.refunded',
  'payout.paid',
  'payout.failed'
]);

const toIsoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();

const buildBalanceData = (
  balanceTransaction: Stripe.BalanceTransaction | null,
  fallbackAmount: number,
  fallbackCurrency: string
): {
  readonly stripeBalanceTransactionId: string | null;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
} => {
  if (!balanceTransaction) {
    return {
      stripeBalanceTransactionId: null,
      amount: fallbackAmount,
      fee: 0,
      net: fallbackAmount,
      currency: fallbackCurrency
    };
  }

  return {
    stripeBalanceTransactionId: balanceTransaction.id,
    amount: balanceTransaction.amount,
    fee: balanceTransaction.fee,
    net: balanceTransaction.net,
    currency: balanceTransaction.currency
  };
};

const resolveBalanceTransaction = async (
  stripe: Stripe,
  value: string | Stripe.BalanceTransaction | null | undefined
): Promise<Stripe.BalanceTransaction | null> => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return stripe.balanceTransactions.retrieve(value);
  }

  return value;
};

export const processStripeWebhook = async (
  rawBody: string,
  signature: string,
  dependencies: ProcessWebhookDependencies
): Promise<{ readonly statusCode: number; readonly payload: Record<string, unknown> }> => {
  const { stripe, webhookSecret, pool } = dependencies;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return {
      statusCode: 400,
      payload: {
        error: 'Invalid Stripe webhook signature'
      }
    };
  }

  if (!allowedEvents.has(event.type)) {
    return {
      statusCode: 200,
      payload: {
        received: true,
        ignored: true,
        type: event.type
      }
    };
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    const chargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    const charge = chargeId
      ? await stripe.charges.retrieve(chargeId, {
          expand: ['balance_transaction']
        })
      : null;

    const balanceData = buildBalanceData(
      await resolveBalanceTransaction(stripe, charge?.balance_transaction),
      paymentIntent.amount_received || paymentIntent.amount,
      paymentIntent.currency
    );

    const inserted = await insertFundTransaction(pool, {
      stripeEventId: event.id,
      stripeObjectId: paymentIntent.id,
      stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
      type: event.type,
      amount: paymentIntent.amount_received || paymentIntent.amount,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: paymentIntent.status,
      createdAtIso: toIsoFromUnix(paymentIntent.created),
      publicCategory: 'contribution',
      metadataJson: {
        source: 'stripe',
        project: paymentIntent.metadata.projectId ?? 'openg7',
        eventType: event.type
      }
    });

    return {
      statusCode: 200,
      payload: {
        received: true,
        inserted
      }
    };
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const balanceData = buildBalanceData(
      await resolveBalanceTransaction(stripe, charge.balance_transaction),
      charge.amount_refunded,
      charge.currency
    );

    const inserted = await insertFundTransaction(pool, {
      stripeEventId: event.id,
      stripeObjectId: charge.id,
      stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
      type: event.type,
      amount: charge.amount_refunded,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: charge.status,
      createdAtIso: toIsoFromUnix(charge.created),
      publicCategory: 'refund',
      metadataJson: {
        source: 'stripe',
        eventType: event.type
      }
    });

    return {
      statusCode: 200,
      payload: {
        received: true,
        inserted
      }
    };
  }

  if (event.type === 'payout.paid' || event.type === 'payout.failed') {
    const payout = event.data.object as Stripe.Payout;
    const balanceData = buildBalanceData(
      await resolveBalanceTransaction(stripe, payout.balance_transaction),
      payout.amount,
      payout.currency
    );

    const inserted = await insertFundTransaction(pool, {
      stripeEventId: event.id,
      stripeObjectId: payout.id,
      stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
      type: event.type,
      amount: payout.amount,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: payout.status,
      createdAtIso: toIsoFromUnix(payout.created),
      publicCategory: 'payout',
      metadataJson: {
        source: 'stripe',
        eventType: event.type
      }
    });

    return {
      statusCode: 200,
      payload: {
        received: true,
        inserted
      }
    };
  }

  return {
    statusCode: 200,
    payload: {
      received: true,
      ignored: true
    }
  };
};
