import { createHash } from 'node:crypto';

import type {
  AdminInformationRequest,
  AdminInformationRequestResult
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { loadSponsorshipAssistantDataset } from './admin-assistant/context.repository.js';
import {
  projectExistingSponsorshipEmailStatus,
  queueSponsorshipInformationRequest
} from './email-notification.service.js';
import { insertAdminAuditLog } from './fund-admin.repository.js';
import { lockSponsorshipContribution } from './fund-contributions.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { canRequestSponsorshipInformation } from './sponsorship-review-policy.js';

export class InformationRequestError extends Error {
  constructor(readonly status: number) {
    super('Information request could not be queued.');
  }
}

export const validateInformationRequest = (
  input: unknown
): AdminInformationRequest => {
  if (!input || typeof input !== 'object')
    throw new InformationRequestError(400);
  const raw = input as Partial<AdminInformationRequest>;
  if (
    raw.confirmed !== true ||
    typeof raw.contributionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      raw.contributionId
    ) ||
    typeof raw.contextVersion !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.contextVersion) ||
    typeof raw.recipient !== 'string' ||
    raw.recipient.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.recipient) ||
    typeof raw.subject !== 'string' ||
    !raw.subject.trim() ||
    raw.subject.length > 200 ||
    /[\r\n\x00]/.test(raw.subject) ||
    typeof raw.body !== 'string' ||
    !raw.body.trim() ||
    raw.body.length > 6000 ||
    raw.body.includes('\0')
  )
    throw new InformationRequestError(400);
  return {
    contributionId: raw.contributionId.toLowerCase(),
    contextVersion: raw.contextVersion,
    recipient: raw.recipient,
    subject: raw.subject,
    body: raw.body,
    confirmed: true
  };
};

/** A single transaction locks the record, queues at most once and writes its audit. */
export const requestSponsorshipInformation = async (
  pool: Pool,
  input: AdminInformationRequest,
  actor: string
): Promise<AdminInformationRequestResult> => {
  input = validateInformationRequest(input);
  const key =
    'sponsorship-information:' +
    createHash('sha256')
      .update(
        JSON.stringify([
          input.contributionId,
          input.recipient,
          input.subject,
          input.body
        ])
      )
      .digest('hex');
  return withPostgresTransaction(pool, async (client) => {
    if (!(await lockSponsorshipContribution(client, input.contributionId)))
      throw new InformationRequestError(404);
    const existing = await client.query<{ id: string; status: string }>(
      'SELECT id::text AS id, status FROM email_messages WHERE idempotency_key = $1',
      [key]
    );
    if (existing.rows[0]) {
      return {
        status: projectExistingSponsorshipEmailStatus(existing.rows[0].status),
        messageId: existing.rows[0].id
      };
    }
    const source = await loadSponsorshipAssistantDataset(
      client,
      input.contributionId
    );
    if (
      !source ||
      source.version !== input.contextVersion ||
      source.recipient !== input.recipient ||
      !canRequestSponsorshipInformation(source)
    )
      throw new InformationRequestError(409);
    const queued = await queueSponsorshipInformationRequest(client, {
      ...input,
      idempotencyKey: key
    });
    if (!queued.messageId || queued.error)
      throw new InformationRequestError(503);
    const audited = await insertAdminAuditLog(client, {
      actor,
      action: 'sponsorship.request_information',
      entityType: 'sponsorship',
      entityId: input.contributionId,
      summary:
        'Sponsorship information request queued after administrator confirmation.',
      metadata: { messageId: queued.messageId }
    });
    if (!audited) throw new InformationRequestError(503);
    return { status: 'queued', messageId: queued.messageId };
  });
};
