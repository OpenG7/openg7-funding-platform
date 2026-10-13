import type { Pool } from 'pg';
import type Stripe from 'stripe';

import { resolvePaymentIntentId } from './stripe-object-normalization.js';
import { stripeEventBelongsToProject } from './stripe-project-scope.js';

const resolved = (status: Stripe.Dispute.Status): boolean =>
  status === 'won' || status === 'warning_closed';

const disputePaymentIntentId = async (
  stripe: Stripe,
  dispute: Stripe.Dispute
): Promise<string | null> => {
  const intentId = resolvePaymentIntentId(dispute.payment_intent);
  if (intentId) return intentId;
  const chargeId =
    typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  return chargeId
    ? resolvePaymentIntentId(
        (await stripe.charges.retrieve(chargeId)).payment_intent
      )
    : null;
};

const disputeDeliveryScopeSql = `EXISTS (
           SELECT 1 FROM sponsor_publication_drafts draft JOIN fund_contributions c ON c.id=draft.contribution_id
           WHERE draft.batch_id=delivery.batch_id AND c.stripe_payment_intent_id=$1
             AND ($2::boolean IS FALSE OR c.status='disputed' OR c.id::text=ANY($3::text[])))`;

const disputeAuditActor = (source: 'stripe' | 'stripe_backfill'): string =>
  source === 'stripe' ? 'stripe-webhook' : 'stripe-backfill';

/** Reconcile current provider facts after serializing all disputes of one payment. */
export const reconcileStripeDispute = async (
  stripe: Stripe,
  pool: Pool | null,
  snapshot: Stripe.Dispute,
  input: {
    projectId: string;
    source: 'stripe' | 'stripe_backfill';
    allowUnmatched?: boolean;
  }
): Promise<boolean> => {
  if (!pool) return false;
  const intentId = await disputePaymentIntentId(stripe, snapshot);
  if (!intentId) throw new Error('STRIPE_DISPUTE_PAYMENT_REQUIRED');
  const db = await pool.connect();
  let locked = false;
  let transaction = false;
  try {
    await db.query('SELECT pg_advisory_lock(hashtextextended($1::text,0))', [
      `stripe-disputes:${intentId}`
    ]);
    locked = true;
    const dispute = await stripe.disputes.retrieve(snapshot.id);
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const currentIntentId = await disputePaymentIntentId(stripe, dispute);
    if (
      dispute.id !== snapshot.id ||
      currentIntentId !== intentId ||
      !dispute.status ||
      intent.id !== intentId
    )
      throw new Error('Inconsistent Stripe dispute references.');
    if (
      !Number.isSafeInteger(dispute.amount) ||
      dispute.amount <= 0 ||
      dispute.amount > intent.amount ||
      dispute.currency.toLowerCase() !== intent.currency.toLowerCase()
    )
      throw new Error('Inconsistent Stripe dispute monetary facts.');
    if (
      !input.allowUnmatched &&
      !(await stripeEventBelongsToProject(
        {
          type: 'charge.dispute.updated',
          data: { object: { ...dispute, payment_intent: intent } }
        },
        stripe,
        pool,
        input.projectId
      ))
    )
      return false;

    let paid = resolved(dispute.status) && intent.status === 'succeeded';
    if (paid) {
      let scanned = 0;
      let currentSeen = false;
      // A won dispute cannot erase a second open/lost dispute. Auto-pagination
      // remains bounded; an incomplete scan must never authorize restoration.
      for await (const related of stripe.disputes.list({
        payment_intent: intentId,
        limit: 100
      })) {
        if (++scanned > 100) throw new Error('STRIPE_DISPUTE_LIMIT_REACHED');
        if (resolvePaymentIntentId(related.payment_intent) !== intentId)
          throw new Error('Inconsistent Stripe dispute references.');
        currentSeen ||= related.id === dispute.id;
        paid &&= resolved(related.status);
      }
      if (!currentSeen)
        throw new Error('STRIPE_DISPUTE_RECONCILIATION_INCOMPLETE');
    }
    await db.query('BEGIN');
    transaction = true;
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'payment-confirmation:' + intentId
    ]);
    const local = await db.query<{
      id: string;
      amount_cents: number;
      currency: string;
    }>(
      'SELECT id,amount_cents,currency FROM fund_contributions WHERE stripe_payment_intent_id=$1',
      [intentId]
    );
    if (!local.rows.length)
      throw new Error('STRIPE_DISPUTE_CONTRIBUTION_REQUIRED');
    if (
      local.rows.some(
        (row) =>
          Number(row.amount_cents) !==
            (intent.amount_received || intent.amount) ||
          row.currency.toLowerCase() !== intent.currency.toLowerCase()
      )
    )
      throw new Error('Inconsistent Stripe dispute payment facts.');
    const reconciled = await db.query<{ entity_id: string }>(
      `SELECT entity_id FROM admin_audit_log WHERE action='contribution.dispute_reconciled'
       AND entity_type='contribution' AND metadata->>'disputeId'=$1 AND entity_id=ANY($2::text[])`,
      [dispute.id, local.rows.map((row) => row.id)]
    );
    const seen = new Set(reconciled.rows.map((row) => row.entity_id));
    const firstReconciliations = local.rows
      .filter((row) => !seen.has(row.id))
      .map((row) => row.id);
    {
      // Financial resolution grants no editorial authorization. Existing
      // approvals need a fresh human decision even if no worker saw the dispute.
      const invalidated = await db.query<{ id: string }>(
        `UPDATE publication_deliveries delivery SET status='blocked',approved_at=NULL,approved_by=NULL,auto_managed=FALSE,
          error_code='PAYMENT_REVIEW_REQUIRED',version=version+1,updated_at=NOW()
         WHERE delivery.status IN ('draft','approved','blocked') AND error_code IS DISTINCT FROM 'PAYMENT_REVIEW_REQUIRED' AND ${disputeDeliveryScopeSql} RETURNING delivery.id`,
        [intentId, paid, firstReconciliations]
      );
      const inFlight = await db.query<{ id: string }>(
        `UPDATE publication_deliveries delivery SET error_code='PAYMENT_REVIEW_REQUIRED',updated_at=NOW()
         WHERE delivery.status IN ('publishing','uncertain') AND error_code IS DISTINCT FROM 'PAYMENT_REVIEW_REQUIRED' AND ${disputeDeliveryScopeSql} RETURNING delivery.id`,
        [intentId, paid, firstReconciliations]
      );
      for (const delivery of [...invalidated.rows, ...inFlight.rows])
        await db.query(
          `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
         VALUES($1,'publication_automation.source_invalidated','publication_delivery',$2,$3::jsonb)`,
          [
            disputeAuditActor(input.source),
            delivery.id,
            JSON.stringify({
              paymentIntentId: intentId,
              disputeId: dispute.id,
              code: 'PAYMENT_REVIEW_REQUIRED'
            })
          ]
        );
    }
    const updated = await db.query<{ id: string }>(
      paid
        ? `UPDATE fund_contributions c SET status='paid',updated_at=NOW(),
            sponsor_site_visibility_held=CASE WHEN contribution_type='sponsorship_interest' THEN true ELSE sponsor_site_visibility_held END
           WHERE stripe_payment_intent_id=$1 AND (status='disputed' OR (status='paid' AND id::text=ANY($4::text[])))
             AND paid_at IS NOT NULL AND amount_cents=$2 AND lower(currency)=lower($3)
             AND NOT EXISTS (SELECT 1 FROM fund_transactions r WHERE r.type='charge.refunded'
               AND r.status='succeeded' AND r.metadata_json->>'paymentIntentId'=$1
               GROUP BY r.metadata_json->>'paymentIntentId' HAVING SUM(r.amount)>=c.amount_cents)
           RETURNING id`
        : `UPDATE fund_contributions SET status=$2,updated_at=NOW(),
            sponsor_site_visibility_held=CASE WHEN contribution_type='sponsorship_interest' THEN true ELSE sponsor_site_visibility_held END
           WHERE stripe_payment_intent_id=$1 AND status IN ('pending','expired','failed','paid') RETURNING id`,
      paid
        ? [
            intentId,
            intent.amount_received || intent.amount,
            intent.currency,
            firstReconciliations
          ]
        : [intentId, 'disputed']
    );
    if (updated.rowCount) {
      await db.query(
        `UPDATE stripe_checkout_sessions SET status=$2,updated_at=NOW()
         WHERE stripe_payment_intent_id=$1 AND status=ANY($3::text[])`,
        [
          intentId,
          paid ? 'paid' : 'disputed',
          paid ? ['disputed'] : ['pending', 'expired', 'failed', 'paid']
        ]
      );
      for (const contribution of updated.rows)
        await db.query(
          `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
         VALUES($1,$2,'contribution',$3,$4::jsonb)`,
          [
            disputeAuditActor(input.source),
            paid ? 'contribution.dispute_resolved' : 'contribution.disputed',
            contribution.id,
            JSON.stringify({
              disputeId: dispute.id,
              paymentIntentId: intentId,
              providerStatus: dispute.status
            })
          ]
        );
    }
    // This durable marker also covers a won-first event that never changed the
    // payment status. Replays must not revoke a newer explicit authorization.
    for (const id of firstReconciliations)
      await db.query(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
       VALUES($1,'contribution.dispute_reconciled','contribution',$2,$3::jsonb)`,
        [
          disputeAuditActor(input.source),
          id,
          JSON.stringify({
            disputeId: dispute.id,
            paymentIntentId: intentId,
            providerStatus: dispute.status
          })
        ]
      );
    await db.query('COMMIT');
    transaction = false;
    return (updated.rowCount ?? 0) > 0;
  } catch (error) {
    if (transaction) await db.query('ROLLBACK');
    throw error;
  } finally {
    try {
      if (locked) {
        const unlock = await db.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1::text,0)) AS unlocked',
          [`stripe-disputes:${intentId}`]
        );
        if (!unlock.rows[0]?.unlocked)
          throw new Error('Dispute reconciliation unlock failed.');
      }
      db.release();
    } catch (error) {
      db.release(true);
      throw error;
    }
  }
};
