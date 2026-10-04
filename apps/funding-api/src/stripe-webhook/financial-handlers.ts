import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { normalizeContributionPublicReference } from '../contribution-public-reference.js';
import {
  buildBalanceData,
  resolveBalanceTransaction,
  resolvePaymentIntentId
} from '../stripe-object-normalization.js';
import { updateContributionStatusByPaymentIntent } from '../fund-contributions.repository.js';
import {
  insertFundTransaction,
  updateContributionFundTransactionBalance
} from '../fund-transparency.repository.js';
import { syncStripeChargeRefunds } from '../stripe-refunds.service.js';

import { toIsoFromUnix } from './event-time.js';

interface FinancialHandlerDependencies {
  readonly stripe: Stripe;
  readonly pool: Pool | null;
  readonly projectId: string;
}

export const handleStripeFinancialEvent = async (
  event: Stripe.Event,
  dependencies: FinancialHandlerDependencies
): Promise<Record<string, unknown>> => {
  const { stripe, pool } = dependencies;

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const statusUpdated = await updateContributionStatusByPaymentIntent(pool, {
      notifyAdmin: true,
      stripePaymentIntentId: paymentIntent.id,
      status: 'paid',
      paidAtIso: toIsoFromUnix(paymentIntent.created)
    });

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
        project:
          paymentIntent.metadata.project ??
          paymentIntent.metadata.projectId ??
          dependencies.projectId,
        eventType: event.type
      }
    });

    return {
      received: true,
      inserted,
      statusUpdated
    };
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const publicReference = normalizeContributionPublicReference(
      paymentIntent.metadata.publicReference
    );
    const updated = await updateContributionStatusByPaymentIntent(pool, {
      stripePaymentIntentId: paymentIntent.id,
      ...(publicReference
        ? {
            checkoutMatch: {
              publicReference,
              amountCents: paymentIntent.amount,
              currency: paymentIntent.currency
            }
          }
        : {}),
      status: 'failed'
    });

    return {
      received: true,
      updated
    };
  }

  if (event.type === 'charge.updated') {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = resolvePaymentIntentId(charge.payment_intent);
    const balanceTransaction = await resolveBalanceTransaction(
      stripe,
      charge.balance_transaction
    );

    if (!paymentIntentId || !balanceTransaction) {
      return {
        received: true,
        updated: false,
        hasBalanceTransaction: Boolean(balanceTransaction)
      };
    }

    const balanceData = buildBalanceData(
      balanceTransaction,
      charge.amount,
      charge.currency
    );
    const updated = await updateContributionFundTransactionBalance(pool, {
      stripePaymentIntentId: paymentIntentId,
      stripeBalanceTransactionId: balanceTransaction.id,
      amount: balanceData.amount,
      fee: balanceData.fee,
      net: balanceData.net,
      currency: balanceData.currency,
      status: charge.status
    });

    return {
      received: true,
      updated
    };
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = resolvePaymentIntentId(charge.payment_intent);
    const result = await syncStripeChargeRefunds(stripe, pool, charge, {
      paymentIntentId,
      source: 'stripe',
      eventId: event.id
    });
    return {
      received: true,
      inserted: result.inserted > 0,
      statusUpdated: result.statusUpdated
    };
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    const paymentIntentId = resolvePaymentIntentId(dispute.payment_intent);
    const updated = paymentIntentId
      ? await updateContributionStatusByPaymentIntent(pool, {
          stripePaymentIntentId: paymentIntentId,
          status: 'disputed'
        })
      : false;

    return {
      received: true,
      updated
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
      received: true,
      inserted
    };
  }

  return {
    received: true,
    ignored: true
  };
};
