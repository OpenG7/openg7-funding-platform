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
import { readSponsorshipInformationRequestReceipt } from './sponsorship-information-receipts.repository.js';
import { isValidUuid } from './business-helpers/request-validation.js';

export class InformationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code = status === 409
      ? 'INFORMATION_REQUEST_CONFLICT'
      : status === 400
        ? 'INFORMATION_REQUEST_INVALID'
        : 'INFORMATION_REQUEST_UNAVAILABLE'
  ) {
    super('Information request could not be queued.');
  }
}

export const validateInformationRequest = (
  input: unknown
): AdminInformationRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new InformationRequestError(400);
  const raw = input as Partial<AdminInformationRequest>;
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          'requestId',
          'contributionId',
          'contextVersion',
          'recipient',
          'subject',
          'body',
          'confirmed'
        ].includes(key)
    ) ||
    raw.confirmed !== true ||
    !isValidUuid(raw.requestId) ||
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
    requestId: raw.requestId.toLowerCase(),
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
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify([
        input.contributionId,
        input.contextVersion,
        input.recipient,
        input.subject,
        input.body,
        input.confirmed
      ])
    )
    .digest('hex');
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
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['sponsorship-information-request:' + input.requestId]
    );
    const prior = (
      await client.query<{
        actor: string;
        contribution_id: string;
        request_hash: string;
      }>(
        'SELECT actor, contribution_id, request_hash FROM sponsorship_information_request_receipts WHERE request_id = $1::uuid',
        [input.requestId]
      )
    ).rows[0];
    if (prior) {
      if (
        prior.actor !== actor ||
        prior.contribution_id !== input.contributionId ||
        prior.request_hash !== requestHash
      )
        throw new InformationRequestError(
          409,
          'INFORMATION_REQUEST_ID_CONFLICT'
        );
      const receipt = await readSponsorshipInformationRequestReceipt(
        client,
        input,
        actor
      );
      if (!receipt.found) throw new InformationRequestError(503);
      return {
        requestId: receipt.requestId,
        messageId: receipt.messageId,
        acceptedAt: receipt.acceptedAt,
        deliveryStatus: receipt.deliveryStatus,
        sentAt: receipt.sentAt,
        status: projectExistingSponsorshipEmailStatus(receipt.deliveryStatus)
      };
    }
    if (!(await lockSponsorshipContribution(client, input.contributionId)))
      throw new InformationRequestError(404);
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
    const existing = (
      await client.query<{ id: string; status: string }>(
        'SELECT id::text AS id, status FROM email_messages WHERE idempotency_key = $1',
        [key]
      )
    ).rows[0];
    let messageId = existing?.id;
    if (!messageId) {
      const queued = await queueSponsorshipInformationRequest(client, {
        ...input,
        idempotencyKey: key
      });
      if (!queued.messageId || queued.error)
        throw new InformationRequestError(503);
      messageId = queued.messageId;
      const audited = await insertAdminAuditLog(client, {
        actor,
        action: 'sponsorship.request_information',
        entityType: 'sponsorship',
        entityId: input.contributionId,
        summary:
          'Sponsorship information request queued after administrator confirmation.',
        metadata: { requestId: input.requestId, messageId }
      });
      if (!audited) throw new InformationRequestError(503);
    }
    await client.query(
      `INSERT INTO sponsorship_information_request_receipts
        (request_id, actor, contribution_id, request_hash, message_id)
      VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid)`,
      [input.requestId, actor, input.contributionId, requestHash, messageId]
    );
    const receipt = await readSponsorshipInformationRequestReceipt(
      client,
      input,
      actor
    );
    if (!receipt.found) throw new InformationRequestError(503);
    return {
      requestId: receipt.requestId,
      messageId: receipt.messageId,
      acceptedAt: receipt.acceptedAt,
      deliveryStatus: receipt.deliveryStatus,
      sentAt: receipt.sentAt,
      status: existing
        ? projectExistingSponsorshipEmailStatus(receipt.deliveryStatus)
        : 'queued'
    };
  });
};
