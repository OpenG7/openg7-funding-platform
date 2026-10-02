import type { Pool, PoolClient } from 'pg';
import type {
  AdminEmailTestResult,
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse,
  AdminEmailQueueSummary
} from '@openg7/funding-core';

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

interface AdminEmailQueueMessageRow {
  readonly id: string;
  readonly template_key: string;
  readonly recipient_email: string;
  readonly from_email: string;
  readonly reply_to_email: string | null;
  readonly subject: string;
  readonly status: AdminEmailQueueMessageRecord['status'];
  readonly attempts: number;
  readonly max_attempts: number;
  readonly next_attempt_at: string;
  readonly sent_at: string | null;
  readonly last_error: string | null;
  readonly metadata: unknown;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AdminEmailQueueSummaryRow {
  readonly queued_count: number;
  readonly sending_count: number;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly retryable_count: number;
  readonly last_failed_at: string | null;
  readonly last_error: string | null;
  readonly last_updated_at: string | null;
}

export interface EmailQueueStatus {
  readonly queuedCount: number;
  readonly sendingCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly lastFailedAt: string | null;
  readonly lastError: string | null;
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
  subject: row.subject,
  text: row.text_body,
  html: row.html_body,
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
        max_attempts
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `,
    [
      input.idempotencyKey ?? null,
      input.templateKey,
      input.to,
      input.fromEmail,
      input.replyToEmail,
      input.subject,
      input.text,
      input.html,
      JSON.stringify(input.metadata),
      input.maxAttempts
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

const hasEmailMessagesTable = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ readonly has_email_messages: boolean }>(`
    SELECT to_regclass('public.email_messages') IS NOT NULL AS has_email_messages
  `);

  return result.rows[0]?.has_email_messages ?? false;
};

const mapAdminEmailQueueMessageRow = (
  row: AdminEmailQueueMessageRow
): AdminEmailQueueMessageRecord => ({
  id: row.id,
  template_key: row.template_key,
  recipient_email: row.recipient_email,
  from_email: row.from_email,
  reply_to_email: row.reply_to_email,
  subject: row.subject,
  status: row.status,
  attempts: row.attempts,
  max_attempts: row.max_attempts,
  next_attempt_at: row.next_attempt_at,
  sent_at: row.sent_at,
  last_error: row.last_error,
  metadata:
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {},
  created_at: row.created_at,
  updated_at: row.updated_at
});

const emptyAdminEmailQueueResponse = (): AdminEmailQueueResponse => ({
  data_source: 'database',
  messages: [],
  summary: {
    queued_count: 0,
    sending_count: 0,
    sent_count: 0,
    failed_count: 0,
    retryable_count: 0,
    last_failed_at: null,
    last_error: null
  },
  last_updated_at: new Date().toISOString()
});

const adminEmailQueueMessageSelect = `
  id::text AS id,
  template_key,
  recipient_email,
  from_email,
  reply_to_email,
  subject,
  status,
  attempts::int AS attempts,
  max_attempts::int AS max_attempts,
  next_attempt_at::text AS next_attempt_at,
  sent_at::text AS sent_at,
  last_error,
  metadata,
  created_at::text AS created_at,
  updated_at::text AS updated_at
`;

export const getAdminEmailQueueMessageById = async (
  pool: Pool | null,
  messageId: string
): Promise<AdminEmailQueueMessageRecord | null> => {
  if (!pool || !(await hasEmailMessagesTable(pool))) {
    return null;
  }

  const result = await pool.query<AdminEmailQueueMessageRow>(
    `
      SELECT ${adminEmailQueueMessageSelect}
      FROM email_messages
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [messageId]
  );

  return result.rows[0] ? mapAdminEmailQueueMessageRow(result.rows[0]) : null;
};

export const listAdminEmailQueue = async (
  pool: Pool | null,
  options: { readonly all?: boolean; readonly id?: string } = {}
): Promise<AdminEmailQueueResponse> => {
  if (!pool || !(await hasEmailMessagesTable(pool))) {
    return emptyAdminEmailQueueResponse();
  }

  const [messageResult, summaryResult] = await Promise.all([
    pool.query<AdminEmailQueueMessageRow>(
      `
      SELECT ${adminEmailQueueMessageSelect}
      FROM email_messages
      WHERE ($1::text IS NULL OR id::text = $1)
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $2
    `,
      [options.id ?? null, options.all ? null : 150]
    ),
    pool.query<AdminEmailQueueSummaryRow>(`
      WITH counts AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
          COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          COUNT(*) FILTER (
            WHERE status IN ('queued', 'failed')
              OR status = 'sending'
          )::int AS retryable_count,
          MAX(updated_at)::text AS last_updated_at
        FROM email_messages
      ),
      latest_failed AS (
        SELECT updated_at::text AS last_failed_at, last_error
        FROM email_messages
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 1
      )
      SELECT
        counts.queued_count,
        counts.sending_count,
        counts.sent_count,
        counts.failed_count,
        counts.retryable_count,
        latest_failed.last_failed_at,
        latest_failed.last_error,
        counts.last_updated_at
      FROM counts
      LEFT JOIN latest_failed ON TRUE
    `)
  ]);
  const summaryRow = summaryResult.rows[0];
  const summary: AdminEmailQueueSummary = {
    queued_count: summaryRow?.queued_count ?? 0,
    sending_count: summaryRow?.sending_count ?? 0,
    sent_count: summaryRow?.sent_count ?? 0,
    failed_count: summaryRow?.failed_count ?? 0,
    retryable_count: summaryRow?.retryable_count ?? 0,
    last_failed_at: summaryRow?.last_failed_at ?? null,
    last_error: summaryRow?.last_error ?? null
  };

  return {
    data_source: 'database',
    messages: messageResult.rows.map(mapAdminEmailQueueMessageRow),
    summary,
    last_updated_at: summaryRow?.last_updated_at ?? new Date().toISOString()
  };
};

export const getEmailQueueStatus = async (
  pool: Pool | null
): Promise<EmailQueueStatus> => {
  if (!pool) {
    return {
      queuedCount: 0,
      sendingCount: 0,
      sentCount: 0,
      failedCount: 0,
      lastFailedAt: null,
      lastError: null
    };
  }

  const result = await pool.query<{
    queued_count: number;
    sending_count: number;
    sent_count: number;
    failed_count: number;
    last_failed_at: string | null;
    last_error: string | null;
  }>(`
    WITH counts AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'sending')::int AS sending_count,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
      FROM email_messages
    ),
    latest_failed AS (
      SELECT updated_at::text AS last_failed_at, last_error
      FROM email_messages
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 1
    )
    SELECT
      counts.queued_count,
      counts.sending_count,
      counts.sent_count,
      counts.failed_count,
      latest_failed.last_failed_at,
      latest_failed.last_error
    FROM counts
    LEFT JOIN latest_failed ON TRUE
  `);
  const row = result.rows[0];

  return {
    queuedCount: row?.queued_count ?? 0,
    sendingCount: row?.sending_count ?? 0,
    sentCount: row?.sent_count ?? 0,
    failedCount: row?.failed_count ?? 0,
    lastFailedAt: row?.last_failed_at ?? null,
    lastError: row?.last_error ?? null
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
