import { createHmac, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export interface OperationsIncident {
  key: string;
  type: string;
}
export interface OperationsAlertConfig {
  webhook: string;
  secret: string;
  adminOrigin: string;
}
export const operationsAlertConfig = (
  env: NodeJS.ProcessEnv
): OperationsAlertConfig | null => {
  if (!env.FUNDING_OPERATIONS_WEBHOOK_URL) return null;
  const webhook = new URL(env.FUNDING_OPERATIONS_WEBHOOK_URL);
  const origin = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
  const local =
    env.NODE_ENV !== 'production' &&
    webhook.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(webhook.hostname);
  if (
    (webhook.protocol !== 'https:' && !local) ||
    webhook.username ||
    webhook.password ||
    !env.FUNDING_OPERATIONS_WEBHOOK_SECRET ||
    env.FUNDING_OPERATIONS_WEBHOOK_SECRET.length < 32
  )
    throw new Error(
      'Operations webhook requires HTTPS and a signing secret of at least 32 characters.'
    );
  return {
    webhook: webhook.href,
    secret: env.FUNDING_OPERATIONS_WEBHOOK_SECRET,
    adminOrigin: origin.origin
  };
};
export const detectOperationsIncidents = async (
  pool: Pool
): Promise<OperationsIncident[]> => {
  const result = await pool.query(`SELECT 'stripe:' || stripe_event_id AS key,
    CASE WHEN processing_status='failed' THEN 'stripe_event_failed' ELSE 'stripe_event_stalled' END AS type
    FROM stripe_events WHERE processing_status='failed' OR
      (processing_status='processing' AND received_at<now()-interval '15 minutes')
    UNION ALL SELECT 'email:' || id::text AS key,'email_delivery_failed' AS type FROM email_messages WHERE status='failed'`);
  return result.rows;
};
export const syncOperationsIncidents = async (
  pool: Pool,
  incidents: readonly OperationsIncident[]
): Promise<void> => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('LOCK TABLE operations_alerts IN SHARE ROW EXCLUSIVE MODE');
    await db.query(
      'UPDATE operations_alerts SET resolved_at=now() WHERE resolved_at IS NULL AND NOT (incident_key=ANY($1::text[]))',
      [incidents.map((i) => i.key)]
    );
    for (const incident of incidents)
      await db.query(
        `INSERT INTO operations_alerts (incident_key,incident_type) VALUES ($1,$2)
      ON CONFLICT (incident_key) WHERE resolved_at IS NULL DO NOTHING`,
        [incident.key, incident.type]
      );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
};
export const sendOperationsAlert = async (
  config: OperationsAlertConfig,
  input: {
    id: string;
    type: string;
    createdAt: string;
  }
): Promise<void> => {
  // Deliberately excludes names, recipients, provider errors and external payment IDs.
  const body = JSON.stringify({
    eventId: input.id,
    type: input.type,
    severity: 'urgent',
    firstSeen: input.createdAt,
    adminUrl: `${config.adminOrigin}/admin/fundraiser/attention`
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const response = await fetch(config.webhook, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'X-OpenG7-Event-Id': input.id,
      'X-OpenG7-Timestamp': timestamp,
      'X-OpenG7-Signature': signature
    },
    body
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Operations receiver refused the alert.');
};
export const deliverOperationsAlerts = async (
  pool: Pool,
  config: OperationsAlertConfig
): Promise<number> => {
  let delivered = 0;
  // A lease survives worker crashes. The stable event ID permits receiver-side deduplication after ambiguous delivery.
  for (let i = 0; i < 20; i++) {
    const lease = randomUUID();
    const result = await pool.query(
      `UPDATE operations_alerts SET lease_until=now()+interval '1 minute',lease_token=$1,attempts=attempts+1
      WHERE id=(SELECT id FROM operations_alerts WHERE resolved_at IS NULL AND delivered_at IS NULL
        AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at
        FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,incident_type,created_at,attempts`,
      [lease]
    );
    const alert = result.rows[0];
    if (!alert) break;
    try {
      await sendOperationsAlert(config, {
        id: alert.id,
        type: alert.incident_type,
        createdAt: alert.created_at.toISOString()
      });
      await pool.query(
        'UPDATE operations_alerts SET delivered_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2',
        [alert.id, lease]
      );
      delivered++;
    } catch {
      const retrySeconds = Math.min(
        3600,
        30 * 2 ** Math.min(alert.attempts, 7)
      );
      await pool.query(
        `UPDATE operations_alerts SET lease_until=NULL,next_attempt_at=now()+($3 * interval '1 second')
        WHERE id=$1 AND lease_token=$2`,
        [alert.id, lease, retrySeconds]
      );
    }
  }
  return delivered;
};
