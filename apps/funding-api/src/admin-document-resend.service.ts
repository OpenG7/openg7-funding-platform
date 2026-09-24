import type { Pool } from 'pg';

import { enqueueSponsorshipDocumentEmail } from './email-notification.service.js';
import { insertAdminAuditLog } from './fund-admin.repository.js';
import type {
  SponsorshipCreditNoteRecord,
  SponsorshipInvoiceRecord
} from './sponsorship-invoices.repository.js';

export class DocumentResendConflict extends Error {
  readonly code = 'REQUEST_CONFLICT';
}

/** One confirmed request creates one queue entry and one audit, atomically. */
export async function queueAdminDocumentResend(
  pool: Pool,
  input: (
    | { invoice: SponsorshipInvoiceRecord }
    | { creditNote: SponsorshipCreditNoteRecord }
  ) & { to: string; requestId: string },
  actor: string
) {
  const invoice = 'invoice' in input;
  const document = invoice ? input.invoice : input.creditNote;
  const kind = invoice ? 'sponsorship_invoice' : 'sponsorship_credit_note';
  const idKey = invoice ? 'invoiceId' : 'creditNoteId';
  const requestId = input.requestId.toLowerCase();
  const key = `admin-document-resend:${requestId}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      key
    ]);
    const existing = (
      await client.query<{
        id: string;
        status: string;
        recipient_email: string;
        template_key: string;
        metadata: Record<string, unknown>;
      }>(
        'SELECT id,status,recipient_email,template_key,metadata FROM email_messages WHERE idempotency_key=$1',
        [key]
      )
    ).rows[0];
    if (
      existing &&
      (existing.recipient_email !== input.to ||
        existing.template_key !== kind ||
        existing.metadata[idKey] !== document.id)
    )
      throw new DocumentResendConflict(
        'This request already identifies another document or recipient.'
      );
    const messageId =
      existing?.id ??
      (await enqueueSponsorshipDocumentEmail(client, {
        ...input,
        idempotencyKey: key
      }));
    if (!existing) {
      const audited = await insertAdminAuditLog(client, {
        actor,
        action: `${kind}.resend`,
        entityType: kind,
        entityId: document.id,
        summary: 'Confirmed document email queued.',
        metadata: { messageId, requestId }
      });
      if (!audited)
        throw new Error('Document resend audit could not be recorded.');
    }
    await client.query('COMMIT');
    return {
      queued: existing?.status !== 'sent',
      attempted: false,
      sent: existing?.status === 'sent',
      messageId,
      error: null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
