import { createHash } from 'node:crypto';

import type { Pool } from 'pg';
import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaUploadResult
} from '@openg7/funding-core';

import { isValidUuid } from '../business-helpers/request-validation.js';

export class SponsorMediaUploadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly assetId?: string
  ) {
    super(code);
    this.name = 'SponsorMediaUploadError';
  }
}
export interface SponsorMediaAdminUploadInput {
  readonly requestId: string;
  readonly contributionId: string;
  readonly kind: SponsorMediaKind;
  readonly filename: string;
  readonly contentType: string | null;
  readonly bytes: Buffer;
}
export const sponsorMediaUploadFingerprint = (
  input: SponsorMediaAdminUploadInput
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        action: 'upload',
        contributionId: input.contributionId.toLowerCase(),
        kind: input.kind,
        originalFilename: input.filename,
        originalChecksum: createHash('sha256').update(input.bytes).digest('hex')
      })
    )
    .digest('hex');

export function normalizeUploadInput(
  raw: SponsorMediaAdminUploadInput,
  actor: string,
  maxUploadBytes: number
): SponsorMediaAdminUploadInput {
  if (
    !isValidUuid(raw.requestId) ||
    !isValidUuid(raw.contributionId) ||
    !['logo', 'supporting_image'].includes(raw.kind) ||
    typeof raw.filename !== 'string' ||
    !raw.filename ||
    raw.filename.length > 500 ||
    !Buffer.isBuffer(raw.bytes) ||
    !raw.bytes.length ||
    typeof actor !== 'string' ||
    !actor.trim() ||
    actor.length > 200
  )
    throw new SponsorMediaUploadError('INVALID_MEDIA_UPLOAD_REQUEST', 400);
  if (raw.bytes.length > maxUploadBytes)
    throw new SponsorMediaUploadError('SPONSOR_MEDIA_TOO_LARGE', 413);
  const input = {
    ...raw,
    requestId: raw.requestId.toLowerCase(),
    contributionId: raw.contributionId.toLowerCase()
  };
  return input;
}
export async function readRecordedUpload(
  pool: Pick<Pool, 'query'>,
  input: SponsorMediaAdminUploadInput,
  actor: string,
  fingerprint: string
): Promise<SponsorMediaUploadResult | null> {
  const row = (
    await pool.query<{
      actor: string;
      payload_fingerprint: string;
      result: { uploaded?: boolean; asset?: SponsorMediaAsset };
    }>(
      'SELECT actor,payload_fingerprint,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1::uuid AND request_id=$2::uuid',
      [input.contributionId, input.requestId]
    )
  ).rows[0];
  if (!row) return null;
  if (
    row.actor !== actor ||
    row.payload_fingerprint !== fingerprint ||
    row.result.uploaded !== true ||
    !row.result.asset ||
    row.result.asset.contributionId !== input.contributionId
  )
    throw new SponsorMediaUploadError('MEDIA_REQUEST_CONFLICT', 409);
  return { uploaded: true, asset: row.result.asset };
}
