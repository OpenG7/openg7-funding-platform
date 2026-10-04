import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type Stripe from 'stripe';
import type { AdminSponsorshipStripeRefundReason } from '@openg7/funding-core';

import { updateSponsorshipRefundWorkflowStatus } from './fund-contributions.repository.js';

export class SponsorshipRefundOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function audit(
  db: PoolClient,
  actor: string,
  action: string,
  target: string,
  id: string
) {
  await db.query(
    `INSERT INTO admin_audit_log (actor,action,entity_type,entity_id,metadata)
     VALUES ($1,$2,'sponsorship',$3,jsonb_build_object('operationId',$4::text))`,
    [actor, 'sponsorship_refund.' + action, target, id]
  );
}

/** The claim, version check and audit commit before any provider request. */
export async function beginSponsorshipRefundOperation(
  pool: Pool,
  input: {
    contributionId: string;
    expectedVersion: string;
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
    reason: AdminSponsorshipStripeRefundReason;
    note: string | null;
    actor: string;
  }
): Promise<string> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const row = (
      await db.query(
        `SELECT updated_at::text AS version,status,sponsorship_refund_status
       FROM fund_contributions WHERE id=$1 FOR UPDATE`,
        [input.contributionId]
      )
    ).rows[0];
    if (!row || row.version !== input.expectedVersion)
      throw new SponsorshipRefundOperationError(
        'SPONSORSHIP_CONCURRENT_UPDATE'
      );
    const unresolved = await db.query(
      `SELECT id FROM sponsorship_refund_operations WHERE contribution_id=$1
       AND status IN ('submitting','uncertain','pending')`,
      [input.contributionId]
    );
    if (
      row.status !== 'paid' ||
      row.sponsorship_refund_status === 'processing' ||
      unresolved.rowCount
    )
      throw new SponsorshipRefundOperationError(
        'SPONSORSHIP_REFUND_NOT_ELIGIBLE'
      );
    const id = randomUUID();
    await db.query(
      `INSERT INTO sponsorship_refund_operations
       (id,contribution_id,expected_version,payment_intent_id,amount_minor,currency,reason,actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.contributionId,
        input.expectedVersion,
        input.paymentIntentId,
        input.amountMinor,
        input.currency.toLowerCase(),
        input.reason,
        input.actor
      ]
    );
    await updateSponsorshipRefundWorkflowStatus(db, {
      contributionId: input.contributionId,
      refundStatus: 'processing',
      refundAmountCents: input.amountMinor,
      refundReason: input.reason,
      refundNote: input.note
    });
    await audit(db, input.actor, 'started', input.contributionId, id);
    await db.query('COMMIT');
    return id;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function failSponsorshipRefundOperation(
  pool: Pool,
  id: string,
  definitive: boolean
): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT c.id FROM fund_contributions c JOIN sponsorship_refund_operations o ON o.contribution_id=c.id
       WHERE o.id=$1 FOR UPDATE OF c`,
      [id]
    );
    const row = (
      await db.query(
        `UPDATE sponsorship_refund_operations SET status=$2,updated_at=NOW()
       WHERE id=$1 AND status='submitting' RETURNING contribution_id,actor`,
        [id, definitive ? 'failed' : 'uncertain']
      )
    ).rows[0];
    if (row) {
      if (definitive)
        await updateSponsorshipRefundWorkflowStatus(db, {
          contributionId: row.contribution_id,
          refundStatus: 'failed',
          refundError: 'STRIPE_REFUND_REJECTED'
        });
      await audit(
        db,
        row.actor,
        definitive ? 'failed' : 'uncertain',
        row.contribution_id,
        id
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/** Resolve only the matching durable operation; an unrelated refund cannot unlock it. */
export async function settleSponsorshipRefundOperation(
  pool: Pool | null,
  refund: Stripe.Refund,
  operationId = refund.metadata?.openg7RefundOperationId
): Promise<boolean> {
  if (!pool) return false;
  const intentId =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize operation failure with insertion of its confirmed financial fact.
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`fund-refund:${refund.id}`]
    );
    const contributions = await db.query(
      `SELECT id,sponsorship_refund_id,sponsorship_refund_status FROM fund_contributions
       WHERE stripe_payment_intent_id=$1 FOR UPDATE`,
      [intentId ?? null]
    );
    let status =
      refund.status === 'succeeded'
        ? 'succeeded'
        : ['failed', 'canceled'].includes(refund.status ?? '')
          ? 'failed'
          : 'pending';
    if (status === 'failed') {
      const confirmed = await db.query(
        `SELECT 1 FROM fund_transactions WHERE type='charge.refunded' AND status='succeeded'
         AND metadata_json->>'refundId'=$1 LIMIT 1`,
        [refund.id]
      );
      if (confirmed.rowCount)
        throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');
    }
    if (operationId) {
      const operation = (
        await db.query(
          'SELECT * FROM sponsorship_refund_operations WHERE id::text=$1 FOR UPDATE',
          [operationId]
        )
      ).rows[0];
      if (operation) {
        if (
          operation.payment_intent_id !== intentId ||
          Number(operation.amount_minor) !== refund.amount ||
          operation.currency !== refund.currency.toLowerCase() ||
          (operation.stripe_refund_id &&
            operation.stripe_refund_id !== refund.id)
        )
          throw new Error('Inconsistent Stripe refund operation.');
        // A delayed pending snapshot must not erase a terminal provider outcome.
        if (['succeeded', 'failed'].includes(operation.status)) {
          status = operation.status;
        } else if (status !== operation.status) {
          await db.query(
            'UPDATE sponsorship_refund_operations SET status=$2,stripe_refund_id=$3,updated_at=NOW() WHERE id=$1',
            [operation.id, status, refund.id]
          );
          await audit(
            db,
            operation.actor,
            status,
            operation.contribution_id,
            operation.id
          );
        }
      }
    }
    const unresolved = await db.query(
      `SELECT id FROM sponsorship_refund_operations WHERE contribution_id=ANY($1::uuid[])
       AND status IN ('submitting','uncertain','pending') AND id::text IS DISTINCT FROM $2`,
      [contributions.rows.map((row) => row.id), operationId ?? null]
    );
    if (!unresolved.rowCount) {
      for (const contribution of contributions.rows) {
        const latest = (
          await db.query(
            `SELECT id::text FROM sponsorship_refund_operations WHERE contribution_id=$1
           ORDER BY created_at DESC,id DESC LIMIT 1`,
            [contribution.id]
          )
        ).rows[0];
        // An older or unrelated refund must not replace the current admin operation.
        if (latest && latest.id !== operationId) continue;
        if (!latest && contribution.sponsorship_refund_id) {
          if (
            contribution.sponsorship_refund_id === refund.id &&
            ['completed', 'failed'].includes(
              contribution.sponsorship_refund_status
            )
          )
            continue;
          const newer = await db.query(
            `SELECT 1 FROM fund_transactions WHERE type='charge.refunded'
             AND metadata_json->>'refundId'=$1 AND created_at>to_timestamp($2) LIMIT 1`,
            [contribution.sponsorship_refund_id, refund.created]
          );
          if (newer.rowCount) continue;
        }
        await updateSponsorshipRefundWorkflowStatus(db, {
          contributionId: contribution.id,
          refundStatus:
            status === 'succeeded'
              ? 'completed'
              : status === 'failed'
                ? 'failed'
                : 'processing',
          refundId: refund.id,
          refundAmountCents: refund.amount,
          refundError: status === 'failed' ? 'STRIPE_REFUND_REJECTED' : null
        });
      }
    }
    await db.query('COMMIT');
    return !unresolved.rowCount;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
