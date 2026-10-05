import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type { AdminEmailTestResult } from '@openg7/funding-core';

import { hasEmailMessagesTable } from './email-queue.persistence.js';
import {
  protectPrivateText,
  revealPrivateText,
  protectEmailMetadata
} from './private-data-protection.js';

export {
  getAdminEmailQueueMessageById,
  listAdminEmailQueue,
  getEmailQueueStatus
} from './email-queue-read.repository.js';
export type { EmailQueueStatus } from './email-queue-read.repository.js';

export interface EmailQueueInsertInput {
  readonly templateKey: string;
  readonly to: string;
  readonly fromEmail: string;
  readonly replyToEmail: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly metadata: Record<string, unknown>;
  readonly idempotencyKey?: string;
  readonly maxAttempts: number;
}

export interface EmailQueueInsertResult {
  readonly queued: boolean;
  readonly duplicate: boolean;
  readonly messageId: string | null;
  readonly status: string | null;
  readonly error: string | null;
}

interface ClaimedEmailRow {
  readonly id: string;
  readonly recipient_email: string;
  readonly from_email: string;
  readonly reply_to_email: string | null;
  readonly subject: string;
  readonly text_body: string;
  readonly html_body: string;
  readonly attempts: number;
  readonly max_attempts: number;
}

/** A durable claim exposes only the fields needed to deliver and settle the attempt. */
export interface ClaimedEmailMessage {
  readonly id: string;
  readonly to: string;
  readonly fromEmail: string;
  readonly replyToEmail: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface EmailQueueClaimOptions {
  readonly limit: number;
  readonly messageIds?: readonly string[];
}

const projectClaimedEmailMessage = (
  row: ClaimedEmailRow
): ClaimedEmailMessage => ({
  id: row.id,
  to: row.recipient_email,
  fromEmail: row.from_email,
  replyToEmail: row.reply_to_email,
  subject: revealPrivateText(row.subject, `email:${row.id}:subject`),
  text: revealPrivateText(row.text_body, `email:${row.id}:text`),
  html: revealPrivateText(row.html_body, `email:${row.id}:html`),
  attempts: row.attempts,
  maxAttempts: row.max_attempts
});

export const insertEmailQueueMessage = async (
  pool: Pool | PoolClient | null,
  input: EmailQueueInsertInput
): Promise<EmailQueueInsertResult> => {
  if (!pool) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      status: null,
      error: 'Email queue requires DATABASE_URL.'
    };
  }

  const id = randomUUID();
  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO email_messages (
        idempotency_key,
        template_key,
        recipient_email,
        from_email,
        reply_to_email,
        subject,
        text_body,
        html_body,
        metadata,
        max_attempts,
        id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::uuid)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `,
    [
      input.idempotencyKey ?? null,
      input.templateKey,
      input.to,
      input.fromEmail,
      input.replyToEmail,
      protectPrivateText(input.subject, `email:${id}:subject`),
      protectPrivateText(input.text, `email:${id}:text`),
      protectPrivateText(input.html, `email:${id}:html`),
      JSON.stringify(protectEmailMetadata(input.metadata, id)),
      input.maxAttempts,
      id
    ]
  );

  const inserted = insert.rows[0];
  if (inserted) {
    return {
      queued: true,
      duplicate: false,
      messageId: inserted.id,
      status: 'queued',
      error: null
    };
  }

  if (!input.idempotencyKey) {
    return {
      queued: false,
      duplicate: false,
      messageId: null,
      status: null,
      error: 'Email message was not queued.'
    };
  }

  const existing = await pool.query<{ id: string; status: string }>(
    `
      SELECT id, status
      FROM email_messages
      WHERE idempotency_key = $1
      LIMIT 1
    `,
    [input.idempotencyKey]
  );
  const row = existing.rows[0] ?? null;

  return {
    queued: row?.status !== 'sent',
    duplicate: true,
    messageId: row?.id ?? null,
    status: row?.status ?? null,
    error: null
  };
};

export const claimQueuedEmailMessages = async (
  pool: Pool,
  options: EmailQueueClaimOptions
): Promise<readonly ClaimedEmailMessage[]> => {
  const params: unknown[] = [options.limit];
  const idFilter =
    options.messageIds && options.messageIds.length > 0
      ? 'AND id = ANY($2::uuid[])'
      : '';

  if (idFilter) {
    params.push(options.messageIds);
  }

  const query = await pool.query<ClaimedEmailRow>(
    `
      WITH selected AS (
        SELECT id
        FROM email_messages
        WHERE (
            (
              status IN ('queued', 'failed')
              AND next_attempt_at <= NOW()
            )
            OR (
              status = 'sending'
              AND updated_at <= NOW() - INTERVAL '15 minutes'
            )
          )
          AND attempts < max_attempts
          ${idFilter}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE email_messages
      SET
        status = 'sending',
        attempts = attempts + 1,
        updated_at = NOW()
      FROM selected
      WHERE email_messages.id = selected.id
      RETURNING
        email_messages.id,
        email_messages.recipient_email,
        email_messages.from_email,
        email_messages.reply_to_email,
        email_messages.subject,
        email_messages.text_body,
        email_messages.html_body,
        email_messages.attempts,
        email_messages.max_attempts
    `,
    params
  );

  return query.rows.map(projectClaimedEmailMessage);
};

export const markEmailSent = async (
  pool: Pool,
  messageId: string
): Promise<void> => {
  await pool.query(
    `
      UPDATE email_messages
      SET
        status = 'sent',
        sent_at = NOW(),
        next_attempt_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [messageId]
  );
};

export const markEmailFailed = async (
  pool: Pool,
  messageId: string,
  nextAttemptAt: Date | null,
  error: string | null
): Promise<void> => {
  await pool.query(
    `
      UPDATE email_messages
      SET
        status = 'failed',
        next_attempt_at = COALESCE($2::timestamptz, next_attempt_at),
        last_error = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [messageId, nextAttemptAt?.toISOString() ?? null, error]
  );
};

/** Explicit retries may override exhausted attempts; active leases remain owned. */
export const claimAdminEmailQueueRetry = async (
  pool: Pool,
  messageId: string
): Promise<readonly ClaimedEmailMessage[]> => {
  if (!(await hasEmailMessagesTable(pool))) return [];

  // Claim in one statement, just like the worker. Never reset an active send:
  // another administrator (or the worker) may already own its SMTP request.
  const claimed = await pool.query<ClaimedEmailRow>(
    `
      UPDATE email_messages
      SET
        status = 'sending',
        attempts = CASE
          WHEN attempts >= max_attempts THEN max_attempts
          ELSE attempts + 1
        END,
        next_attempt_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND (
          status IN ('queued', 'failed')
          OR (status = 'sending' AND updated_at <= NOW() - INTERVAL '15 minutes')
        )
      RETURNING id, recipient_email, from_email, reply_to_email,
        subject, text_body, html_body, attempts, max_attempts
    `,
    [messageId]
  );

  return claimed.rows.map(projectClaimedEmailMessage);
};

export interface EmailConfigurationTestMessage {
  readonly id: string;
  readonly status: AdminEmailTestResult['status'];
  readonly to: string;
  readonly attempts: number;
  readonly error: string | null;
}

export const findEmailConfigurationTestMessage = async (
  pool: Pool,
  requestId: string,
  actor: string
): Promise<EmailConfigurationTestMessage | null> => {
  const row = (
    await pool.query<{
      id: string;
      status: AdminEmailTestResult['status'];
      recipient_email: string;
      attempts: number;
      last_error: string | null;
    }>(
      `SELECT id,status,recipient_email,attempts,last_error FROM email_messages
    WHERE idempotency_key=$1 AND template_key='email_configuration_test' AND metadata->>'actor'=$2`,
      ['admin-email-test:' + requestId.toLowerCase(), actor]
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        status: row.status,
        to: row.recipient_email,
        attempts: row.attempts,
        error: row.last_error
      }
    : null;
};

export const findEmailConfigurationTestBinding = async (
  client: PoolClient,
  messageId: string
): Promise<{ readonly to: string; readonly actor: unknown } | null> => {
  const row = (
    await client.query<{
      readonly recipient_email: string;
      readonly metadata: { readonly actor?: unknown };
    }>('SELECT recipient_email,metadata FROM email_messages WHERE id=$1', [
      messageId
    ])
  ).rows[0];
  return row ? { to: row.recipient_email, actor: row.metadata.actor } : null;
};

export const recordEmailConfigurationTestQueuedAudit = async (
  client: PoolClient,
  messageId: string,
  input: { readonly actor: string; readonly requestId: string }
): Promise<void> => {
  await client.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
  VALUES($1,'email.test.queued','email_message',$2,'email.test.queued',$3::jsonb)`,
    [
      input.actor,
      messageId,
      JSON.stringify({
        requestId: input.requestId.toLowerCase(),
        result: 'queued'
      })
    ]
  );
};
