import type { Pool } from 'pg';
import type { SponsorMediaUploadResult } from '@openg7/funding-core';

import { ModerationError } from '../moderation/policy.js';

/** The private bearer link authorizes only its own dossier and sponsor commands. */
export async function readSponsorMediaFollowupUploadReceipt(
  pool: Pick<Pool, 'query'> | null,
  contributionId: string,
  requestId: string,
  fingerprint?: string
): Promise<SponsorMediaUploadResult | null> {
  if (!pool) throw new ModerationError('MEDIA_RECEIPT_UNAVAILABLE', 503);
  const row = (
    await pool.query<{
      actor: string;
      payload_fingerprint: string;
      result: SponsorMediaUploadResult;
    }>(
      'SELECT actor,payload_fingerprint,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1::uuid AND request_id=$2::uuid',
      [contributionId, requestId]
    )
  ).rows[0];
  if (!row) return null;
  if (
    row.actor !== 'sponsor-followup' ||
    row.result.uploaded !== true ||
    row.result.asset?.contributionId !== contributionId ||
    (fingerprint !== undefined && row.payload_fingerprint !== fingerprint)
  )
    throw new ModerationError('MEDIA_REQUEST_CONFLICT', 409);
  return row.result;
}
