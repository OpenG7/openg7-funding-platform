import type { PoolClient } from 'pg';

import {
  PREPARATION_ASSISTANCE_ADAPTER,
  type PreparationAssistanceSource
} from '../../../../packages/funding-core/src/index.js';

import { requireAssistance } from './errors.js';
import { assistanceAudit, type AssistanceContext } from './persistence.js';

/** Caller owns the contribution lock and the source/request transaction. */
export async function enqueueAssistanceRun(
  db: PoolClient,
  context: AssistanceContext,
  source: Pick<PreparationAssistanceSource, 'id' | 'version'>,
  actor: string,
  command: {
    readonly requestId: string;
    readonly rerun: boolean;
    readonly automatic: boolean;
  }
): Promise<string> {
  requireAssistance(
    context.state === 'needs_confirmation',
    'ASSISTANCE_COMMITMENT_VERSION_CONFLICT'
  );
  const existing = (
    await db.query<{ id: string; generation: number; state: string }>(
      `SELECT id,generation,state FROM preparation_assistance_runs WHERE source_id=$1::uuid
       AND commitment_version=$2 AND adapter=$3 ORDER BY generation DESC LIMIT 1`,
      [source.id, context.version, PREPARATION_ASSISTANCE_ADAPTER]
    )
  ).rows[0];
  // A normal submission never restarts terminal work. Reanalysis is always explicit.
  if (
    existing &&
    (!command.rerun || ['queued', 'processing'].includes(existing.state))
  )
    return existing.id;
  const run = (
    await db.query<{ id: string }>(
      `INSERT INTO preparation_assistance_runs(contribution_id,source_id,source_version,commitment_version,
       adapter,generation,requested_by) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING id`,
      [
        context.contributionId,
        source.id,
        source.version,
        context.version,
        PREPARATION_ASSISTANCE_ADAPTER,
        (existing?.generation ?? 0) + 1,
        actor
      ]
    )
  ).rows[0]!;
  await assistanceAudit(
    db,
    actor,
    context.contributionId,
    command.rerun ? 'reanalyzed' : 'analysis_queued',
    {
      requestId: command.requestId,
      runId: run.id,
      sourceId: source.id,
      sourceVersion: source.version,
      automatic: command.automatic
    }
  );
  return run.id;
}
