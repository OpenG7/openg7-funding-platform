import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { enqueueSponsorshipObligationNotification } from '../sponsorship-commitments.repository.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';
import { assert } from '../publication-automation/policy.js';

type Db = Pool | PoolClient;
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface EvidenceInput {
  obligationId: string;
  contributionId: string;
  obligationVersion: number;
  channel: string;
  target: string;
  deliveryId: string | null;
  deliveryVersion: number | null;
  accountId: string;
  provenance: string;
  externalPostId: string | null;
  externalPostUrl: string | null;
  message: string;
  sources: unknown;
  media: unknown;
  actor: string;
}
export async function fulfil(db: Db, input: EvidenceInput): Promise<void> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,
      delivery_id,delivery_version,mode,account_id,provenance,external_post_id,external_post_url,message,source_snapshot,
      media_snapshot,content_fingerprint,delivered_at,actor)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,'live',$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,clock_timestamp(),$16)
     ON CONFLICT(obligation_id) DO NOTHING RETURNING id`,
    [
      input.obligationId,
      input.contributionId,
      input.obligationVersion,
      input.channel,
      input.target,
      input.deliveryId,
      input.deliveryVersion,
      input.accountId,
      input.provenance,
      input.externalPostId,
      input.externalPostUrl,
      input.message,
      JSON.stringify(input.sources),
      JSON.stringify(input.media),
      hash({
        message: input.message,
        sources: input.sources,
        media: input.media
      }),
      input.actor
    ]
  );
  if (!result.rows[0]) {
    const prior = await db.query<{
      delivery_id: string | null;
      external_post_id: string | null;
    }>(
      'SELECT delivery_id,external_post_id FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1::uuid',
      [input.obligationId]
    );
    assert(
      prior.rows[0]?.delivery_id === input.deliveryId &&
        prior.rows[0]?.external_post_id === input.externalPostId,
      'FULFILMENT_EVIDENCE_CONFLICT'
    );
    return;
  }
  const updated = await db.query(
    `UPDATE sponsorship_obligations SET state='fulfilled',blocked_reason=NULL,
    fulfilment_evidence_id=$2::uuid,version=version+1,updated_at=NOW()
    WHERE id=$1::uuid AND contribution_id=$3::uuid AND version=$4 AND state='pending' RETURNING id`,
    [
      input.obligationId,
      result.rows[0].id,
      input.contributionId,
      input.obligationVersion
    ]
  );
  assert(updated.rowCount, 'SOURCE_COMMITMENT_CHANGED');
  assert(
    await insertAdminAuditLog(db, {
      actor: input.actor,
      action: 'sponsorship_obligation.fulfilled',
      entityType: 'sponsorship',
      entityId: input.contributionId,
      summary: 'Qualified evidence fulfils one exact sponsorship obligation.',
      metadata: {
        evidenceId: result.rows[0].id,
        obligationId: input.obligationId,
        deliveryId: input.deliveryId,
        provenance: input.provenance
      }
    }),
    'FULFILMENT_AUDIT_UNAVAILABLE',
    503
  );
  await enqueueSponsorshipObligationNotification(db, {
    event: 'fulfilled',
    eventId: result.rows[0].id,
    obligationId: input.obligationId,
    obligationVersion: input.obligationVersion + 1
  });
}
