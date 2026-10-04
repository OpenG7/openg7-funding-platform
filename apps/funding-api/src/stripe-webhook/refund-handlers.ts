import type { Pool } from 'pg';
import type Stripe from 'stripe';

import { createSponsorshipCreditNoteForRefund } from '../sponsorship-invoices.repository.js';
import { resolvePaymentIntentId } from '../stripe-object-normalization.js';
import { stripeEventBelongsToProject } from '../stripe-project-scope.js';
import { syncStripeChargeRefunds } from '../stripe-refunds.service.js';

const chargeId = (refund: Stripe.Refund): string | null =>
  typeof refund.charge === 'string'
    ? refund.charge
    : (refund.charge?.id ?? null);

/** Delayed events trigger reconciliation from current provider facts, never their stale status. */
async function reconcileStripeRefundEvent(
  event: Stripe.Event,
  dependencies: {
    readonly stripe: Stripe;
    readonly pool: Pool | null;
    readonly projectId: string;
  }
): Promise<Record<string, unknown>> {
  const { stripe, pool, projectId } = dependencies;
  if (!pool) return { received: true, updated: false };
  const snapshot = event.data.object as Stripe.Refund;
  const refund = await stripe.refunds.retrieve(snapshot.id);
  const paymentIntentId = resolvePaymentIntentId(refund.payment_intent);
  const currentChargeId = chargeId(refund);
  if (
    refund.id !== snapshot.id ||
    refund.amount !== snapshot.amount ||
    refund.currency.toLowerCase() !== snapshot.currency.toLowerCase() ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0 ||
    !paymentIntentId ||
    !currentChargeId ||
    (snapshot.payment_intent &&
      resolvePaymentIntentId(snapshot.payment_intent) !== paymentIntentId) ||
    (snapshot.charge && chargeId(snapshot) !== currentChargeId)
  )
    throw new Error('Inconsistent Stripe refund facts.');
  if (
    !(await stripeEventBelongsToProject(
      { type: event.type, data: { object: refund } },
      stripe,
      pool,
      projectId
    ))
  )
    return { received: true, ignored: true, reason: 'PROJECT_MISMATCH' };

  const charge = await stripe.charges.retrieve(currentChargeId, {
    expand: ['balance_transaction']
  });
  if (
    charge.id !== currentChargeId ||
    resolvePaymentIntentId(charge.payment_intent) !== paymentIntentId ||
    charge.currency.toLowerCase() !== refund.currency.toLowerCase() ||
    refund.amount > charge.amount
  )
    throw new Error('Inconsistent Stripe refund references.');

  if (refund.status !== 'succeeded') {
    const confirmed = await pool.query(
      `SELECT 1 FROM fund_transactions WHERE type='charge.refunded' AND status='succeeded'
       AND metadata_json->>'refundId'=$1 LIMIT 1`,
      [refund.id]
    );
    // A returned refund needs a compensating financial workflow; never erase its confirmed history.
    if (confirmed.rowCount)
      throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');
  }

  const operations = await pool.query<{
    id: string;
    contribution_id: string;
    status: string;
    payment_intent_id: string;
    amount_minor: string;
    currency: string;
    stripe_refund_id: string | null;
  }>(
    `SELECT id::text,contribution_id,status,payment_intent_id,amount_minor::text,currency,stripe_refund_id
     FROM sponsorship_refund_operations WHERE stripe_refund_id=$1 OR id::text=$2`,
    [refund.id, refund.metadata?.openg7RefundOperationId ?? null]
  );
  if (
    operations.rows.length > 1 ||
    operations.rows.some(
      (operation) =>
        operation.payment_intent_id !== paymentIntentId ||
        operation.amount_minor !== String(refund.amount) ||
        operation.currency.toLowerCase() !== refund.currency.toLowerCase() ||
        (operation.stripe_refund_id && operation.stripe_refund_id !== refund.id)
    )
  )
    throw new Error('Inconsistent Stripe refund operation.');
  if (
    operations.rows.some(
      (operation) =>
        (operation.status === 'succeeded' && refund.status !== 'succeeded') ||
        (operation.status === 'failed' && refund.status === 'succeeded')
    )
  )
    throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');

  const result = await syncStripeChargeRefunds(stripe, pool, charge, {
    paymentIntentId,
    source: 'stripe',
    eventId: event.id,
    authoritativeRefund: refund,
    refundOperationId: operations.rows[0]?.id
  });
  let creditNoteAvailable = false;
  if (refund.status === 'succeeded') {
    for (const operation of operations.rows) {
      const creditNote = await createSponsorshipCreditNoteForRefund(pool, {
        contributionId: operation.contribution_id,
        stripeRefundId: refund.id,
        refundAmountCents: refund.amount
      });
      if (!creditNote) throw new Error('REFUND_INVOICE_REQUIRED');
      creditNoteAvailable = true;
    }
  }
  return {
    received: true,
    inserted: result.inserted > 0,
    statusUpdated: result.statusUpdated,
    creditNoteAvailable
  };
}

export async function handleStripeRefundEvent(
  event: Stripe.Event,
  dependencies: {
    readonly stripe: Stripe;
    readonly pool: Pool | null;
    readonly projectId: string;
  }
): Promise<Record<string, unknown>> {
  if (!dependencies.pool) return { received: true, updated: false };
  const refund = event.data.object as Stripe.Refund;
  const client = await dependencies.pool.connect();
  let locked = false;
  try {
    // The webhook owner keeps this connection across the short repository transactions.
    // Read current Stripe facts after serializing distinct events for the same refund.
    await client.query(
      'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
      [`stripe-refund-reconciliation:${refund.id}`]
    );
    locked = true;
    return await reconcileStripeRefundEvent(event, dependencies);
  } finally {
    try {
      if (locked) {
        const result = await client.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS unlocked',
          [`stripe-refund-reconciliation:${refund.id}`]
        );
        if (result.rows[0]?.unlocked !== true)
          throw new Error('Refund reconciliation lock could not be released.');
      }
      client.release();
    } catch (error) {
      client.release(true);
      throw error;
    }
  }
}
