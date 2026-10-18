import { createHash } from 'node:crypto';

import type {
  PreparationAssistanceReview,
  PreparationAssistanceRun,
  PreparationAssistanceSource,
  PreparationAssistanceState,
  PreparationAssistanceSuggestion
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { preparationCitationsMatch } from '../../../../packages/funding-core/src/index.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

import { PreparationAssistanceError, requireAssistance } from './errors.js';
import { assistanceCapabilities, assistanceIsStale } from './projection.js';

export const assistanceDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceDigest = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

export interface AssistanceContext {
  readonly contributionId: string;
  readonly reference: string;
  readonly version: number;
  readonly state: 'needs_confirmation' | 'active';
  readonly amountMinor: number;
  readonly currency: string;
}

export async function assistanceContext(
  db: PoolClient,
  id: string,
  lock = false
): Promise<AssistanceContext> {
  const contribution = (
    await db.query<{
      id: string;
      reference: string;
      amount_minor: string;
      currency: string;
    }>(
      `SELECT id,COALESCE(public_reference,id::text) AS reference,
       amount_cents::text AS amount_minor,upper(currency) AS currency
       FROM fund_contributions WHERE id=$1::uuid AND contribution_type='sponsorship_interest'
       AND status IN ('paid','refunded','disputed') ${lock ? 'FOR UPDATE' : ''}`,
      [id]
    )
  ).rows[0];
  requireAssistance(contribution, 'ASSISTANCE_NOT_FOUND', 404);
  const commitment = (
    await db.query<{ version: number; state: AssistanceContext['state'] }>(
      `SELECT version,state FROM sponsorship_commitments WHERE contribution_id=$1::uuid ${lock ? 'FOR UPDATE' : ''}`,
      [id]
    )
  ).rows[0];
  requireAssistance(commitment, 'ASSISTANCE_COMMITMENT_NOT_FOUND', 404);
  return {
    contributionId: contribution.id,
    reference: contribution.reference,
    amountMinor: Number(contribution.amount_minor),
    currency: contribution.currency,
    ...commitment
  };
}

interface SourceRow {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly source_text: string;
  readonly fingerprint: string;
  readonly created_at: Date;
}

export async function loadAssistanceSource(
  db: PoolClient,
  contributionId: string,
  sourceId?: string
): Promise<PreparationAssistanceSource | null> {
  const row = (
    await db.query<SourceRow>(
      `SELECT * FROM preparation_assistance_sources WHERE contribution_id=$1::uuid
       AND ($2::uuid IS NULL OR id=$2::uuid) ORDER BY version DESC LIMIT 1`,
      [contributionId, sourceId ?? null]
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        version: row.version,
        title: row.title,
        text: row.source_text,
        fingerprint: row.fingerprint,
        createdAt: row.created_at.toISOString()
      }
    : null;
}

export interface AssistanceRunRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly source_id: string;
  readonly source_version: number;
  readonly commitment_version: number;
  readonly adapter: PreparationAssistanceRun['adapter'];
  readonly generation: number;
  readonly requested_by: string;
  readonly state: PreparationAssistanceRun['state'];
  readonly phase: PreparationAssistanceRun['phase'];
  readonly attempts: number;
  readonly claim_token: string | null;
  readonly error_code: string | null;
  readonly created_at: Date;
  readonly finished_at: Date | null;
}

export async function loadAssistanceRun(
  db: PoolClient,
  contributionId: string,
  runId?: string,
  lock = false
): Promise<AssistanceRunRow | null> {
  return (
    (
      await db.query<AssistanceRunRow>(
        `SELECT * FROM preparation_assistance_runs WHERE contribution_id=$1::uuid
       AND ($2::uuid IS NULL OR id=$2::uuid)
       ORDER BY created_at DESC,id DESC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
        [contributionId, runId ?? null]
      )
    ).rows[0] ?? null
  );
}

export async function loadAssistanceSuggestion(
  db: PoolClient,
  run: AssistanceRunRow
): Promise<PreparationAssistanceSuggestion | null> {
  const row = (
    await db.query<{ snapshot: PreparationAssistanceSuggestion }>(
      'SELECT snapshot FROM preparation_assistance_suggestions WHERE run_id=$1::uuid',
      [run.id]
    )
  ).rows[0];
  if (!row) return null;
  const source = await loadAssistanceSource(
    db,
    run.contribution_id,
    run.source_id
  );
  let valid = false;
  try {
    valid = !!source && preparationCitationsMatch(source, row.snapshot);
  } catch {
    // Persisted provider output is not trusted merely because it is valid JSON.
  }
  requireAssistance(valid, 'ASSISTANCE_SUGGESTION_INVALID', 409);
  return row.snapshot;
}

interface ReviewRow {
  readonly version: number;
  readonly decision: PreparationAssistanceReview['decision'];
  readonly draft: Pick<
    PreparationAssistanceReview,
    'offer' | 'items' | 'reason'
  >;
  readonly actor: string;
  readonly request_id: string;
  readonly created_at: Date;
  readonly applied_commitment_version: number | null;
}

export async function loadAssistanceReview(db: PoolClient, runId: string) {
  const row = (
    await db.query<ReviewRow>(
      `SELECT * FROM preparation_assistance_reviews WHERE run_id=$1::uuid
       ORDER BY version DESC LIMIT 1`,
      [runId]
    )
  ).rows[0];
  return row
    ? {
        review: {
          ...row.draft,
          version: row.version,
          decision: row.decision,
          actor: row.actor,
          createdAt: row.created_at.toISOString()
        } satisfies PreparationAssistanceReview,
        application:
          row.applied_commitment_version === null
            ? null
            : {
                requestId: row.request_id,
                appliedAt: row.created_at.toISOString(),
                commitmentVersion: row.applied_commitment_version
              }
      }
    : { review: null, application: null };
}

export async function projectAssistanceState(
  db: PoolClient,
  id: string
): Promise<PreparationAssistanceState> {
  const context = await assistanceContext(db, id);
  const source = await loadAssistanceSource(db, id);
  const row = await loadAssistanceRun(db, id);
  const suggestion = row ? await loadAssistanceSuggestion(db, row) : null;
  const reviewed = row
    ? await loadAssistanceReview(db, row.id)
    : { review: null, application: null };
  const stale = assistanceIsStale(
    source?.version ?? null,
    context.version,
    row
      ? {
          sourceVersion: row.source_version,
          commitmentVersion: row.commitment_version,
          appliedCommitmentVersion:
            reviewed.application?.commitmentVersion ?? null
        }
      : null
  );
  const run: PreparationAssistanceRun | null = row
    ? {
        id: row.id,
        sourceVersion: row.source_version,
        commitmentVersion: row.commitment_version,
        adapter: row.adapter,
        state: row.state,
        phase: row.phase,
        errorCode: row.error_code,
        createdAt: row.created_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        suggestion,
        ...reviewed
      }
    : null;
  const state = {
    contributionId: context.contributionId,
    reference: context.reference,
    source,
    run,
    stale,
    commitment: {
      version: context.version,
      state: context.state,
      amountMinor: context.amountMinor,
      currency: context.currency
    },
    capabilities: assistanceCapabilities(
      !!source,
      context.state === 'needs_confirmation',
      stale,
      run?.state ?? null,
      reviewed.review?.decision ?? null
    )
  };
  return { ...state, revision: assistanceDigest(state) };
}

export async function assistanceAudit(
  db: PoolClient,
  actor: string,
  contributionId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const written = await insertAdminAuditLog(db, {
    actor,
    action: 'preparation_assistance.' + action,
    entityType: 'sponsorship',
    entityId: contributionId,
    summary:
      'Private preparation assistance; no publication or payment authorized.',
    metadata
  });
  if (!written)
    throw new PreparationAssistanceError('ASSISTANCE_AUDIT_UNAVAILABLE', 503);
}
