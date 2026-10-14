import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import type { AdminEmailQueueRetryRequest } from '@openg7/funding-core';

import {
  claimAdminEmailQueueRetry,
  markEmailUncertain
} from './email-queue.repository.js';
import { insertAdminAuditLog } from './fund-admin-audit.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import {
  deliverClaimedEmailMessages,
  snapshotEmailDependencies,
  type EmailQueueProcessResult
} from './services/email/email-queue.service.js';
import type { EmailServiceDependencies } from './services/email/email.types.js';

export class AdminEmailRetryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

/** Reuses the existing queue: commit intent and claim before any SMTP call. */
export async function retryAdminEmailWithAudit(
  pool: Pool,
  input: AdminEmailQueueRetryRequest,
  actor: string,
  emailDependencies: EmailServiceDependencies = {}
): Promise<EmailQueueProcessResult & { requestId: string; replayed: boolean }> {
  const requestId = input.requestId?.toLowerCase() ?? randomUUID();
  const deliveryAttemptId = randomUUID();
  const prepared = await withPostgresTransaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'admin-email-retry:' + requestId
    ]);
    const prior = (
      await db.query<{
        actor: string;
        entity_id: string;
        metadata: { deliveryAttemptId: string; attempted: number };
      }>(
        `SELECT actor,entity_id,metadata FROM admin_audit_log
      WHERE action='email_queue.retry' AND metadata->>'requestId'=$1 LIMIT 1`,
        [requestId]
      )
    ).rows[0];
    if (prior) {
      if (prior.actor !== actor || prior.entity_id !== input.messageId)
        throw new AdminEmailRetryError(409, 'EMAIL_RETRY_REQUEST_CONFLICT');
      const completed = (
        await db.query<{ metadata: { result: EmailQueueProcessResult } }>(
          `SELECT metadata FROM admin_audit_log WHERE action='email_queue.retry.result'
         AND metadata->>'requestId'=$1 ORDER BY created_at DESC LIMIT 1`,
          [requestId]
        )
      ).rows[0];
      if (completed) return { replay: completed.metadata.result, rows: [] };
      const current = (
        await db.query<{ status: string; delivery_attempt_id: string | null }>(
          'SELECT status,delivery_attempt_id FROM email_messages WHERE id=$1',
          [input.messageId]
        )
      ).rows[0];
      const sameAttempt =
        current?.delivery_attempt_id === prior.metadata.deliveryAttemptId;
      const sent = sameAttempt && current?.status === 'sent';
      const failed =
        sameAttempt && ['failed', 'uncertain'].includes(current?.status ?? '');
      return {
        replay: {
          attempted: prior.metadata.attempted,
          sent: sent ? 1 : 0,
          failed: failed ? 1 : 0,
          messageIds: prior.metadata.attempted ? [input.messageId] : [],
          sentMessageIds: sent ? [input.messageId] : [],
          failedMessageIds: failed ? [input.messageId] : []
        },
        rows: []
      };
    }
    const message = (
      await db.query<{ status: string }>(
        'SELECT status FROM email_messages WHERE id=$1 FOR UPDATE',
        [input.messageId]
      )
    ).rows[0];
    if (!message)
      throw new AdminEmailRetryError(404, 'EMAIL_MESSAGE_NOT_FOUND');
    if (message.status === 'sent')
      throw new AdminEmailRetryError(409, 'EMAIL_ALREADY_SENT');
    if (message.status === 'uncertain')
      throw new AdminEmailRetryError(
        409,
        'EMAIL_DELIVERY_RECONCILIATION_REQUIRED'
      );
    const attempted = ['queued', 'failed'].includes(message.status) ? 1 : 0;
    const intention = await insertAdminAuditLog(db, {
      actor,
      action: 'email_queue.retry',
      entityType: 'email_message',
      entityId: input.messageId,
      summary: 'Manual email retry requested.',
      metadata: {
        requestId,
        deliveryAttemptId,
        attempted,
        result: 'requested'
      }
    });
    if (!intention)
      throw new AdminEmailRetryError(503, 'EMAIL_RETRY_AUDIT_REQUIRED');
    const rows = await claimAdminEmailQueueRetry(
      db,
      input.messageId,
      deliveryAttemptId
    );
    return { replay: null, rows };
  });
  if (prepared.replay) return { ...prepared.replay, requestId, replayed: true };
  let result: EmailQueueProcessResult;
  try {
    result = await deliverClaimedEmailMessages(
      pool,
      prepared.rows,
      snapshotEmailDependencies(emailDependencies)
    );
  } catch {
    // SMTP may already have accepted the message. Preserve the intent and quarantine
    // the existing claim; neither an HTTP replay nor the worker may send it again.
    await markEmailUncertain(pool, input.messageId, deliveryAttemptId).catch(
      () => undefined
    );
    throw new AdminEmailRetryError(503, 'EMAIL_RETRY_RESULT_UNAVAILABLE');
  }
  try {
    const recorded = await insertAdminAuditLog(pool, {
      actor,
      action: 'email_queue.retry.result',
      entityType: 'email_message',
      entityId: input.messageId,
      summary: 'Manual email retry result.',
      metadata: { requestId, deliveryAttemptId, result }
    });
    if (!recorded) throw new Error('EMAIL_RETRY_RESULT_UNAVAILABLE');
  } catch {
    throw new AdminEmailRetryError(503, 'EMAIL_RETRY_RESULT_UNAVAILABLE');
  }
  return { ...result, requestId, replayed: false };
}
