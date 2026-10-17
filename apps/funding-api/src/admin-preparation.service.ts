import type {
  AdminPreparationApproval,
  AdminPreparationApproveRequest,
  AdminPreparationReceipt,
  AdminPreparationReceiptData,
  AdminDossierPreparationReceipt
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import { assertPreparationReadiness } from './admin-preparation-readiness.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import {
  preparationDigest,
  projectPreparation,
  type PreparationManifest,
  type PreparationSource
} from './admin-preparation.projection.js';

function check(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new AdminAutomaticRunError(code, status);
}

interface ApprovalRow {
  id: string;
  run_id: string | null;
  contribution_id: string;
  preparation_version: string;
  actor: string;
  request_id: string;
  request_hash: string;
  audit_reference: string;
  approved_at: Date;
}

const approval = (row: ApprovalRow): AdminPreparationApproval => ({
  id: row.id,
  runId: row.run_id,
  contributionId: row.contribution_id,
  version: row.preparation_version,
  actor: row.actor,
  requestId: row.request_id,
  auditReference: row.audit_reference,
  approvedAt: row.approved_at.toISOString()
});

type PreparationCommand = Omit<AdminPreparationApproveRequest, 'runId'> & {
  readonly runId?: string;
};
type PreparationReceipt =
  AdminPreparationReceipt | AdminDossierPreparationReceipt;

/** No dispatch or financial port exists. Approval and audit share one transaction. */
export class AdminPreparationService {
  constructor(private readonly pool: Pool) {}

  private async manifest(
    db: PoolClient,
    actor: string,
    runId: string,
    position?: number,
    contributionId?: string
  ): Promise<PreparationManifest> {
    const row = (
      await db.query<PreparationManifest>(
        `SELECT d.*,r.pass,
        (SELECT count(*) FROM admin_automatic_run_dossiers WHERE run_id=r.id)::text AS total_count,
        (SELECT count(*) FROM admin_automatic_run_dossiers WHERE run_id=r.id AND last_pass=r.pass)::text AS processed_count
       FROM admin_automatic_runs r JOIN admin_automatic_run_dossiers d ON d.run_id=r.id
       WHERE r.id=$1::uuid AND r.actor=$2 AND ($3::bigint IS NULL OR d.position=$3::bigint)
         AND ($4::uuid IS NULL OR d.contribution_id=$4::uuid)`,
        [runId, actor, position ?? null, contributionId ?? null]
      )
    ).rows[0];
    check(row, 'PREPARATION_NOT_FOUND', 404);
    return row;
  }

  private async receipt(
    db: PoolClient,
    source: PreparationSource
  ): Promise<AdminPreparationReceiptData> {
    const projected = await projectPreparation(db, source);
    const history = (
      await db.query<ApprovalRow>(
        'SELECT * FROM admin_preparation_approvals WHERE contribution_id=$1::uuid ORDER BY approved_at DESC,id DESC',
        [source.contribution_id]
      )
    ).rows.map(approval);
    // Returning to an older value does not silently reinstate an approval of a previous version.
    const current =
      history[0]?.version === projected.version ? history[0] : null;
    return {
      ...projected,
      approval: current,
      approvalHistory: history,
      status: current
        ? 'approved'
        : history.length
          ? 'review_required'
          : projected.status,
      canApprove: projected.canApprove && !current
    };
  }

  private async runReceipt(
    db: PoolClient,
    manifest: PreparationManifest
  ): Promise<AdminPreparationReceipt> {
    return {
      ...(await this.receipt(db, {
        ...manifest,
        examined: manifest.last_pass === manifest.pass
      })),
      runId: manifest.run_id,
      position: Number(manifest.position),
      totalCount: Number(manifest.total_count),
      processedCount: Number(manifest.processed_count)
    };
  }

  private async dossierReceipt(
    db: PoolClient,
    contributionId: string
  ): Promise<AdminDossierPreparationReceipt> {
    const source = (
      await db.query<PreparationSource>(
        `SELECT id AS contribution_id,COALESCE(public_reference,id::text) AS reference,
        amount_cents::text AS amount_minor,upper(currency) AS currency FROM fund_contributions WHERE id=$1::uuid`,
        [contributionId]
      )
    ).rows[0];
    check(source, 'PREPARATION_NOT_FOUND', 404);
    return { ...(await this.receipt(db, source)), context: 'dossier' };
  }

  private commandReceipt(
    db: PoolClient,
    input: PreparationCommand,
    actor: string
  ): Promise<PreparationReceipt> {
    return input.runId
      ? this.manifest(
          db,
          actor,
          input.runId,
          undefined,
          input.contributionId
        ).then((manifest) => this.runReceipt(db, manifest))
      : this.dossierReceipt(db, input.contributionId);
  }

  async dossierPreparation(
    contributionId: string
  ): Promise<AdminDossierPreparationReceipt> {
    check(isValidUuid(contributionId), 'RUN_INVALID_REQUEST', 400);
    await assertPreparationReadiness(this.pool);
    return withPostgresTransaction(
      this.pool,
      (db) => this.dossierReceipt(db, contributionId),
      { readOnlySnapshot: true }
    );
  }

  async preparation(
    actor: string,
    runId: string,
    position: number
  ): Promise<AdminPreparationReceipt> {
    check(
      isValidUuid(runId) && Number.isSafeInteger(position) && position > 0,
      'RUN_INVALID_REQUEST',
      400
    );
    await assertPreparationReadiness(this.pool);
    return withPostgresTransaction(
      this.pool,
      async (db) =>
        this.runReceipt(db, await this.manifest(db, actor, runId, position)),
      { readOnlySnapshot: true }
    );
  }

  async approvePreparation(
    raw: unknown,
    actor: string
  ): Promise<AdminPreparationReceipt> {
    const receipt = await this.approve(raw, actor, false);
    check('runId' in receipt, 'RUN_UNAVAILABLE', 503);
    return receipt;
  }

  async approveDossierPreparation(
    raw: unknown,
    actor: string
  ): Promise<AdminDossierPreparationReceipt> {
    const receipt = await this.approve(raw, actor, true);
    check('context' in receipt, 'RUN_UNAVAILABLE', 503);
    return receipt;
  }

  private async approve(
    raw: unknown,
    actor: string,
    dossier: boolean
  ): Promise<PreparationReceipt> {
    check(
      raw && typeof raw === 'object' && !Array.isArray(raw),
      'RUN_INVALID_REQUEST',
      400
    );
    const input = raw as PreparationCommand;
    check(
      Object.keys(raw).every((key) =>
        [
          ...(dossier ? [] : ['runId']),
          'contributionId',
          'expectedVersion',
          'requestId',
          'confirmed'
        ].includes(key)
      ) &&
        (dossier || isValidUuid(input.runId)) &&
        isValidUuid(input.contributionId) &&
        isValidUuid(input.requestId) &&
        typeof input.expectedVersion === 'string' &&
        /^[a-f0-9]{64}$/.test(input.expectedVersion) &&
        input.confirmed === true,
      'RUN_INVALID_REQUEST',
      400
    );
    await assertPreparationReadiness(this.pool, 'approve');
    const hash = preparationDigest({
      actor,
      runId: input.runId ?? null,
      contributionId: input.contributionId,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      confirmed: input.confirmed
    });
    try {
      return await withPostgresTransaction(
        this.pool,
        async (db) => {
          // Same actor-owned run boundary as automatic preparation; navigation never takes these locks.
          if (input.runId) {
            const run = await db.query(
              'SELECT id FROM admin_automatic_runs WHERE id=$1::uuid AND actor=$2 FOR SHARE',
              [input.runId, actor]
            );
            check(run.rows[0], 'PREPARATION_NOT_FOUND', 404);
          }
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            ['preparation-request:' + input.requestId]
          );
          await db.query(
            'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
            [input.contributionId]
          );
          // Lock mutable determinants before projecting. FK inserts against the contribution
          // and updates to existing source content wait until this decision commits.
          for (const table of [
            'sponsorship_commitments',
            'sponsorship_obligations',
            'sponsor_publication_drafts',
            'sponsor_media_assets',
            'contribution_activity',
            'moderation_cases'
          ])
            await db.query(
              `SELECT 1 FROM ${table} WHERE contribution_id=$1::uuid FOR SHARE`,
              [input.contributionId]
            );
          await db.query('SELECT version FROM moderation_policies FOR SHARE');
          const receipt = await this.commandReceipt(db, input, actor);
          const prior = (
            await db.query<ApprovalRow>(
              'SELECT * FROM admin_preparation_approvals WHERE request_id=$1::uuid',
              [input.requestId]
            )
          ).rows[0];
          if (prior) {
            check(
              prior.actor === actor && prior.request_hash === hash,
              'PREPARATION_REQUEST_CONFLICT'
            );
            return receipt;
          }
          check(
            receipt.version === input.expectedVersion,
            'PREPARATION_VERSION_CONFLICT'
          );
          // A duplicate approval of an already approved current version has no second logical effect.
          if (receipt.approval) return receipt;
          check(receipt.canApprove, 'PREPARATION_INCOMPLETE');
          const audit = (
            await db.query<{ id: string }>(
              `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
           VALUES($1,'preparation.approved','contribution',$2,'Private preparation approved; no publication or delivery authorized.',$3::jsonb)
           RETURNING id`,
              [
                actor,
                input.contributionId,
                JSON.stringify({
                  runId: input.runId ?? null,
                  requestId: input.requestId,
                  preparationVersion: receipt.version,
                  result: 'approved',
                  correlationId: input.requestId
                })
              ]
            )
          ).rows[0];
          check(audit, 'RUN_AUDIT_UNAVAILABLE', 503);
          await db.query(
            `INSERT INTO admin_preparation_approvals(run_id,contribution_id,preparation_version,actor,request_id,request_hash,audit_reference,snapshot,approval_generation)
           VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7::uuid,$8::jsonb,2)`,
            [
              input.runId ?? null,
              input.contributionId,
              receipt.version,
              actor,
              input.requestId,
              hash,
              audit.id,
              JSON.stringify({ ...receipt, approvalHistory: [] })
            ]
          );
          return this.commandReceipt(db, input, actor);
        },
        { repeatableRead: true }
      );
    } catch (error) {
      if (error instanceof AdminAutomaticRunError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['40001', '40P01', '23505'].includes(String(error.code))
      ) {
        // A waiter may have captured its repeatable-read snapshot before another
        // approval committed. Reconcile durable state in a fresh read-only
        // transaction; never retry a mutation after an uncertain/conflicting write.
        const recovered = await withPostgresTransaction(
          this.pool,
          async (db) => {
            const current = await this.commandReceipt(db, input, actor);
            const prior = (
              await db.query<ApprovalRow>(
                'SELECT * FROM admin_preparation_approvals WHERE request_id=$1::uuid',
                [input.requestId]
              )
            ).rows[0];
            if (prior)
              check(
                prior.actor === actor && prior.request_hash === hash,
                'PREPARATION_REQUEST_CONFLICT'
              );
            return prior ||
              (current.approval && current.version === input.expectedVersion)
              ? current
              : null;
          },
          { readOnlySnapshot: true }
        );
        if (recovered) return recovered;
        throw new AdminAutomaticRunError('PREPARATION_VERSION_CONFLICT');
      }
      throw error;
    }
  }
}
