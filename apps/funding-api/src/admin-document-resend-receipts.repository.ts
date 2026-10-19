import type {
  AdminDocumentResendReceipt,
  AdminDocumentResendReceiptRequest
} from '@openg7/funding-core';
import type { Pool } from 'pg';

type FoundReceipt = Extract<AdminDocumentResendReceipt, { found: true }>;

/** Pure read of the original queue/audit transaction; never retries email delivery. */
export async function readAdminDocumentResendReceipt(
  pool: Pool,
  input: AdminDocumentResendReceiptRequest,
  actor: string
): Promise<AdminDocumentResendReceipt> {
  const request = {
    ...input,
    requestId: input.requestId.toLowerCase(),
    documentId: input.documentId.toLowerCase()
  };
  const invoice = input.documentKind === 'invoice';
  const template = invoice ? 'sponsorship_invoice' : 'sponsorship_credit_note';
  const idKey = invoice ? 'invoiceId' : 'creditNoteId';
  const row = (
    await pool.query<{
      messageId: string;
      acceptedAt: Date | string;
      deliveryStatus: FoundReceipt['deliveryStatus'];
      sentAt: Date | string | null;
    }>(
      `SELECT message.id::text AS "messageId",
        audit.created_at AS "acceptedAt",
        message.status AS "deliveryStatus", message.sent_at AS "sentAt"
      FROM email_messages message
      JOIN admin_audit_log audit
        ON audit.actor = $2 AND audit.action = $3 || '.resend'
        AND audit.entity_type = $3 AND audit.entity_id = $4
        AND audit.metadata->>'requestId' = $1
        AND audit.metadata->>'messageId' = message.id::text
      WHERE message.idempotency_key = 'admin-document-resend:' || $1
        AND message.template_key = $3 AND message.metadata->>$5 = $4
      LIMIT 1`,
      [request.requestId, actor, template, request.documentId, idKey]
    )
  ).rows[0];
  if (!row) return { ...request, found: false };
  if (
    !['queued', 'sending', 'sent', 'failed', 'uncertain'].includes(
      row.deliveryStatus
    )
  )
    throw new Error('Document resend receipt is unavailable.');
  return {
    ...request,
    found: true,
    messageId: row.messageId,
    acceptedAt: new Date(row.acceptedAt).toISOString(),
    deliveryStatus: row.deliveryStatus,
    sentAt: row.sentAt === null ? null : new Date(row.sentAt).toISOString()
  };
}
