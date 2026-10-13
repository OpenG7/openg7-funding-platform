import type Stripe from 'stripe';
import type { Pool } from 'pg';

import { insertFundTransaction } from './fund-transparency.repository.js';
import { updateContributionStatusByPaymentIntent } from './fund-contributions.repository.js';
import { settleSponsorshipRefundOperation } from './sponsorship-refund-operations.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { createSponsorshipCreditNoteForRefund } from './sponsorship-invoices.repository.js';

/** Provider-confirmed refunds need the same immutable document whatever their origin. */
const ensureStripeRefundCreditNote = async (
  pool: Pool | null,
  refund: Stripe.Refund,
  paymentIntentId: string | null,
  source: 'stripe' | 'stripe_backfill'
): Promise<boolean> => {
  if (!pool || !paymentIntentId) return false;
  return withPostgresTransaction(pool, async (db) => {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
      [`fund-refund:${refund.id}`]
    );
    const contributions = await db.query<{
      id: string;
      currency: string;
      contribution_type: string;
    }>(
      `SELECT id,currency,contribution_type FROM fund_contributions
       WHERE stripe_payment_intent_id=$1`,
      [paymentIntentId]
    );
    if (!contributions.rows.length)
      throw new Error('REFUND_CONTRIBUTION_REQUIRED');
    if (
      contributions.rows.every(
        (row) => row.contribution_type !== 'sponsorship_interest'
      )
    )
      return false;
    if (contributions.rows.length !== 1)
      throw new Error('REFUND_CONTRIBUTION_AMBIGUOUS');
    const contribution = contributions.rows[0]!;
    if (contribution.currency.toLowerCase() !== refund.currency.toLowerCase())
      throw new Error('Inconsistent refund document currency.');
    const invoice = await db.query<{
      id: string;
      currency: string;
      stripe_payment_intent_id: string | null;
      total_cents: number;
    }>(
      `SELECT id,currency,stripe_payment_intent_id,total_cents FROM sponsorship_invoices
       WHERE contribution_id=$1 FOR UPDATE`,
      [contribution.id]
    );
    const invoiceRow = invoice.rows[0];
    if (!invoiceRow) throw new Error('REFUND_INVOICE_REQUIRED');
    if (
      invoiceRow.currency.toLowerCase() !== refund.currency.toLowerCase() ||
      invoiceRow.stripe_payment_intent_id !== paymentIntentId
    )
      throw new Error('Inconsistent refund invoice references.');
    const existing = await db.query<{
      contribution_id: string;
      total_cents: number;
    }>(
      'SELECT contribution_id,total_cents FROM sponsorship_credit_notes WHERE stripe_refund_id=$1',
      [refund.id]
    );
    if (existing.rows[0]) {
      if (
        existing.rows[0].contribution_id !== contribution.id ||
        Number(existing.rows[0].total_cents) !== refund.amount
      )
        throw new Error('Inconsistent refund document facts.');
      return true;
    }
    const issued = await db.query<{ total: string }>(
      'SELECT COALESCE(SUM(total_cents),0)::text AS total FROM sponsorship_credit_notes WHERE invoice_id=$1',
      [invoiceRow.id]
    );
    if (
      Number(issued.rows[0]?.total ?? 0) + refund.amount >
      Number(invoiceRow.total_cents)
    )
      throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');
    const note = await createSponsorshipCreditNoteForRefund(db, {
      contributionId: contribution.id,
      stripeRefundId: refund.id,
      refundAmountCents: refund.amount
    });
    // Keep the confirmed journal durable, but do not acknowledge a complete
    // reconciliation before the invoice is recovered and the document can issue.
    if (!note) throw new Error('REFUND_INVOICE_REQUIRED');
    await db.query(
      `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
       VALUES($1,'sponsorship_refund.credit_note','sponsorship',$2,$3::jsonb)`,
      [
        source === 'stripe' ? 'stripe-webhook' : 'stripe-backfill',
        contribution.id,
        JSON.stringify({
          refundId: refund.id,
          creditNoteId: note.id,
          paymentIntentId
        })
      ]
    );
    return true;
  });
};

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
    authoritativeRefund?: Stripe.Refund;
    refundOperationId?: string;
  }
): Promise<{
  seen: number;
  inserted: number;
  existing: number;
  statusUpdated: boolean;
  creditNoteAvailable: boolean;
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
  if (input.authoritativeRefund) {
    const refund = input.authoritativeRefund;
    const chargeId =
      typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
    const intentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (chargeId !== charge.id || intentId !== input.paymentIntentId) {
      throw new Error('Inconsistent Stripe refund references.');
    }
    const index = refunds.findIndex((snapshot) => snapshot.id === refund.id);
    if (index < 0) refunds.push(refund);
    else refunds[index] = refund;
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
    const failedOperation = pool
      ? await pool.query(
          `SELECT 1 FROM sponsorship_refund_operations WHERE status='failed'
       AND (stripe_refund_id=$1 OR id::text=$2) LIMIT 1`,
          [refund.id, refund.metadata?.openg7RefundOperationId ?? null]
        )
      : null;
    if (failedOperation?.rowCount)
      throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');
  }
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
        refundOperationId:
          (refund.id === input.authoritativeRefund?.id
            ? input.refundOperationId
            : undefined) ??
          refund.metadata?.openg7RefundOperationId ??
          null,
        paymentIntentId: input.paymentIntentId,
        eventType: 'charge.refunded',
        ...(input.eventId ? { stripeEventId: input.eventId } : {})
      }
    });
    if (added) inserted++;
    else existing++;
  }
  let statusUpdated = false;
  let creditNoteAvailable = false;
  if (!input.dryRun) {
    for (const refund of refunds) {
      // Expanded fixtures/older API snapshots can omit the redundant PaymentIntent reference.
      await settleSponsorshipRefundOperation(
        pool,
        {
          ...refund,
          payment_intent: refund.payment_intent ?? input.paymentIntentId
        },
        refund.id === input.authoritativeRefund?.id
          ? input.refundOperationId
          : undefined
      );
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
    for (const refund of confirmed) {
      creditNoteAvailable =
        (await ensureStripeRefundCreditNote(
          pool,
          refund,
          input.paymentIntentId,
          input.source
        )) || creditNoteAvailable;
    }
  }
  return {
    seen: confirmed.length,
    inserted,
    existing,
    statusUpdated,
    creditNoteAvailable
  };
}
