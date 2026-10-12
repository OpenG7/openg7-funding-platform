import type { SponsorshipObligationAdjustmentRequest } from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { publicationFormatCapability } from '../../../../packages/funding-core/src/index.js';
import { retireAdjustedPublicationDrafts } from '../fund-publication-draft-retirement.persistence.js';
import {
  lockCommitmentDeliveries,
  revokeCommitmentDeliveries
} from '../sponsorship-fulfilment.repository.js';

import {
  audit,
  fingerprint,
  insertChange,
  prior,
  SponsorshipCommitmentError,
  validateCommand
} from './change-support.js';
import { enqueueSponsorshipObligationNotification } from './notifications.js';
import { loadSponsorshipCommitment } from './repository.js';

/** Adjust terms explicitly; refunds or a refusal never silently waive an obligation. */
export const adjustSponsorshipObligation = async (
  db: PoolClient,
  raw: unknown,
  actor: string
) => {
  const value = validateCommand(raw, 'obligationId');
  if (
    !['destination', 'waiver', 'format'].includes(String(value.kind)) ||
    typeof value.kind !== 'string' ||
    (value.kind === 'destination' &&
      (typeof value.target !== 'string' ||
        !['openg7', 'openg20'].includes(value.target))) ||
    (value.kind !== 'destination' && value.target !== undefined) ||
    (value.kind === 'format' &&
      (typeof value.format !== 'string' ||
        ![
          'collective_text',
          'individual_portrait',
          'collective_composite',
          'image_collection'
        ].includes(value.format))) ||
    (value.kind !== 'format' && value.format !== undefined)
  )
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  const input: SponsorshipObligationAdjustmentRequest = {
    requestId: value.requestId as string,
    obligationId: value.obligationId as string,
    expectedVersion: value.expectedVersion as number,
    confirmation: value.confirmation as string,
    reason: (value.reason as string).trim(),
    kind: value.kind as SponsorshipObligationAdjustmentRequest['kind'],
    ...(value.target === undefined
      ? {}
      : {
          target:
            value.target as SponsorshipObligationAdjustmentRequest['target']
        }),
    ...(value.format === undefined
      ? {}
      : {
          format:
            value.format as SponsorshipObligationAdjustmentRequest['format']
        })
  };
  const hash = fingerprint({ input, actor });
  const owner = await db.query<{ contribution_id: string }>(
    'SELECT contribution_id FROM sponsorship_obligations WHERE id=$1::uuid',
    [input.obligationId]
  );
  const contributionId = owner.rows[0]?.contribution_id;
  if (!contributionId)
    throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  await lockCommitmentDeliveries(db, contributionId);
  await db.query(
    'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
    [contributionId]
  );
  await db.query(
    'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1::uuid FOR UPDATE',
    [contributionId]
  );
  const obligation = await db.query<{
    id: string;
    commitment_id: string;
    state: string;
    target: string;
    channel: string;
    publication_format: SponsorshipObligationAdjustmentRequest['format'] | null;
    version: number;
  }>(
    'SELECT id,commitment_id,state,target,channel,publication_format,version FROM sponsorship_obligations WHERE id=$1::uuid FOR UPDATE',
    [input.obligationId]
  );
  const o = obligation.rows[0]!;
  if (await prior(db, input.requestId, hash))
    return loadSponsorshipCommitment(db, contributionId);
  if (o.version !== input.expectedVersion)
    throw new SponsorshipCommitmentError('COMMITMENT_VERSION_CONFLICT');
  if (['fulfilled', 'adjusted'].includes(o.state))
    throw new SponsorshipCommitmentError('COMMITMENT_ALREADY_COMPLETED');
  if (input.kind === 'destination' && o.target === input.target)
    throw new SponsorshipCommitmentError('COMMITMENT_UNCHANGED');
  if (
    input.kind === 'format' &&
    !publicationFormatCapability(o.channel, input.format!).available
  )
    throw new SponsorshipCommitmentError('FORMAT_UNAVAILABLE', 400);
  if (input.kind === 'format' && o.publication_format === input.format)
    throw new SponsorshipCommitmentError('COMMITMENT_UNCHANGED');
  const after = {
    state: input.kind === 'waiver' ? 'adjusted' : o.state,
    target: input.target ?? o.target,
    format: input.format ?? o.publication_format,
    version: o.version + 1
  };
  if (
    await insertChange(db, {
      requestId: input.requestId,
      hash,
      commitmentId: o.commitment_id,
      obligationId: o.id,
      kind: input.kind,
      actor,
      reason: input.reason,
      before: {
        state: o.state,
        target: o.target,
        format: o.publication_format,
        version: o.version
      },
      after
    })
  ) {
    await db.query(
      `UPDATE sponsorship_obligations SET state=$2,target=$3,publication_format=$4,version=version+1,updated_at=NOW() WHERE id=$1::uuid`,
      [o.id, after.state, after.target, after.format]
    );
    await db.query(
      'UPDATE sponsorship_commitments SET version=version+1,updated_at=NOW() WHERE id=$1::uuid',
      [o.commitment_id]
    );
    await audit(db, actor, input.kind, contributionId, input.requestId);
    await revokeCommitmentDeliveries(db, contributionId);
    if (
      !(await retireAdjustedPublicationDrafts(db, o.id, actor, input.requestId))
    )
      throw new SponsorshipCommitmentError('COMMITMENT_AUDIT_UNAVAILABLE', 503);
    await enqueueSponsorshipObligationNotification(db, {
      event: 'terms_changed',
      eventId: input.requestId,
      obligationId: o.id,
      obligationVersion: after.version
    });
  }
  return loadSponsorshipCommitment(db, contributionId);
};
