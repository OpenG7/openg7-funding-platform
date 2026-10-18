import type { Pool, PoolClient } from 'pg';

import {
  PREPARATION_SOURCE_MAX_LENGTH,
  normalizePreparationAssistanceDraft,
  type PreparationAssistanceSummary,
  type PreparationAssistanceState
} from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { isValidUuid } from '../business-helpers/request-validation.js';
import { qualifySponsorshipCommitment } from '../sponsorship-commitments/qualification.js';
import { SponsorshipCommitmentError } from '../sponsorship-commitments/change-support.js';

import {
  canonicalAssistanceInput,
  isAssistanceVersion,
  parseAssistanceCommand,
  recordedAssistanceRequest,
  type AssistanceAction,
  type AssistanceCommand
} from './commands.js';
import { PreparationAssistanceError, requireAssistance } from './errors.js';
import {
  assistanceAudit,
  assistanceContext,
  assistanceDigest,
  loadAssistanceReview,
  loadAssistanceRun,
  loadAssistanceSource,
  loadAssistanceSuggestion,
  projectAssistanceState,
  sourceDigest,
  type AssistanceContext
} from './persistence.js';
import { tickPreparationAssistance } from './worker.js';
import { enqueueAssistanceRun } from './queue.js';
import { projectAssistanceSummary } from './summary.js';

/** Private assistance has no Stripe, email, publication or external model port. */
export class PreparationAssistanceService {
  constructor(private readonly pool: Pool) {}

  async read(contributionId: string): Promise<PreparationAssistanceState> {
    requireAssistance(
      isValidUuid(contributionId),
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    try {
      return await withPostgresTransaction(
        this.pool,
        (db) => projectAssistanceState(db, contributionId),
        { readOnlySnapshot: true }
      );
    } catch (error) {
      if (error instanceof PreparationAssistanceError) throw error;
      throw new PreparationAssistanceError('ASSISTANCE_UNAVAILABLE', 503);
    }
  }

  async summary(contributionId: string): Promise<PreparationAssistanceSummary> {
    requireAssistance(
      isValidUuid(contributionId),
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    try {
      return await withPostgresTransaction(
        this.pool,
        (db) => projectAssistanceSummary(db, contributionId),
        { readOnlySnapshot: true }
      );
    } catch (error) {
      if (error instanceof PreparationAssistanceError) throw error;
      throw new PreparationAssistanceError('ASSISTANCE_UNAVAILABLE', 503);
    }
  }

  private async command(
    input: AssistanceCommand,
    action: AssistanceAction,
    actor: string,
    execute: (db: PoolClient, context: AssistanceContext) => Promise<string>
  ): Promise<PreparationAssistanceState> {
    requireAssistance(
      typeof actor === 'string' &&
        actor.trim().length > 0 &&
        actor.length <= 200,
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    const hash = assistanceDigest(
      canonicalAssistanceInput({ input, action, actor })
    );
    try {
      return await withPostgresTransaction(
        this.pool,
        async (db) => {
          // UUID ownership is global; all dossier mutations then use the existing contribution-first order.
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            ['preparation-assistance:' + input.requestId]
          );
          const context = await assistanceContext(
            db,
            input.contributionId,
            true
          );
          if (await recordedAssistanceRequest(db, input, action, actor, hash))
            return projectAssistanceState(db, input.contributionId);
          const resultId = await execute(db, context);
          await db.query(
            `INSERT INTO preparation_assistance_requests(request_id,contribution_id,action,actor,request_hash,result_id)
           VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid)`,
            [
              input.requestId,
              input.contributionId,
              action,
              actor,
              hash,
              resultId
            ]
          );
          return projectAssistanceState(db, input.contributionId);
        },
        { preserveOriginalError: true }
      );
    } catch (error) {
      if (error instanceof PreparationAssistanceError) throw error;
      if (error instanceof SponsorshipCommitmentError)
        throw new PreparationAssistanceError(error.code, error.status);
      // COMMIT may have succeeded before the connection failed. Reconcile, never replay a mutation.
      try {
        const recovered = await withPostgresTransaction(
          this.pool,
          async (db) =>
            (await recordedAssistanceRequest(db, input, action, actor, hash))
              ? projectAssistanceState(db, input.contributionId)
              : null,
          { readOnlySnapshot: true }
        );
        if (recovered) return recovered;
      } catch (recoveryError) {
        if (
          recoveryError instanceof PreparationAssistanceError &&
          recoveryError.code === 'ASSISTANCE_REQUEST_CONFLICT'
        )
          throw recoveryError;
      }
      throw new PreparationAssistanceError('ASSISTANCE_UNAVAILABLE', 503);
    }
  }

  saveSource(raw: unknown, actor: string): Promise<PreparationAssistanceState> {
    const input = parseAssistanceCommand(raw, [
      'expectedSourceVersion',
      'title',
      'text'
    ]);
    requireAssistance(
      (input.expectedSourceVersion === null ||
        isAssistanceVersion(input.expectedSourceVersion)) &&
        typeof input.title === 'string' &&
        input.title.trim().length > 0 &&
        input.title.length <= 200 &&
        !input.title.includes('\0') &&
        !/[\uD800-\uDFFF]/u.test(input.title) &&
        typeof input.text === 'string' &&
        input.text.trim().length > 0 &&
        input.text.length <= PREPARATION_SOURCE_MAX_LENGTH &&
        !input.text.includes('\0') &&
        !/[\uD800-\uDFFF]/u.test(input.text),
      'ASSISTANCE_SOURCE_INVALID',
      400
    );
    const title = input.title.trim();
    const text = input.text;
    return this.command(input, 'source', actor, async (db, context) => {
      const previous = await loadAssistanceSource(db, context.contributionId);
      requireAssistance(
        (previous?.version ?? null) === input.expectedSourceVersion,
        'ASSISTANCE_SOURCE_VERSION_CONFLICT'
      );
      if (previous?.title === title && previous.text === text)
        return previous.id;
      const source = (
        await db.query<{ id: string; version: number }>(
          `INSERT INTO preparation_assistance_sources(contribution_id,version,title,source_text,fingerprint,actor)
           VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id,version`,
          [
            context.contributionId,
            (previous?.version ?? 0) + 1,
            title,
            text,
            sourceDigest(text),
            actor
          ]
        )
      ).rows[0]!;
      const cancelled = await db.query<{ id: string }>(
        `UPDATE preparation_assistance_runs SET state='cancelled',phase='finished',claim_token=NULL,
         lease_expires_at=NULL,finished_at=clock_timestamp(),error_code='ASSISTANCE_SOURCE_CHANGED'
         WHERE contribution_id=$1::uuid AND state IN ('queued','processing') RETURNING id`,
        [context.contributionId]
      );
      for (const run of cancelled.rows)
        await assistanceAudit(
          db,
          actor,
          context.contributionId,
          'analysis_cancelled',
          {
            requestId: input.requestId,
            runId: run.id,
            code: 'ASSISTANCE_SOURCE_CHANGED'
          }
        );
      await assistanceAudit(
        db,
        actor,
        context.contributionId,
        'source_recorded',
        {
          requestId: input.requestId,
          sourceId: source.id,
          sourceVersion: (previous?.version ?? 0) + 1
        }
      );
      if (context.state === 'needs_confirmation')
        await enqueueAssistanceRun(db, context, source, actor, {
          requestId: input.requestId,
          rerun: false,
          automatic: true
        });
      return source.id;
    });
  }

  enqueue(raw: unknown, actor: string): Promise<PreparationAssistanceState> {
    const input = parseAssistanceCommand(raw, [
      'sourceVersion',
      'expectedCommitmentVersion',
      'rerun'
    ]);
    requireAssistance(
      isAssistanceVersion(input.sourceVersion) &&
        isAssistanceVersion(input.expectedCommitmentVersion) &&
        typeof input.rerun === 'boolean',
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    return this.command(input, 'run', actor, async (db, context) => {
      const source = await loadAssistanceSource(db, context.contributionId);
      requireAssistance(
        source && source.version === input.sourceVersion,
        'ASSISTANCE_SOURCE_VERSION_CONFLICT'
      );
      requireAssistance(
        context.version === input.expectedCommitmentVersion &&
          context.state === 'needs_confirmation',
        'ASSISTANCE_COMMITMENT_VERSION_CONFLICT'
      );
      return enqueueAssistanceRun(db, context, source, actor, {
        requestId: input.requestId,
        rerun: input.rerun as boolean,
        automatic: false
      });
    });
  }

  review(raw: unknown, actor: string): Promise<PreparationAssistanceState> {
    const input = parseAssistanceCommand(raw, [
      'runId',
      'expectedReviewVersion',
      'decision',
      'draft'
    ]);
    requireAssistance(
      isValidUuid(input.runId) &&
        isAssistanceVersion(input.expectedReviewVersion, 0) &&
        ['save', 'reject'].includes(String(input.decision)),
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    return this.command(input, 'review', actor, async (db, context) => {
      const prepared = await this.reviewable(
        db,
        context,
        String(input.runId),
        Number(input.expectedReviewVersion)
      );
      const draft = this.normalizeDraft(input.draft, prepared.suggestion);
      const review = (
        await db.query<{ id: string }>(
          `INSERT INTO preparation_assistance_reviews(contribution_id,run_id,version,decision,draft,actor,request_id)
           VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7::uuid) RETURNING id`,
          [
            context.contributionId,
            input.runId,
            prepared.version + 1,
            input.decision === 'save' ? 'saved' : 'rejected',
            JSON.stringify(draft),
            actor,
            input.requestId
          ]
        )
      ).rows[0]!;
      await assistanceAudit(
        db,
        actor,
        context.contributionId,
        input.decision === 'save' ? 'review_saved' : 'suggestion_rejected',
        {
          requestId: input.requestId,
          runId: input.runId,
          reviewVersion: prepared.version + 1,
          previousReviewVersion: prepared.version
        }
      );
      return review.id;
    });
  }

  apply(raw: unknown, actor: string): Promise<PreparationAssistanceState> {
    const input = parseAssistanceCommand(raw, [
      'runId',
      'sourceVersion',
      'expectedCommitmentVersion',
      'expectedReviewVersion',
      'confirmation',
      'draft'
    ]);
    requireAssistance(
      isValidUuid(input.runId) &&
        isAssistanceVersion(input.sourceVersion) &&
        isAssistanceVersion(input.expectedCommitmentVersion) &&
        isAssistanceVersion(input.expectedReviewVersion, 0) &&
        input.confirmation === input.contributionId,
      'ASSISTANCE_INVALID_REQUEST',
      400
    );
    return this.command(input, 'apply', actor, async (db, context) => {
      requireAssistance(
        context.version === input.expectedCommitmentVersion &&
          context.state === 'needs_confirmation',
        'ASSISTANCE_COMMITMENT_VERSION_CONFLICT'
      );
      const prepared = await this.reviewable(
        db,
        context,
        String(input.runId),
        Number(input.expectedReviewVersion)
      );
      requireAssistance(
        prepared.run.source_version === input.sourceVersion,
        'ASSISTANCE_SOURCE_VERSION_CONFLICT'
      );
      const draft = this.normalizeDraft(input.draft, prepared.suggestion, true);
      const commitment = await qualifySponsorshipCommitment(
        db,
        {
          requestId: input.requestId,
          contributionId: context.contributionId,
          expectedVersion: context.version,
          confirmation: input.confirmation,
          reason: draft.reason,
          evidenceReference: `preparation-assistance:${prepared.run.source_id}:v${input.sourceVersion}:run:${input.runId}`,
          offer: draft.offer
        },
        actor
      );
      requireAssistance(commitment, 'ASSISTANCE_UNAVAILABLE', 503);
      const review = (
        await db.query<{ id: string }>(
          `INSERT INTO preparation_assistance_reviews(contribution_id,run_id,version,decision,draft,actor,
           request_id,applied_commitment_version) VALUES($1::uuid,$2::uuid,$3,'accepted',$4::jsonb,$5,$6::uuid,$7) RETURNING id`,
          [
            context.contributionId,
            input.runId,
            prepared.version + 1,
            JSON.stringify(draft),
            actor,
            input.requestId,
            commitment.version
          ]
        )
      ).rows[0]!;
      await assistanceAudit(
        db,
        actor,
        context.contributionId,
        'suggestion_applied',
        {
          requestId: input.requestId,
          runId: input.runId,
          sourceId: prepared.run.source_id,
          sourceVersion: input.sourceVersion,
          reviewVersion: prepared.version + 1,
          commitmentVersion: commitment.version,
          previousReviewVersion: prepared.version
        }
      );
      return review.id;
    });
  }

  private normalizeDraft(
    raw: unknown,
    suggestion: Parameters<typeof normalizePreparationAssistanceDraft>[1],
    requireResolved = false
  ) {
    try {
      return normalizePreparationAssistanceDraft(raw, suggestion, {
        requireResolved
      });
    } catch (error) {
      const code =
        error instanceof Error &&
        error.message === 'ASSISTANCE_REVIEW_UNRESOLVED'
          ? error.message
          : 'ASSISTANCE_REVIEW_INVALID';
      throw new PreparationAssistanceError(code, 400);
    }
  }

  private async reviewable(
    db: PoolClient,
    context: AssistanceContext,
    runId: string,
    expected: number
  ) {
    const run = await loadAssistanceRun(
      db,
      context.contributionId,
      runId,
      true
    );
    requireAssistance(run, 'ASSISTANCE_RUN_NOT_FOUND', 404);
    const source = await loadAssistanceSource(db, context.contributionId);
    const latest = await loadAssistanceRun(db, context.contributionId);
    requireAssistance(
      source?.version === run.source_version &&
        context.version === run.commitment_version &&
        latest?.id === run.id,
      'ASSISTANCE_STALE'
    );
    requireAssistance(run.state === 'succeeded', 'ASSISTANCE_NOT_READY');
    const suggestion = await loadAssistanceSuggestion(db, run);
    requireAssistance(suggestion, 'ASSISTANCE_NOT_READY');
    const current = await loadAssistanceReview(db, run.id);
    requireAssistance(
      (current.review?.version ?? 0) === expected,
      'ASSISTANCE_REVIEW_VERSION_CONFLICT'
    );
    requireAssistance(
      !current.review || current.review.decision === 'saved',
      'ASSISTANCE_REVIEW_TERMINAL'
    );
    return { run, suggestion, version: current.review?.version ?? 0 };
  }

  async tick(): Promise<void> {
    await tickPreparationAssistance(this.pool);
  }
}
