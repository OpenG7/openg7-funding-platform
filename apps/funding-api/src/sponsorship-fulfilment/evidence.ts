import type { Pool, PoolClient } from 'pg';
import type { SponsorshipFulfilmentEvidence } from '@openg7/funding-core';

import { canonicalPublicationAccount } from '../publication-automation/account-reservations.js';
import { linkedinPublicationImageIds } from '../../../../packages/funding-core/src/index.js';
import type { DeliveryRow } from '../publication-automation/context.js';

import {
  assertPublicationObligations,
  releasePublicationObligations
} from './obligations.js';
import { fulfil } from './evidence-write.js';

export { recordWebsiteFulfilment } from './website-evidence.js';

type Db = Pool | PoolClient;

/** Provider acknowledgements qualify actual sends; simulation never fulfils commercial obligations. */
export async function recordSocialFulfilment(
  db: Db,
  row: DeliveryRow,
  postId: string,
  url: string | null,
  actor: string,
  provenance: 'provider_acknowledged' | 'provider_verified'
): Promise<void> {
  if (!row.batch_id || row.mode !== 'live') {
    await releasePublicationObligations(db, row.id);
    return;
  }
  await assertPublicationObligations(db, row);
  for (const obligation of row.obligation_snapshot ?? []) {
    await fulfil(db, {
      obligationId: obligation.id,
      contributionId: obligation.contributionId,
      obligationVersion: obligation.version,
      channel: obligation.channel,
      target: obligation.target,
      deliveryId: row.id,
      deliveryVersion: row.version,
      accountId: canonicalPublicationAccount(row).accountId,
      provenance,
      externalPostId: postId,
      externalPostUrl: url,
      message: row.message,
      sources: row.source_snapshot,
      media: row.media_snapshot,
      providerMediaIds: linkedinPublicationImageIds(row.provider_media_id),
      actor
    });
  }
  await releasePublicationObligations(db, row.id);
}

export async function listSponsorshipFulfilmentEvidence(
  db: Db,
  contributionId: string
): Promise<SponsorshipFulfilmentEvidence[]> {
  const result = await db.query<{
    id: string;
    obligationId: string;
    deliveryId: string | null;
    channel: SponsorshipFulfilmentEvidence['channel'];
    target: SponsorshipFulfilmentEvidence['target'];
    provenance: SponsorshipFulfilmentEvidence['provenance'];
    delivered_at: Date;
    externalPostUrl: string | null;
    visibility: SponsorshipFulfilmentEvidence['visibility'] | null;
    observed_at: Date | null;
  }>(
    `SELECT e.id,e.obligation_id AS "obligationId",e.delivery_id AS "deliveryId",e.channel,e.target,e.provenance,e.delivered_at,e.external_post_url AS "externalPostUrl",
      v.state AS visibility,v.observed_at FROM sponsorship_fulfilment_evidence e
      LEFT JOIN LATERAL (SELECT state,observed_at FROM sponsorship_fulfilment_visibility WHERE evidence_id=e.id ORDER BY observed_at DESC,id DESC LIMIT 1) v ON TRUE
      WHERE e.contribution_id=$1::uuid ORDER BY e.delivered_at,e.id`,
    [contributionId]
  );
  return result.rows.map(
    ({ delivered_at, observed_at, visibility, ...row }) => ({
      ...row,
      deliveredAt: delivered_at.toISOString(),
      visibility: visibility ?? 'unknown',
      visibilityObservedAt: observed_at?.toISOString() ?? null
    })
  );
}
