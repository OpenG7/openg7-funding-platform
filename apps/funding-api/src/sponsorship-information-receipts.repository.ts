import type {
  AdminInformationRequestReceipt,
  AdminInformationRequestReceiptRequest
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

type FoundReceipt = Extract<AdminInformationRequestReceipt, { found: true }>;

/** Pure actor-bound read: command acceptance never implies successful delivery. */
export async function readSponsorshipInformationRequestReceipt(
  db: Pool | PoolClient,
  input: AdminInformationRequestReceiptRequest,
  actor: string
): Promise<AdminInformationRequestReceipt> {
  const request = {
    requestId: input.requestId.toLowerCase(),
    contributionId: input.contributionId.toLowerCase()
  };
  const row = (
    await db.query<{
      messageId: string;
      acceptedAt: Date | string;
      deliveryStatus: FoundReceipt['deliveryStatus'];
      sentAt: Date | string | null;
    }>(
      `SELECT receipt.message_id::text AS "messageId",
        receipt.accepted_at AS "acceptedAt", message.status AS "deliveryStatus",
        message.sent_at AS "sentAt"
      FROM sponsorship_information_request_receipts receipt
      JOIN email_messages message ON message.id = receipt.message_id
      WHERE receipt.request_id = $1::uuid AND receipt.contribution_id = $2::uuid
        AND receipt.actor = $3 AND message.template_key = 'sponsorship_information_request'
        AND message.metadata->>'contributionId' = $2::text
      LIMIT 1`,
      [request.requestId, request.contributionId, actor]
    )
  ).rows[0];
  if (!row) return { ...request, found: false };
  if (
    !['queued', 'sending', 'sent', 'failed', 'uncertain'].includes(
      row.deliveryStatus
    )
  )
    throw new Error('Information request receipt is unavailable.');
  return {
    ...request,
    found: true,
    messageId: row.messageId,
    acceptedAt: new Date(row.acceptedAt).toISOString(),
    deliveryStatus: row.deliveryStatus,
    sentAt: row.sentAt === null ? null : new Date(row.sentAt).toISOString()
  };
}
