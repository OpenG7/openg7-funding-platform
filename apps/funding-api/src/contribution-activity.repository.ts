import type { Pool, PoolClient } from 'pg';

/** Historical confirmations have a marker but no activity and must stay silent. */
export async function hasContributionActivityForSession(
  db: Pool,
  sessionId: string
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM contribution_activity activity
     JOIN fund_contributions contribution ON contribution.id=activity.contribution_id
     WHERE contribution.stripe_session_id=$1 LIMIT 1`,
    [sessionId]
  );
  return result.rowCount === 1;
}

/** Caller owns the payment transaction. Serializing insertions makes IDs safe cursors. */
export async function recordContributionActivity(
  db: PoolClient,
  sessionId: string | null,
  paymentIntentId: string | null,
  notify: boolean
): Promise<void> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('contribution-activity-insert'))"
  );
  const changed = await db.query<{
    id: string;
    amount_cents: number;
    currency: string;
    paid_at: Date;
  }>(
    `UPDATE fund_contributions SET payment_notification_recorded_at=NOW()
     WHERE (($1::text IS NOT NULL AND stripe_session_id=$1) OR ($2::text IS NOT NULL AND stripe_payment_intent_id=$2))
       AND status='paid' AND payment_notification_recorded_at IS NULL
     RETURNING id,amount_cents,currency,paid_at`,
    [sessionId, paymentIntentId]
  );
  if (!notify) return;
  for (const c of changed.rows)
    await db.query(
      `INSERT INTO contribution_activity(contribution_id,amount_minor,currency,confirmed_at)
     VALUES($1,$2,$3,COALESCE($4,NOW())) ON CONFLICT(contribution_id) DO NOTHING`,
      [c.id, c.amount_cents, c.currency, c.paid_at]
    );
}
