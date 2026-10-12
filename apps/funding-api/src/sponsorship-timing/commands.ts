import type { Pool, PoolClient } from 'pg';
import type {
  SponsorshipTimingCommandRequest,
  SponsorshipObligationTiming,
  SponsorshipOfferedBenefit
} from '@openg7/funding-core';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import {
  captureWebsiteEvidenceSnapshot,
  observeWebsiteExposure,
  completeWebsiteExposureDuration
} from '../sponsorship-fulfilment.repository.js';
import {
  attestWebsiteMedia,
  type WebsiteMediaStorage,
  type WebsiteMediaAttestation
} from '../sponsorship-website-media.js';
import {
  audit,
  fingerprint,
  insertChange,
  prior,
  SponsorshipCommitmentError,
  text,
  validateCommand
} from '../sponsorship-commitments/change-support.js';

import { loadSponsorshipObligationTimings } from './read.js';

function validateTimingCommand(raw: unknown): SponsorshipTimingCommandRequest {
  const value = validateCommand(raw, 'obligationId');
  const allowed = [
    'requestId',
    'obligationId',
    'expectedVersion',
    'confirmation',
    'reason',
    'kind',
    'originAt',
    'evidenceReference',
    'startObservationId',
    'continuityConfirmed'
  ];
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    typeof value.kind !== 'string' ||
    !['origin', 'observe', 'duration'].includes(String(value.kind))
  )
    throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
  if (value.kind === 'origin') {
    if (
      typeof value.originAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(
        value.originAt
      ) ||
      !Number.isFinite(Date.parse(value.originAt)) ||
      Date.parse(value.originAt) > Date.now() ||
      Date.parse(value.originAt) < Date.UTC(2000, 0, 1) ||
      !text(value.evidenceReference) ||
      value.startObservationId !== undefined ||
      value.continuityConfirmed !== undefined
    )
      throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
    const canonical = new Date(value.originAt).toISOString();
    if (
      canonical !== value.originAt &&
      canonical.replace('.000Z', 'Z') !== value.originAt
    )
      throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
  } else if (value.kind === 'duration') {
    if (
      !isValidUuid(value.startObservationId) ||
      value.continuityConfirmed !== true ||
      !text(value.evidenceReference) ||
      value.originAt !== undefined
    )
      throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
  } else if (
    [
      'originAt',
      'evidenceReference',
      'startObservationId',
      'continuityConfirmed'
    ].some((key) => value[key] !== undefined)
  )
    throw new SponsorshipCommitmentError('TIMING_INVALID', 400);
  return {
    requestId: value.requestId as string,
    obligationId: value.obligationId as string,
    expectedVersion: value.expectedVersion as number,
    confirmation: value.confirmation as string,
    reason: (value.reason as string).trim(),
    kind: value.kind as SponsorshipTimingCommandRequest['kind'],
    ...(value.kind === 'origin'
      ? {
          originAt: new Date(value.originAt as string).toISOString(),
          evidenceReference: (value.evidenceReference as string).trim()
        }
      : {}),
    ...(value.kind === 'duration'
      ? {
          startObservationId: value.startObservationId as string,
          evidenceReference: (value.evidenceReference as string).trim(),
          continuityConfirmed: true as const
        }
      : {})
  };
}

async function receipt(
  db: PoolClient,
  obligationId: string
): Promise<{ obligationId: string; timing: SponsorshipObligationTiming }> {
  const timing = (
    await loadSponsorshipObligationTimings(db, [obligationId])
  ).get(obligationId);
  if (!timing)
    throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  return { obligationId, timing };
}

/** Owner HTTP authorization is mandatory. Storage I/O precedes locks; all facts and receipts commit together. */
export async function executeSponsorshipTimingCommand(
  pool: Pool,
  raw: unknown,
  actor: string,
  storage?: WebsiteMediaStorage
): Promise<{ obligationId: string; timing: SponsorshipObligationTiming }> {
  const input = validateTimingCommand(raw);
  const hash = fingerprint({ input, actor });
  const lookup = await pool.query<{
    contribution_id: string;
    sponsor_logo_url: string | null;
  }>(
    `SELECT ob.contribution_id,c.sponsor_logo_url
    FROM sponsorship_obligations ob JOIN fund_contributions c ON c.id=ob.contribution_id WHERE ob.id=$1::uuid`,
    [input.obligationId]
  );
  const planned = lookup.rows[0];
  if (!planned)
    throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
  const replay = await prior(pool, input.requestId, hash);
  let attestation: WebsiteMediaAttestation | null = null;
  if (!replay && input.kind !== 'origin')
    attestation = await attestWebsiteMedia(
      pool,
      storage,
      planned.contribution_id,
      planned.sponsor_logo_url
    );
  return withPostgresTransaction(pool, async (db) => {
    await db.query(
      'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
      [planned.contribution_id]
    );
    await db.query(
      'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1::uuid FOR UPDATE',
      [planned.contribution_id]
    );
    const result = await db.query<{
      id: string;
      commitment_id: string;
      contribution_id: string;
      state: string;
      channel: string;
      target: string;
      version: number;
      timing_version: number;
      deadline_days: number | null;
      duration_days: number | null;
      origin_at: Date | null;
      commitment_state: string;
      benefit: SponsorshipOfferedBenefit;
    }>(
      `SELECT ob.id,ob.commitment_id,ob.contribution_id,ob.state,ob.channel,ob.target,ob.version,
      t.version AS timing_version,t.deadline_days,t.duration_days,t.origin_at,m.state AS commitment_state,b AS benefit
      FROM sponsorship_obligations ob JOIN sponsorship_obligation_timing t ON t.obligation_id=ob.id
      JOIN sponsorship_commitments m ON m.id=ob.commitment_id JOIN sponsorship_offers o ON o.id=m.offer_id
      CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'benefits') b
      WHERE ob.id=$1::uuid AND b->>'id'=ob.benefit_id FOR UPDATE OF ob,t`,
      [input.obligationId]
    );
    const row = result.rows[0];
    if (!row) throw new SponsorshipCommitmentError('COMMITMENT_NOT_FOUND', 404);
    if (await prior(db, input.requestId, hash))
      return receipt(db, input.obligationId);
    if (row.timing_version !== input.expectedVersion)
      throw new SponsorshipCommitmentError('TIMING_VERSION_CONFLICT');
    if (['fulfilled', 'adjusted'].includes(row.state))
      throw new SponsorshipCommitmentError('COMMITMENT_ALREADY_COMPLETED');
    if (row.commitment_state !== 'active')
      throw new SponsorshipCommitmentError('COMMITMENT_NOT_ACTIVE');
    if (input.kind === 'origin') {
      if (row.origin_at !== null)
        throw new SponsorshipCommitmentError('TIMING_ORIGIN_ALREADY_RECORDED');
      if (row.deadline_days === null)
        throw new SponsorshipCommitmentError('TIMING_DEADLINE_NOT_REQUIRED');
      await db.query(
        `UPDATE sponsorship_obligation_timing SET origin_at=$2::timestamptz,origin_provenance='owner_recorded',
        due_at=$2::timestamptz+deadline_days*INTERVAL '24 hours',version=version+1 WHERE obligation_id=$1::uuid`,
        [row.id, input.originAt]
      );
    } else {
      if (
        row.channel !== 'website' ||
        row.target !== 'openg7' ||
        row.duration_days === null
      )
        throw new SponsorshipCommitmentError(
          'COMMITMENT_DURATION_UNSUPPORTED',
          400
        );
      if (row.state !== 'pending')
        throw new SponsorshipCommitmentError('COMMITMENT_BLOCKED');
      const snapshot = await captureWebsiteEvidenceSnapshot(
        db,
        row.contribution_id,
        row.benefit.requiredElements,
        attestation!
      );
      if (input.kind === 'observe')
        await observeWebsiteExposure(
          db,
          row.id,
          row.contribution_id,
          row.version,
          actor,
          snapshot
        );
      else
        await completeWebsiteExposureDuration(db, {
          obligationId: row.id,
          contributionId: row.contribution_id,
          version: row.version,
          durationDays: row.duration_days,
          startObservationId: input.startObservationId!,
          evidenceReference: input.evidenceReference!,
          continuityConfirmed: true,
          actor,
          snapshot
        });
    }
    const after = await receipt(db, row.id);
    if (
      !(await insertChange(db, {
        requestId: input.requestId,
        hash,
        commitmentId: row.commitment_id,
        obligationId: row.id,
        kind:
          input.kind === 'origin'
            ? 'timing_origin'
            : input.kind === 'observe'
              ? 'duration_observation'
              : 'duration_attestation',
        actor,
        reason: input.reason,
        evidence: input.evidenceReference,
        before: {
          timingVersion: row.timing_version,
          obligationVersion: row.version,
          originAt: row.origin_at?.toISOString() ?? null
        },
        after: after.timing
      }))
    )
      throw new SponsorshipCommitmentError('COMMITMENT_REQUEST_CONFLICT');
    await audit(
      db,
      actor,
      input.kind === 'origin'
        ? 'timing_origin'
        : input.kind === 'observe'
          ? 'duration_observation'
          : 'duration_attestation',
      row.contribution_id,
      input.requestId
    );
    return after;
  });
}
