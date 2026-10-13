import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

export class SponsorshipCommitmentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
export const text = (value: unknown, max = 2000): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max;
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const validateCommand = (
  input: unknown,
  idKey: 'contributionId' | 'obligationId',
  schema?: {
    readonly fields: readonly string[];
    readonly unknownFieldCode?: string;
  }
): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  const value = input as Record<string, unknown>;
  const fields = schema?.fields ?? [
    'requestId',
    idKey,
    'expectedVersion',
    'confirmation',
    'reason',
    ...(idKey === 'contributionId'
      ? ['evidenceReference', 'offer']
      : ['kind', 'target', 'format'])
  ];
  if (
    !isValidUuid(value.requestId) ||
    !isValidUuid(value[idKey]) ||
    value.confirmation !== value[idKey] ||
    !Number.isSafeInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 1 ||
    !text(value.reason)
  )
    throw new SponsorshipCommitmentError('COMMITMENT_INVALID', 400);
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new SponsorshipCommitmentError(
      schema?.unknownFieldCode ?? 'COMMITMENT_INVALID',
      400
    );
  return value;
};
export const prior = async (
  db: Pick<PoolClient, 'query'>,
  requestId: string,
  hash: string
): Promise<boolean> => {
  const result = await db.query<{ request_fingerprint: string }>(
    'SELECT request_fingerprint FROM sponsorship_commitment_changes WHERE request_id=$1::uuid',
    [requestId]
  );
  if (!result.rows[0]) return false;
  if (result.rows[0].request_fingerprint !== hash)
    throw new SponsorshipCommitmentError('COMMITMENT_REQUEST_CONFLICT');
  return true;
};
export const insertChange = async (
  db: PoolClient,
  input: {
    requestId: string;
    hash: string;
    commitmentId: string;
    obligationId?: string;
    kind: string;
    actor: string;
    reason: string;
    evidence?: string;
    before: unknown;
    after: unknown;
  }
): Promise<boolean> => {
  const result = await db.query(
    `INSERT INTO sponsorship_commitment_changes(request_id,request_fingerprint,commitment_id,obligation_id,kind,actor,reason,evidence_reference,previous_value,resulting_value)
    VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(request_id) DO NOTHING RETURNING id`,
    [
      input.requestId,
      input.hash,
      input.commitmentId,
      input.obligationId ?? null,
      input.kind,
      input.actor,
      input.reason,
      input.evidence ?? null,
      JSON.stringify(input.before),
      JSON.stringify(input.after)
    ]
  );
  if (result.rowCount) return true;
  await prior(db, input.requestId, input.hash);
  return false;
};
export const audit = async (
  db: PoolClient,
  actor: string,
  action: string,
  contributionId: string,
  requestId: string
): Promise<void> => {
  if (
    !(await insertAdminAuditLog(db, {
      actor,
      action: `sponsorship_commitment.${action}`,
      entityType: 'sponsorship',
      entityId: contributionId,
      summary:
        'Commercial commitment updated with an explicit administrative record.',
      metadata: { requestId }
    }))
  )
    throw new SponsorshipCommitmentError('COMMITMENT_AUDIT_UNAVAILABLE', 503);
};
