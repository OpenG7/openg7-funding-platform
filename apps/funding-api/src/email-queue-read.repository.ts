import type { Pool } from 'pg';
import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse,
  AdminEmailQueueSummary
} from '@openg7/funding-core';

import { hasEmailMessagesTable } from './email-queue.persistence.js';
import {
  revealPrivateText,
  revealEmailMetadata
} from './private-data-protection.js';

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
  readonly uncertain_count: number;
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

const mapAdminEmailQueueMessageRow = (
  row: AdminEmailQueueMessageRow
): AdminEmailQueueMessageRecord => ({
  id: row.id,
  template_key: row.template_key,
  recipient_email: row.recipient_email,
  from_email: row.from_email,
  reply_to_email: row.reply_to_email,
  subject: revealPrivateText(row.subject, `email:${row.id}:subject`),
  status: row.status,
  attempts: row.attempts,
  max_attempts: row.max_attempts,
  next_attempt_at: row.next_attempt_at,
  sent_at: row.sent_at,
  last_error: row.last_error,
  metadata: revealEmailMetadata(row.metadata, row.id),
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
          COUNT(*) FILTER (WHERE status = 'uncertain')::int AS uncertain_count,
          COUNT(*) FILTER (
            WHERE status IN ('queued', 'failed')
          )::int AS retryable_count,
          MAX(updated_at)::text AS last_updated_at
        FROM email_messages
      ),
      latest_failed AS (
        SELECT updated_at::text AS last_failed_at, last_error
        FROM email_messages
        WHERE status IN ('failed', 'uncertain')
        ORDER BY updated_at DESC
        LIMIT 1
      )
      SELECT
        counts.queued_count,
        counts.sending_count,
        counts.sent_count,
        counts.failed_count,
        counts.uncertain_count,
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
    ...(summaryRow?.uncertain_count
      ? { uncertain_count: summaryRow.uncertain_count }
      : {}),
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
        COUNT(*) FILTER (WHERE status IN ('failed','uncertain'))::int AS failed_count
      FROM email_messages
    ),
    latest_failed AS (
      SELECT updated_at::text AS last_failed_at, last_error
      FROM email_messages
      WHERE status IN ('failed', 'uncertain')
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
