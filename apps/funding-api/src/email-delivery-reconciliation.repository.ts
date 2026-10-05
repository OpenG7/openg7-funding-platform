import type { Pool } from 'pg';
import type { AdminEmailDeliveryReconcileRequest } from '@openg7/funding-core';

/** Reconciliation changes only the delivery state, never sends or duplicates a message. */
export const reconcileEmailDelivery = async (
  pool: Pool | null,
  input: AdminEmailDeliveryReconcileRequest,
  actor: string
): Promise<boolean> => {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const changed = await client.query(
      `UPDATE email_messages SET status=$3,
         sent_at=CASE WHEN $3='sent' THEN NOW() ELSE NULL END,
         next_attempt_at=NOW(),
         attempts=CASE WHEN $3='failed' THEN max_attempts ELSE attempts END,
         last_error=CASE WHEN $3='sent' THEN NULL ELSE 'EMAIL_DELIVERY_RECONCILED_NOT_SENT' END,
         delivery_attempt_id=NULL, updated_at=NOW()
       WHERE id=$1::uuid AND status='uncertain' AND updated_at=$2::timestamptz
       RETURNING id`,
      [
        input.messageId,
        input.expectedUpdatedAt,
        input.outcome === 'sent' ? 'sent' : 'failed'
      ]
    );
    if (changed.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    const audit = await client.query(
      `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
       VALUES($1,'email_queue.reconcile','email_message',$2,'Email delivery reconciled.',$3::jsonb)`,
      [
        actor,
        input.messageId,
        JSON.stringify({
          outcome: input.outcome,
          evidenceReference: input.evidenceReference
        })
      ]
    );
    if (audit.rowCount !== 1)
      throw new Error('EMAIL_RECONCILIATION_AUDIT_REQUIRED');
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
