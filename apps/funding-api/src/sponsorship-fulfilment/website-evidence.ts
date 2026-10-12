import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type { SponsorshipOfferedBenefit } from '@openg7/funding-core';

import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';
import { loadSponsorshipCommitment } from '../sponsorship-commitments.repository.js';
import {
  SPONSOR_WEBSITE_ELIGIBLE_SQL,
  SPONSOR_WEBSITE_VISIBLE_SQL
} from '../sponsorship-website-eligibility.js';
import { assert } from '../publication-automation/policy.js';
import {
  readWebsiteMediaSources,
  assertWebsiteMediaAttested,
  assertWebsiteRequiredElements,
  type WebsiteMediaAttestation
} from '../sponsorship-website-media.js';

import { fulfil } from './evidence-write.js';

type Db = Pool | PoolClient;

export interface WebsiteEvidenceSnapshot {
  readonly message: string;
  readonly sources: unknown;
  readonly media: unknown;
  readonly fingerprint: string;
}

/** Current controlled artifacts plus their authorizations; this is an instantaneous observation. */
export async function captureWebsiteEvidenceSnapshot(
  db: Db,
  contributionId: string,
  requiredElements: SponsorshipOfferedBenefit['requiredElements'],
  attestation: WebsiteMediaAttestation
): Promise<WebsiteEvidenceSnapshot> {
  const result = await db.query<{
    id: string;
    company: string;
    summary: string | null;
    version: string;
    logo_url: string | null;
    eligible: boolean;
    approvals: unknown;
  }>(
    `SELECT id,sponsor_company_name AS company,sponsor_public_summary AS summary,sponsor_logo_url AS logo_url,updated_at::text AS version,
    ((${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AND (${SPONSOR_WEBSITE_VISIBLE_SQL}) AND status='paid'
      AND sponsorship_refund_status='not_requested') AS eligible,
    (SELECT jsonb_agg(jsonb_build_object('subjectType',mc.subject_type,'subjectId',mc.subject_id,'decisionId',mc.current_decision_id)
      ORDER BY mc.subject_type,mc.subject_id) FROM moderation_cases mc
      WHERE (mc.subject_type='sponsorship' AND mc.subject_id=fund_contributions.id)
        OR (mc.subject_type='media' AND mc.subject_id IN (SELECT id FROM sponsor_media_assets WHERE contribution_id=fund_contributions.id))) AS approvals
    FROM fund_contributions WHERE id=$1::uuid`,
    [contributionId]
  );
  const source = result.rows[0];
  assert(source?.eligible, 'SOURCE_NOT_ELIGIBLE');
  const displayed = await readWebsiteMediaSources(
    db,
    contributionId,
    source.logo_url
  );
  assertWebsiteRequiredElements(
    contributionId,
    requiredElements,
    source.company,
    displayed,
    attestation
  );
  const media = displayed.map((row) => ({
    id: row.id,
    contributionId: row.contributionId,
    kind: row.kind,
    version: row.version,
    sourceHash: row.checksum,
    derivedHash: row.checksum,
    transform: 'identity-approved-webp-v1',
    mimeType: 'image/webp',
    width: row.width,
    height: row.height,
    alt: row.alt?.trim() || source.company + ' - image commanditaire',
    url: sponsorMediaPublicUrl(row.id),
    usage: row.usage,
    restrictionsReviewed: row.restrictionsReviewed
  }));
  const content = {
    message: [
      source.company,
      source.summary,
      ...media.map((image) => image.usage.credit)
    ]
      .filter(Boolean)
      .join('\n\n'),
    sources: [
      {
        ...source,
        logo_url: media.find((image) => image.kind === 'logo')?.url ?? null
      }
    ],
    media
  };
  return {
    ...content,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')
  };
}

export async function observeWebsiteExposure(
  db: Db,
  obligationId: string,
  contributionId: string,
  version: number,
  actor: string,
  snapshot: WebsiteEvidenceSnapshot
): Promise<{ id: string; observedAt: Date }> {
  await assertWebsiteExposurePassageNext(db, obligationId);
  const result = await db.query<{ id: string; observed_at: Date }>(
    `INSERT INTO sponsorship_website_exposure_observations
    (obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,actor)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id,observed_at`,
    [
      obligationId,
      contributionId,
      version,
      snapshot.fingerprint,
      snapshot.message,
      JSON.stringify(snapshot.sources),
      JSON.stringify(snapshot.media),
      actor
    ]
  );
  await db.query(
    'UPDATE sponsorship_obligation_timing SET version=version+1 WHERE obligation_id=$1::uuid',
    [obligationId]
  );
  return { id: result.rows[0]!.id, observedAt: result.rows[0]!.observed_at };
}

async function assertWebsiteExposurePassageNext(
  db: Db,
  obligationId: string
): Promise<void> {
  const result = await db.query<{ eligible: boolean; earlier_open: boolean }>(
    `SELECT (ob.channel='website' AND ob.target='openg7' AND ob.state='pending') AS eligible,
    EXISTS(SELECT 1 FROM sponsorship_obligations prior WHERE prior.commitment_id=ob.commitment_id AND prior.benefit_id=ob.benefit_id
      AND prior.ordinal<ob.ordinal AND prior.state IN ('pending','blocked')) AS earlier_open
    FROM sponsorship_obligations ob WHERE ob.id=$1::uuid`,
    [obligationId]
  );
  assert(result.rows[0]?.eligible, 'SOURCE_COMMITMENT_CHANGED');
  assert(!result.rows[0].earlier_open, 'DURATION_PREVIOUS_PASSAGE_OPEN');
}

/** Exact endpoints and the owner's supporting continuity evidence qualify a duration; elapsed time alone never does. */
export async function completeWebsiteExposureDuration(
  db: Db,
  input: {
    obligationId: string;
    contributionId: string;
    version: number;
    durationDays: number;
    startObservationId: string;
    evidenceReference: string;
    continuityConfirmed: true;
    actor: string;
    snapshot: WebsiteEvidenceSnapshot;
  }
): Promise<void> {
  assert(
    input.continuityConfirmed === true &&
      input.evidenceReference.trim().length > 0 &&
      input.evidenceReference.trim().length <= 2000,
    'DURATION_ATTESTATION_REQUIRED',
    400
  );
  await assertWebsiteExposurePassageNext(db, input.obligationId);
  const start = await db.query<{
    content_fingerprint: string;
    elapsed: boolean;
    sequential: boolean;
  }>(
    `SELECT v.content_fingerprint,
    v.observed_at+t.duration_days*INTERVAL '24 hours' <= clock_timestamp() AS elapsed,
    NOT EXISTS(SELECT 1 FROM sponsorship_obligations prior
      LEFT JOIN sponsorship_fulfilment_evidence e ON e.id=prior.fulfilment_evidence_id AND e.obligation_id=prior.id
      WHERE prior.commitment_id=ob.commitment_id AND prior.benefit_id=ob.benefit_id AND prior.ordinal<ob.ordinal
        AND prior.state IN ('fulfilled','adjusted') AND v.observed_at<COALESCE(e.delivered_at,prior.updated_at)) AS sequential
    FROM sponsorship_website_exposure_observations v
    JOIN sponsorship_obligation_timing t ON t.obligation_id=v.obligation_id
    JOIN sponsorship_obligations ob ON ob.id=v.obligation_id
    WHERE v.id=$1::uuid AND v.obligation_id=$2::uuid AND v.contribution_id=$3::uuid AND v.obligation_version=$5
      AND t.duration_days=$4::integer AND ob.channel='website' AND ob.target='openg7'`,
    [
      input.startObservationId,
      input.obligationId,
      input.contributionId,
      input.durationDays,
      input.version
    ]
  );
  assert(start.rows[0], 'DURATION_OBSERVATION_NOT_FOUND');
  assert(start.rows[0].sequential, 'DURATION_PERIOD_OVERLAP');
  assert(
    start.rows[0].content_fingerprint === input.snapshot.fingerprint,
    'DURATION_SOURCE_CHANGED'
  );
  assert(start.rows[0].elapsed, 'DURATION_NOT_ELAPSED');
  const end = await observeWebsiteExposure(
    db,
    input.obligationId,
    input.contributionId,
    input.version,
    input.actor,
    input.snapshot
  );
  await fulfil(db, {
    obligationId: input.obligationId,
    contributionId: input.contributionId,
    obligationVersion: input.version,
    channel: 'website',
    target: 'openg7',
    deliveryId: null,
    deliveryVersion: null,
    accountId: 'openg7:website',
    provenance: 'website_verified',
    externalPostId: null,
    externalPostUrl: null,
    message: input.snapshot.message,
    sources: input.snapshot.sources,
    media: input.snapshot.media,
    actor: input.actor
  });
  await db.query(
    `INSERT INTO sponsorship_obligation_duration_attestations
    (obligation_id,fulfilment_evidence_id,start_observation_id,end_observation_id,actor,supporting_evidence_reference,continuity_confirmed)
    SELECT id,fulfilment_evidence_id,$2::uuid,$3::uuid,$4,$5,TRUE FROM sponsorship_obligations WHERE id=$1::uuid`,
    [
      input.obligationId,
      input.startObservationId,
      end.id,
      input.actor,
      input.evidenceReference
    ]
  );
}

/** Only the explicit visibility command for the real OpenG7 directory calls this port. */
export async function recordWebsiteFulfilment(
  db: Db,
  contributionId: string,
  actor: string,
  attestation: WebsiteMediaAttestation
): Promise<void> {
  const result = await db.query<{
    id: string;
    company: string;
    summary: string | null;
    version: string;
    logo_url: string | null;
    eligible: boolean;
  }>(
    `SELECT id,sponsor_company_name AS company,sponsor_public_summary AS summary,sponsor_logo_url AS logo_url,updated_at::text AS version,
      ((${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AND (${SPONSOR_WEBSITE_VISIBLE_SQL}) AND status='paid'
        AND sponsorship_refund_status NOT IN ('requested','processing')
        AND NOT (sponsorship_refund_status='completed' AND COALESCE(sponsorship_refund_amount_cents,0)>=amount_cents)) AS eligible
      FROM fund_contributions WHERE id=$1::uuid`,
    [contributionId]
  );
  const source = result.rows[0];
  assert(source?.eligible, 'SOURCE_NOT_ELIGIBLE');
  // These are the exact approved WebP artifacts served by the controlled public
  // media route. A social JPEG is a different artifact and is never claimed here.
  const displayed = await readWebsiteMediaSources(
    db,
    contributionId,
    source.logo_url
  );
  assertWebsiteMediaAttested(contributionId, displayed, attestation);
  const commitment = await loadSponsorshipCommitment(db, contributionId);
  if (commitment?.state !== 'active') return;
  const obligation = commitment.obligations.find(
    (o) =>
      o.channel === 'website' &&
      o.target === 'openg7' &&
      ['pending', 'blocked'].includes(o.state)
  );
  if (!obligation) return;
  // Visibility remains available to eligible historical dossiers after a
  // partial refund. Blocked commercial work must not receive a fulfilment proof.
  if (
    obligation.state === 'blocked' &&
    !['required_elements_missing', 'duration_unsupported'].includes(
      obligation.blockedReason ?? ''
    )
  )
    return;
  const benefit = commitment.offer?.benefits.find(
    (b) => b.id === obligation.benefitId
  );
  assert(benefit, 'SOURCE_COMMITMENT_CHANGED');
  const snapshot = await captureWebsiteEvidenceSnapshot(
    db,
    contributionId,
    benefit.requiredElements,
    attestation
  );
  // An instantaneous controlled placement begins observation, never duration fulfilment.
  if (benefit.durationDays !== null) {
    if (obligation.target === 'openg7') {
      await observeWebsiteExposure(
        db,
        obligation.id,
        contributionId,
        obligation.version,
        actor,
        snapshot
      );
    }
    return;
  }
  // One visibility transition is one passage, even when a historical agreement promises several.
  await fulfil(db, {
    obligationId: obligation.id,
    contributionId,
    obligationVersion: obligation.version,
    channel: 'website',
    target: 'openg7',
    deliveryId: null,
    deliveryVersion: null,
    accountId: 'openg7:website',
    provenance: 'website_verified',
    externalPostId: null,
    externalPostUrl: null,
    message: snapshot.message,
    sources: snapshot.sources,
    media: snapshot.media,
    actor
  });
}
