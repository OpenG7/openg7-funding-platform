import type { Pool } from 'pg';
import type Stripe from 'stripe';

import {
  buildBalanceData,
  resolveBalanceTransaction
} from '../stripe-object-normalization.js';

import type {
  StripeBackfillOptions,
  StripeBackfillSummary
} from './contracts.js';
import { insertBackfilledFundTransaction } from './repository.js';
import {
  shouldStopAfterScan,
  syntheticStripeEventId,
  toIsoFromUnix
} from './shared.js';
import { applyInsertResult } from './summary.js';

const buildPayoutListParams = (
  options: StripeBackfillOptions
): Stripe.PayoutListParams => ({
  limit: 100,
  expand: ['data.balance_transaction'],
  ...(options.created ? { created: options.created } : {})
});

export const backfillPayouts = async (
  stripe: Stripe,
  pool: Pool,
  options: StripeBackfillOptions,
  summary: StripeBackfillSummary
): Promise<void> => {
  if (!options.includePayouts) {
    return;
  }

  for await (const payout of stripe.payouts.list(
    buildPayoutListParams(options)
  )) {
    if (shouldStopAfterScan(summary.payouts.scanned, options.maxRecords)) {
      break;
    }

    summary.payouts.scanned += 1;

    const type =
      payout.status === 'paid'
        ? 'payout.paid'
        : payout.status === 'failed'
          ? 'payout.failed'
          : null;

    if (!type) {
      continue;
    }

    const balanceData = buildBalanceData(
      await resolveBalanceTransaction(stripe, payout.balance_transaction),
      payout.amount,
      payout.currency
    );
    const insertResult = await insertBackfilledFundTransaction(
      pool,
      {
        stripeEventId: syntheticStripeEventId(type, payout.id),
        stripeObjectId: payout.id,
        stripeBalanceTransactionId: balanceData.stripeBalanceTransactionId,
        type,
        amount: payout.amount,
        fee: balanceData.fee,
        net: balanceData.net,
        currency: balanceData.currency,
        status: payout.status,
        createdAtIso: toIsoFromUnix(payout.created),
        publicCategory: 'payout',
        metadataJson: {
          source: 'stripe_backfill',
          eventType: type
        }
      },
      options.dryRun
    );

    applyInsertResult(summary.payouts, insertResult);
  }
};
