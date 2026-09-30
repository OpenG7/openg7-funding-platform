import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { insertFundTransaction } from './fund-transparency.repository.js';
import { updateContributionStatusByPaymentIntent } from './fund-contributions.repository.js';
import { settleSponsorshipRefundOperation } from './sponsorship-refund-operations.js';

/** Canonical facts are individual confirmed refunds, never a cumulative charge snapshot. */
export async function syncStripeChargeRefunds(
  stripe: Stripe,
  pool: Pool | null,
  charge: Stripe.Charge,
  input: {
    paymentIntentId: string | null;
    source: 'stripe' | 'stripe_backfill';
    eventId?: string;
    dryRun?: boolean;
    limit?: number;
  }
): Promise<{
  seen: number;
  inserted: number;
  existing: number;
  statusUpdated: boolean;
}> {
  const limit = input.limit ?? 100;
  const refunds: Stripe.Refund[] = [];
  const expanded = charge.refunds;
  if (expanded && !expanded.has_more) {
    refunds.push(...expanded.data);
  } else {
    for await (const refund of stripe.refunds.list({
      charge: charge.id,
      limit: 100
    })) {
      refunds.push(refund);
      if (refunds.length > limit)
        throw new Error('Stripe refund limit reached.');
    }
  }
  if (refunds.length > limit) throw new Error('Stripe refund limit reached.');
  refunds.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const confirmed = refunds.filter((refund) => refund.status === 'succeeded');
  let inserted = 0;
  let existing = 0;
  let confirmedAmount = 0;
  for (const refund of confirmed) {
    if (
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      refund.currency.toLowerCase() !== charge.currency.toLowerCase()
    )
      throw new Error('Inconsistent Stripe refund facts.');
    confirmedAmount += refund.amount;
  }
  if (!Number.isSafeInteger(confirmedAmount) || confirmedAmount > charge.amount)
    throw new Error('Inconsistent Stripe refund total.');
  for (const refund of confirmed) {
    if (input.dryRun) {
      const known = pool
        ? await pool.query(
            `SELECT 1 FROM fund_transactions WHERE type='charge.refunded'
         AND metadata_json->>'refundId'=$1`,
            [refund.id]
          )
        : null;
      if (known?.rowCount) existing++;
      else inserted++;
      continue;
    }
    const balance =
      typeof refund.balance_transaction === 'string'
        ? await stripe.balanceTransactions.retrieve(refund.balance_transaction)
        : refund.balance_transaction;
    // Refund units remain those of the charge; a settlement conversion is not interchangeable.
    const matchingBalance =
      balance?.currency.toLowerCase() === refund.currency.toLowerCase()
        ? balance
        : null;
    const added = await insertFundTransaction(pool, {
      stripeEventId: 'stripe-refund:' + refund.id,
      stripeObjectId: charge.id,
      stripeBalanceTransactionId: matchingBalance?.id ?? null,
      type: 'charge.refunded',
      amount: refund.amount,
      fee: matchingBalance?.fee ?? 0,
      net: matchingBalance?.net ?? -refund.amount,
      currency: refund.currency,
      status: 'succeeded',
      createdAtIso: new Date(refund.created * 1000).toISOString(),
      publicCategory: 'refund',
      metadataJson: {
        source: input.source,
        refundId: refund.id,
        paymentIntentId: input.paymentIntentId,
        eventType: 'charge.refunded',
        ...(input.eventId ? { stripeEventId: input.eventId } : {})
      }
    });
    if (added) inserted++;
    else existing++;
  }
  let statusUpdated = false;
  if (!input.dryRun) {
    for (const refund of refunds) {
      // Expanded fixtures/older API snapshots can omit the redundant PaymentIntent reference.
      await settleSponsorshipRefundOperation(pool, {
        ...refund,
        payment_intent: refund.payment_intent ?? input.paymentIntentId
      });
    }
    if (
      input.paymentIntentId &&
      confirmedAmount >= charge.amount &&
      charge.amount > 0
    )
      statusUpdated = await updateContributionStatusByPaymentIntent(pool, {
        stripePaymentIntentId: input.paymentIntentId,
        status: 'refunded'
      });
  }
  return { seen: confirmed.length, inserted, existing, statusUpdated };
}
