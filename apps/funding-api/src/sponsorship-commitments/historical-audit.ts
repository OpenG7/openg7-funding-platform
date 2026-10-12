import { createHash } from 'node:crypto';

import type {
  SponsorshipHistoricalAuditFilter,
  SponsorshipHistoricalAuditItem,
  SponsorshipHistoricalAuditPreview,
  SponsorshipHistoricalAuditReviewResponse
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

import { SponsorshipCommitmentError, text } from './change-support.js';
import { historicalAuditProjectionSql } from './historical-audit-projection.js';

const filters = [
  'duration_unverified',
  'required_element_missing',
  'snapshot_incomplete',
  'no_issue_detected'
] as const;
interface Cursor {
  readonly asOf: string;
  readonly recordedAt: string;
  readonly evidenceId: string;
  readonly finding: SponsorshipHistoricalAuditFilter | null;
  readonly contributionId: string | null;
}
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const decodeCursor = (input: string): Cursor => {
  try {
    if (input.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input))
      throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(input, 'base64url').toString('utf8')
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    const cursor = value as Cursor;
    if (
      !date(cursor.asOf) ||
      !date(cursor.recordedAt) ||
      !isValidUuid(cursor.evidenceId) ||
      (cursor.finding !== null && !filters.includes(cursor.finding)) ||
      (cursor.contributionId !== null && !isValidUuid(cursor.contributionId)) ||
      Date.parse(cursor.recordedAt) > Date.parse(cursor.asOf)
    )
      throw new Error();
    return cursor;
  } catch {
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_INVALID', 400);
  }
};

/** Repeatable-read owner inventory. Counts are global and snapshot metadata never leaves this boundary. */
export const previewSponsorshipHistoricalAudit = async (
  db: Pick<PoolClient, 'query'>,
  input: {
    readonly pageSize?: number;
    readonly cursor?: string | null;
    readonly finding?: string | null;
    readonly contributionId?: string | null;
  } = {}
): Promise<SponsorshipHistoricalAuditPreview> => {
  const pageSize = input.pageSize ?? 25;
  const finding = input.finding ?? null;
  const contributionId = input.contributionId ?? null;
  if (
    ![25, 50, 100].includes(pageSize) ||
    (finding !== null &&
      !filters.includes(finding as SponsorshipHistoricalAuditFilter)) ||
    (contributionId !== null && !isValidUuid(contributionId))
  )
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_INVALID', 400);
  const cursor = input.cursor != null ? decodeCursor(input.cursor) : null;
  if (
    cursor &&
    (cursor.finding !== finding || cursor.contributionId !== contributionId)
  )
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_INVALID', 400);
  const asOf =
    cursor?.asOf ??
    (
      await db.query<{ asOf: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "asOf"`
      )
    ).rows[0]!.asOf;
  const result = await db.query<{
    totals: SponsorshipHistoricalAuditPreview['totals'];
    items: (SponsorshipHistoricalAuditItem & { recordedAt: string })[];
  }>(
    `${historicalAuditProjectionSql}, filtered AS (
    SELECT * FROM classified WHERE ($2::text IS NULL OR CASE WHEN $2='no_issue_detected' THEN cardinality(findings)=0 ELSE $2=ANY(findings) END)
      AND ($3::uuid IS NULL OR contribution_id=$3::uuid)
  ), page AS (
    SELECT selected.*,review.id AS review_id,review.conclusion,review.reviewed_at,COALESCE(review.review_version,0) AS review_version
    FROM (SELECT * FROM filtered WHERE ($4::timestamptz IS NULL OR (recorded_at,id)>($4::timestamptz,$5::uuid)) ORDER BY recorded_at,id LIMIT $6) selected
    LEFT JOIN LATERAL(SELECT * FROM sponsorship_historical_evidence_reviews review WHERE review.evidence_id=selected.id ORDER BY review.review_version DESC LIMIT 1) review ON TRUE
  ) SELECT jsonb_build_object(
    'evidence',(SELECT count(*) FROM classified),'filtered',(SELECT count(*) FROM filtered),
    'unreviewed',(SELECT count(*) FROM classified WHERE NOT EXISTS(SELECT 1 FROM sponsorship_historical_evidence_reviews review WHERE review.evidence_id=classified.id)),
    'durationUnverified',(SELECT count(*) FROM classified WHERE 'duration_unverified'=ANY(findings)),
    'requiredElementMissing',(SELECT count(*) FROM classified WHERE 'required_element_missing'=ANY(findings)),
    'snapshotIncomplete',(SELECT count(*) FROM classified WHERE 'snapshot_incomplete'=ANY(findings)),
    'noIssueDetected',(SELECT count(*) FROM classified WHERE cardinality(findings)=0)) AS totals,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'evidenceId',id,'obligationId',obligation_id,'contributionId',contribution_id,'benefitId',benefit_id,
      'channel',channel,'target',target,'deliveredAt',to_char(delivered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'recordedAt',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'durationDays',benefit->'durationDays','requirements',requirement_observations,'findings',findings,'reviewVersion',review_version,
      'latestReview',CASE WHEN review_id IS NULL THEN NULL ELSE jsonb_build_object('id',review_id,'conclusion',conclusion,'reviewedAt',to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END)
      ORDER BY recorded_at,id) FROM page),'[]'::jsonb) AS items`,
    [
      asOf,
      finding,
      contributionId,
      cursor?.recordedAt ?? null,
      cursor?.evidenceId ?? null,
      pageSize + 1
    ]
  );
  const row = result.rows[0]!;
  const selected = row.items.slice(0, pageSize);
  const last = selected.at(-1);
  return {
    items: selected.map((item) => ({
      evidenceId: item.evidenceId,
      obligationId: item.obligationId,
      contributionId: item.contributionId,
      benefitId: item.benefitId,
      channel: item.channel,
      target: item.target,
      deliveredAt: item.deliveredAt,
      durationDays: item.durationDays,
      requirements: item.requirements,
      findings: item.findings,
      reviewVersion: item.reviewVersion,
      latestReview: item.latestReview
    })),
    totals: row.totals,
    pageSize,
    asOf,
    nextCursor:
      row.items.length > pageSize && last
        ? Buffer.from(
            JSON.stringify({
              asOf,
              recordedAt: last.recordedAt,
              evidenceId: last.evidenceId,
              finding: finding as SponsorshipHistoricalAuditFilter | null,
              contributionId
            } satisfies Cursor)
          ).toString('base64url')
        : null
  };
};

/** Append-only human conclusions. Acknowledgement grants no correction, approval, send or refund. */
export const reviewSponsorshipHistoricalEvidence = async (
  db: PoolClient,
  input: unknown,
  actor: string
): Promise<SponsorshipHistoricalAuditReviewResponse> => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_INVALID', 400);
  const value = input as Record<string, unknown>;
  if (
    !isValidUuid(value.requestId) ||
    !isValidUuid(value.evidenceId) ||
    value.confirmation !== value.evidenceId ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 0 ||
    !text(value.reason) ||
    !text(actor, 500) ||
    !['confirmed', 'follow_up_required', 'inconclusive'].includes(
      String(value.conclusion)
    ) ||
    Object.keys(value).some(
      (key) =>
        ![
          'requestId',
          'evidenceId',
          'expectedVersion',
          'confirmation',
          'conclusion',
          'reason'
        ].includes(key)
    )
  )
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_INVALID', 400);
  const requestFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        evidenceId: value.evidenceId,
        expectedVersion: value.expectedVersion,
        confirmation: value.confirmation,
        conclusion: value.conclusion,
        reason: (value.reason as string).trim()
      })
    )
    .digest('hex');
  // Serialise both UUID replays and versions before consulting the receipt.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `historical-evidence-review:${value.requestId}`
  ]);
  const prior = (
    await db.query<{
      evidenceId: string;
      reviewVersion: number;
      review: SponsorshipHistoricalAuditReviewResponse['review'];
      requestFingerprint: string;
    }>(
      `SELECT evidence_id AS "evidenceId",review_version AS "reviewVersion",request_fingerprint AS "requestFingerprint",
      jsonb_build_object('id',id,'conclusion',conclusion,'reviewedAt',to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS review
      FROM sponsorship_historical_evidence_reviews WHERE request_id=$1::uuid`,
      [value.requestId]
    )
  ).rows[0];
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint)
      throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_REQUEST_CONFLICT');
    return {
      evidenceId: prior.evidenceId,
      reviewVersion: prior.reviewVersion,
      review: prior.review
    };
  }
  const evidence = (
    await db.query<{ contributionId: string }>(
      'SELECT contribution_id AS "contributionId" FROM sponsorship_fulfilment_evidence WHERE id=$1::uuid FOR UPDATE',
      [value.evidenceId]
    )
  ).rows[0];
  if (!evidence)
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_NOT_FOUND', 404);
  const reviewVersion = Number(
    (
      await db.query<{ version: number }>(
        'SELECT COALESCE(max(review_version),0) AS version FROM sponsorship_historical_evidence_reviews WHERE evidence_id=$1::uuid',
        [value.evidenceId]
      )
    ).rows[0]!.version
  );
  if (reviewVersion !== value.expectedVersion)
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_VERSION_CONFLICT');
  const review = (
    await db.query<{
      review: SponsorshipHistoricalAuditReviewResponse['review'];
    }>(
      `INSERT INTO sponsorship_historical_evidence_reviews(evidence_id,request_id,request_fingerprint,review_version,conclusion,reason,actor)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING jsonb_build_object('id',id,'conclusion',conclusion,'reviewedAt',to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS review`,
      [
        value.evidenceId,
        value.requestId,
        requestFingerprint,
        reviewVersion + 1,
        value.conclusion,
        (value.reason as string).trim(),
        actor
      ]
    )
  ).rows[0]!.review;
  if (
    !(await insertAdminAuditLog(db, {
      actor,
      action: 'sponsorship_evidence.historical_reviewed',
      entityType: 'sponsorship',
      entityId: evidence.contributionId,
      summary:
        'Historical qualified evidence examined without rewriting its commercial or financial facts.',
      metadata: {
        requestId: value.requestId,
        evidenceId: value.evidenceId,
        reviewId: review.id,
        reviewVersion: reviewVersion + 1,
        conclusion: value.conclusion
      }
    }))
  )
    throw new SponsorshipCommitmentError('HISTORICAL_AUDIT_UNAVAILABLE', 503);
  return {
    evidenceId: value.evidenceId,
    reviewVersion: reviewVersion + 1,
    review
  };
};
