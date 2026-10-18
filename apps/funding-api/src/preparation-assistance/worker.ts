import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  extractPreparationPublications,
  preparationCitationsMatch,
  type PreparationAssistanceSource,
  type PreparationAssistanceSuggestion
} from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { requireAssistance } from './errors.js';
import {
  assistanceAudit,
  assistanceContext,
  loadAssistanceSource,
  type AssistanceRunRow
} from './persistence.js';

type LocalAnalysis = (
  source: PreparationAssistanceSource
) => PreparationAssistanceSuggestion | Promise<PreparationAssistanceSuggestion>;

/** One bounded local job, durably fenced against crashes, expired leases and source changes. */
export async function tickPreparationAssistance(
  pool: Pool,
  analyze: LocalAnalysis = extractPreparationPublications
): Promise<void> {
  const token = randomUUID();
  const claimed = await withPostgresTransaction(pool, async (db) => {
    // An expired final attempt becomes terminal instead of displaying processing indefinitely.
    const exhausted = await db.query<AssistanceRunRow>(
      `UPDATE preparation_assistance_runs SET state='failed',phase='finished',claim_token=NULL,
       lease_expires_at=NULL,finished_at=clock_timestamp(),error_code='ASSISTANCE_ATTEMPTS_EXHAUSTED'
       WHERE id IN (SELECT id FROM preparation_assistance_runs
         WHERE state='processing' AND lease_expires_at<=clock_timestamp() AND attempts>=3
         ORDER BY created_at,id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`
    );
    for (const run of exhausted.rows)
      await assistanceAudit(
        db,
        'preparation-assistance-worker',
        run.contribution_id,
        'analysis_failed',
        { runId: run.id, code: 'ASSISTANCE_ATTEMPTS_EXHAUSTED' }
      );
    const run = (
      await db.query<AssistanceRunRow>(
        `UPDATE preparation_assistance_runs SET state='processing',phase='extracting',
         attempts=attempts+1,claim_token=$1::uuid,lease_expires_at=clock_timestamp()+INTERVAL '30 seconds',
         error_code=NULL
         WHERE id=(SELECT id FROM preparation_assistance_runs WHERE
           (state='queued' OR (state='processing' AND lease_expires_at<=clock_timestamp())) AND attempts<3
           ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
        [token]
      )
    ).rows[0];
    if (!run) return null;
    const source = await loadAssistanceSource(
      db,
      run.contribution_id,
      run.source_id
    );
    requireAssistance(source, 'ASSISTANCE_SOURCE_INVALID', 409);
    await assistanceAudit(
      db,
      'preparation-assistance-worker',
      run.contribution_id,
      'analysis_started',
      {
        runId: run.id,
        sourceId: source.id,
        sourceVersion: source.version,
        attempt: run.attempts
      }
    );
    return { run, source };
  });
  if (!claimed) return;

  let suggestion: PreparationAssistanceSuggestion | null = null;
  let failure: string | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    suggestion = await Promise.race([
      Promise.resolve().then(() => analyze(claimed.source)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('ASSISTANCE_ANALYSIS_TIMEOUT')),
          5000
        );
      })
    ]);
    requireAssistance(
      preparationCitationsMatch(claimed.source, suggestion),
      'ASSISTANCE_SUGGESTION_INVALID'
    );
  } catch (error) {
    const safe = error instanceof Error ? error.message : '';
    failure = [
      'ASSISTANCE_TOO_MANY_CLAUSES',
      'ASSISTANCE_SOURCE_INVALID',
      'ASSISTANCE_ANALYSIS_TIMEOUT',
      'ASSISTANCE_SUGGESTION_INVALID'
    ].includes(safe)
      ? safe
      : 'ASSISTANCE_ANALYSIS_FAILED';
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  await withPostgresTransaction(pool, async (db) => {
    // Mutations all lock contribution before run, including a source replacement during analysis.
    const context = await assistanceContext(
      db,
      claimed.run.contribution_id,
      true
    );
    const current = (
      await db.query<AssistanceRunRow>(
        `SELECT * FROM preparation_assistance_runs WHERE id=$1::uuid AND state='processing'
         AND claim_token=$2::uuid AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        [claimed.run.id, token]
      )
    ).rows[0];
    if (!current) return; // A newer attempt or source change owns any remaining work.
    const latest = await loadAssistanceSource(db, current.contribution_id);
    const superseded =
      latest?.id !== current.source_id ||
      context.version !== current.commitment_version ||
      context.state !== 'needs_confirmation';
    const state = superseded ? 'cancelled' : failure ? 'failed' : 'succeeded';
    const code = superseded ? 'ASSISTANCE_STALE' : failure;
    if (state === 'succeeded') {
      await db.query(
        "UPDATE preparation_assistance_runs SET phase='verifying' WHERE id=$1::uuid",
        [current.id]
      );
      await db.query(
        `INSERT INTO preparation_assistance_suggestions(run_id,snapshot) VALUES($1::uuid,$2::jsonb)`,
        [current.id, JSON.stringify(suggestion)]
      );
    }
    await db.query(
      `UPDATE preparation_assistance_runs SET state=$2,phase='finished',error_code=$3,finished_at=clock_timestamp(),
       claim_token=NULL,lease_expires_at=NULL WHERE id=$1::uuid`,
      [current.id, state, code]
    );
    await assistanceAudit(
      db,
      'preparation-assistance-worker',
      current.contribution_id,
      state === 'succeeded'
        ? 'suggestion_generated'
        : state === 'cancelled'
          ? 'analysis_cancelled'
          : 'analysis_failed',
      {
        runId: current.id,
        sourceId: current.source_id,
        sourceVersion: current.source_version,
        adapter: current.adapter,
        result: state,
        code
      }
    );
  });
}
