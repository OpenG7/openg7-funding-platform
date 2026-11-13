import { createHash } from 'node:crypto';

import type {
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminMediaConsentSnapshotEntry
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
import {
  canRequestSponsorshipConsent,
  canRequestSponsorshipInformation
} from './sponsorship-review-policy.js';
import { readSponsorshipInformationRequestReceipt } from './sponsorship-information-receipts.repository.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import {
  prepareSponsorshipMediaConsentRequest,
  queueSponsorshipMediaConsentRequest,
  readSponsorshipMediaConsentAssets,
  validSponsorshipMediaConsentAccessOptions,
  type SponsorshipMediaConsentAccessOptions
} from './sponsorship-media-consent.js';

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

const normalizeMediaConsentSnapshot = (
  value: unknown
): readonly AdminMediaConsentSnapshotEntry[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new InformationRequestError(400);
  const entries = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new InformationRequestError(400);
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => !['id', 'version'].includes(key)) ||
      !isValidUuid(item.id) ||
      typeof item.version !== 'string' ||
      !item.version.trim() ||
      item.version.length > 128 ||
      /[\u0000-\u001f\u007f<>]/.test(item.version)
    )
      throw new InformationRequestError(400);
    return { id: item.id.toLowerCase(), version: item.version };
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new InformationRequestError(400);
  return entries.sort((first, second) => first.id.localeCompare(second.id));
};

export const validateInformationRequest = (
  input: unknown
): AdminInformationRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new InformationRequestError(400);
  const raw = input as Partial<AdminInformationRequest>;
  const mediaConsent = raw.purpose === 'media_consent';
  const mediaSnapshot = mediaConsent
    ? normalizeMediaConsentSnapshot(raw.mediaSnapshot)
    : undefined;
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          'requestId',
          'purpose',
          'language',
          'mediaSnapshot',
          'contributionId',
          'contextVersion',
          'recipient',
          'subject',
          'body',
          'confirmed'
        ].includes(key)
    ) ||
    (raw.purpose !== undefined &&
      raw.purpose !== 'public_consent' &&
      raw.purpose !== 'media_consent') ||
    (mediaConsent
      ? raw.language !== 'fr-CA' && raw.language !== 'en'
      : raw.language !== undefined || raw.mediaSnapshot !== undefined) ||
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
    ...(raw.purpose ? { purpose: raw.purpose } : {}),
    ...(mediaConsent ? { language: raw.language, mediaSnapshot } : {}),
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
  actor: string,
  options?: SponsorshipMediaConsentAccessOptions
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
        input.confirmed,
        ...(input.purpose ? [input.purpose] : []),
        ...(input.purpose === 'media_consent'
          ? [input.language, input.mediaSnapshot]
          : [])
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
          input.body,
          ...(input.purpose ? [input.purpose] : []),
          ...(input.purpose === 'media_consent'
            ? [input.language, input.mediaSnapshot]
            : [])
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
    if (!source || source.version !== input.contextVersion)
      throw new InformationRequestError(409);
    if (input.purpose === 'media_consent') {
      const preview = prepareSponsorshipMediaConsentRequest(
        source,
        await readSponsorshipMediaConsentAssets(client, source),
        input.language!
      ).delivery;
      if (
        !preview ||
        preview.recipient !== input.recipient ||
        JSON.stringify(preview.mediaSnapshot) !==
          JSON.stringify(input.mediaSnapshot)
      )
        throw new InformationRequestError(409);
      if (!validSponsorshipMediaConsentAccessOptions(options))
        throw new InformationRequestError(503);
    } else if (
      source.recipient !== input.recipient ||
      !(input.purpose === 'public_consent'
        ? canRequestSponsorshipConsent(source)
        : canRequestSponsorshipInformation(source))
    )
      throw new InformationRequestError(409);
    // A new confirmed request may renew an expired private link, while UUID replay
    // above remains attached to its original historical receipt.
    const priorMessage =
      input.purpose === 'media_consent'
        ? (
            await client.query<{
              id: string;
              status: string;
              accessValid?: boolean;
            }>(
              `SELECT message.id::text AS id,message.status,
              COALESCE(access.expires_at > clock_timestamp(),FALSE) AS "accessValid"
            FROM email_messages message
            LEFT JOIN sponsorship_access_tokens access ON access.email_message_id=message.id
              AND access.contribution_id=$2::uuid
            WHERE message.template_key='sponsorship_information_request'
              AND message.metadata->>'contributionId'=$2::text
              AND (message.idempotency_key=$1 OR message.idempotency_key LIKE $1 || ':renewal:%')
            ORDER BY "accessValid" DESC,access.created_at DESC NULLS LAST,
              message.created_at DESC,message.id DESC LIMIT 1`,
              [key, input.contributionId]
            )
          ).rows[0]
        : (
            await client.query<{
              id: string;
              status: string;
              accessValid?: boolean;
            }>(
              'SELECT id::text AS id, status FROM email_messages WHERE idempotency_key = $1',
              [key]
            )
          ).rows[0];
    const existing =
      priorMessage &&
      (input.purpose !== 'media_consent' || priorMessage.accessValid)
        ? priorMessage
        : undefined;
    const deliveryKey =
      input.purpose === 'media_consent' &&
      priorMessage &&
      !priorMessage.accessValid
        ? `${key}:renewal:${priorMessage.id}`
        : key;
    let messageId = existing?.id;
    if (!messageId) {
      const queued =
        input.purpose === 'media_consent'
          ? await queueSponsorshipMediaConsentRequest(
              client,
              input,
              deliveryKey,
              options!
            )
          : await queueSponsorshipInformationRequest(client, {
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
        metadata: {
          requestId: input.requestId,
          messageId,
          ...(input.purpose ? { purpose: input.purpose } : {}),
          ...(input.purpose === 'media_consent'
            ? { language: input.language, mediaSnapshot: input.mediaSnapshot }
            : {})
        }
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
