import type {
  AdminPreflightWorkSession,
  AdminPreflightWorkSessionItem,
  AdminPreflightWorkSessionReport,
  AdminPreflightWorkSessionState,
  AdminPreflightWorkSessionSummary,
  AdminServicePreparationSaveDraftResult,
  AdminDossierPreparationReceipt
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import { AdminPreparationService } from './admin-preparation.service.js';
import { projectServicePreparation } from './admin-service-preparation.js';
import { preparationDigest } from './admin-preparation.projection.js';
import { assertPreparationReadiness } from './admin-preparation-readiness.js';
import { assertServicePreparationReadiness } from './admin-service-preparation-readiness.js';
import { loadAdminCampaignDeskSnapshot } from './admin-campaigns.service.js';
import { preflightDeskStage } from './preflight/desk.js';
import { updateAdminPublicationDraftOnConnection } from './fund-publication-drafts.repository.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import {
  parseServicePreparationSaveDraft,
  parseWorkSessionCommand,
  parseWorkSessionStart,
  requireWorkSession
} from './admin-preflight-work-sessions.commands.js';

interface SessionRow {
  id: string;
  actor: string;
  revision: number;
  status: AdminPreflightWorkSession['status'];
  filters: AdminPreflightWorkSession['filters'];
  last_position: number;
  started_at: Date;
  updated_at: Date;
  finished_at: Date | null;
  item_count?: number;
}
interface ItemRow {
  session_id: string;
  position: number;
  contribution_id: string;
  obligation_id: string;
  observed_version: string;
  observed_content_version: string;
  state: AdminPreflightWorkSessionItem['state'];
  checkpoint: AdminPreflightWorkSessionItem['checkpoint'];
  visited_at: Date | null;
  saved_at: Date | null;
}
interface CommandRow {
  request_id: string;
  session_id: string | null;
  actor: string;
  request_hash: string;
  contribution_id: string;
  obligation_id: string;
  kind: string;
}
const emptyCheckpoint = { pendingDecision: null, reason: '' } as const;
const key = (contributionId: string, obligationId: string) =>
  contributionId + ':' + obligationId;
const summary = (row: SessionRow): AdminPreflightWorkSessionSummary => ({
  id: row.id,
  revision: row.revision,
  status: row.status,
  startedAt: row.started_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  finishedAt: row.finished_at?.toISOString() ?? null,
  lastPosition: row.last_position,
  itemCount: row.item_count ?? 0
});

/** Inspect only; applying migrations or grants is never an HTTP side effect. */
export async function assertPreflightWorkSessionReadiness(
  pool: Pick<Pool, 'query'>
): Promise<void> {
  try {
    const row = (
      await pool.query<{
        ready: boolean;
      }>(`WITH expected(name,mutable) AS (VALUES
      ('admin_preflight_work_sessions',true),('admin_preflight_work_session_items',true),('admin_preflight_work_session_commands',false))
      SELECT bool_and(COALESCE(c.oid IS NOT NULL AND has_schema_privilege(current_user,n.oid,'USAGE')
        AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
        AND (NOT expected.mutable OR has_table_privilege(current_user,c.oid,'UPDATE')),false))
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.admin_preflight_work_session_commands')
        AND tgname='admin_preflight_work_session_commands_immutable' AND tgenabled IN ('O','A')) AS ready
      FROM expected LEFT JOIN pg_namespace n ON n.nspname='public'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name AND c.relkind IN ('r','p')`)
    ).rows[0];
    requireWorkSession(row?.ready, 'WORK_SESSION_SCHEMA_REQUIRED', 503);
  } catch (error) {
    if (error instanceof AdminAutomaticRunError) throw error;
    throw new AdminAutomaticRunError('WORK_SESSION_SCHEMA_REQUIRED', 503);
  }
}

/** Personal context has no delivery, scheduling, approval, financial or network port. */
export class AdminPreflightWorkSessionsService {
  private readonly preparations: AdminPreparationService;
  constructor(private readonly pool: Pool) {
    this.preparations = new AdminPreparationService(pool);
  }
  private actor(actor: string) {
    requireWorkSession(
      typeof actor === 'string' &&
        actor.trim().length > 0 &&
        actor.length <= 200,
      'WORK_SESSION_ACTOR_REQUIRED',
      403
    );
  }
  private async ready() {
    await assertPreflightWorkSessionReadiness(this.pool);
    await assertPreparationReadiness(this.pool);
    await assertServicePreparationReadiness(this.pool);
  }
  private async row(
    db: PoolClient,
    actor: string,
    id: string,
    lock = false
  ): Promise<SessionRow> {
    const row = (
      await db.query<SessionRow>(
        `SELECT s.*,(SELECT count(*)::int FROM admin_preflight_work_session_items i WHERE i.session_id=s.id) AS item_count
      FROM admin_preflight_work_sessions s WHERE s.id=$1::uuid AND s.actor=$2${lock ? ' FOR UPDATE OF s' : ''}`,
        [id, actor]
      )
    ).rows[0];
    requireWorkSession(row, 'WORK_SESSION_NOT_FOUND', 404);
    return row;
  }
  private async prior(
    db: PoolClient,
    actor: string,
    requestId: string,
    hash?: string
  ): Promise<CommandRow | null> {
    const row = (
      await db.query<CommandRow>(
        'SELECT * FROM admin_preflight_work_session_commands WHERE request_id=$1::uuid',
        [requestId]
      )
    ).rows[0];
    if (!row) return null;
    requireWorkSession(
      row.actor === actor && (!hash || row.request_hash === hash),
      'WORK_SESSION_REQUEST_CONFLICT',
      409
    );
    return row;
  }
  private async receipt(
    db: PoolClient,
    contributionId: string,
    obligationId: string
  ) {
    return this.preparations.servicePreparationOnConnection(
      db,
      contributionId,
      obligationId
    );
  }
  private async projection(
    db: PoolClient,
    row: SessionRow
  ): Promise<AdminPreflightWorkSession> {
    const entries = (
      await db.query<ItemRow>(
        'SELECT * FROM admin_preflight_work_session_items WHERE session_id=$1::uuid ORDER BY position',
        [row.id]
      )
    ).rows;
    const snapshot = await loadAdminCampaignDeskSnapshot(
      db,
      undefined,
      new Date(),
      undefined,
      [...new Set(entries.map((entry) => entry.contribution_id))]
    );
    const current = new Map(
      snapshot.rows.map((entry) => [
        key(entry.campaign.contributionId, entry.campaign.id),
        entry
      ])
    );
    const decisions = (
      await db.query<{
        id: string;
        contribution_id: string;
        obligation_id: string;
        decision: 'approved' | 'correction_requested' | 'rejected';
      }>(
        `
      SELECT d.id,d.contribution_id,d.obligation_id,d.decision
      FROM admin_service_preparation_decisions d JOIN admin_preflight_work_session_items i
        ON i.contribution_id=d.contribution_id AND i.obligation_id=d.obligation_id AND i.session_id=$1::uuid
      WHERE d.actor=$2 AND d.created_at>=$3::timestamptz AND ($4::timestamptz IS NULL OR d.created_at<=$4::timestamptz)
      ORDER BY d.contribution_id,d.obligation_id,d.created_at DESC,d.id DESC`,
        [row.id, row.actor, row.started_at, row.finished_at]
      )
    ).rows;
    const recordedDecisionIds = new Set(
      decisions.map((decision) => decision.id)
    );
    // Activities retain all committed events; remaining work follows only a
    // currently applicable exact-content decision from this actor/session interval.
    const decided = new Set(
      entries
        .filter((entry) => {
          const decision = current.get(
            key(entry.contribution_id, entry.obligation_id)
          )?.campaign.preparation.serviceDecision;
          return decision && recordedDecisionIds.has(decision.id);
        })
        .map((entry) => key(entry.contribution_id, entry.obligation_id))
    );
    const report: AdminPreflightWorkSessionReport = {
      total: entries.length,
      visited: entries.filter((i) => i.visited_at !== null).length,
      deferred: entries.filter((i) => i.state === 'deferred').length,
      saved: entries.filter((i) => i.state === 'saved').length,
      remaining: entries.length - decided.size,
      decisions: {
        total: decisions.length,
        approved: decisions.filter((d) => d.decision === 'approved').length,
        correctionRequested: decisions.filter(
          (d) => d.decision === 'correction_requested'
        ).length,
        rejected: decisions.filter((d) => d.decision === 'rejected').length
      },
      readyForDelivery: 0,
      delivered: 0,
      unavailable: 0,
      toResume: entries.filter(
        (i) =>
          i.state !== 'pending' &&
          !decided.has(key(i.contribution_id, i.obligation_id))
      ).length,
      attention: []
    };
    let readyForDelivery = 0,
      delivered = 0,
      unavailable = 0;
    const attention: AdminPreflightWorkSessionReport['attention'][number][] =
      [];
    const items: AdminPreflightWorkSessionItem[] = [];
    const dossiers = new Map<string, AdminDossierPreparationReceipt>();
    for (const entry of entries) {
      const live = current.get(key(entry.contribution_id, entry.obligation_id));
      let version: string | null = null,
        contentVersion: string | null = null;
      if (live) {
        try {
          let dossier = dossiers.get(entry.contribution_id);
          if (!dossier) {
            dossier = await this.preparations.dossierPreparationOnConnection(
              db,
              entry.contribution_id
            );
            dossiers.set(entry.contribution_id, dossier);
          }
          const receipt = await projectServicePreparation(
            db,
            dossier,
            entry.obligation_id,
            {
              items: snapshot.rows
                .filter(
                  (value) =>
                    value.campaign.contributionId === entry.contribution_id
                )
                .map((value) => value.campaign),
              generatedAt: snapshot.generatedAt
            }
          );
          version = receipt.version;
          contentVersion = receipt.contentVersion;
        } catch (error) {
          if (!(
            error instanceof AdminAutomaticRunError && error.status === 404
          ))
            throw error;
        }
      }
      const stage = live && version ? preflightDeskStage(live) : 'unavailable';
      const meta = {
        contributionId: entry.contribution_id,
        obligationId: entry.obligation_id,
        reference: live?.campaign.reference ?? null,
        companyName: live?.campaign.companyName ?? null,
        channel: live?.campaign.channel ?? null,
        adminUrl: live?.campaign.adminUrl ?? null
      };
      if (stage === 'to_deliver') readyForDelivery++;
      if (stage === 'delivered') delivered++;
      if (stage === 'unavailable') {
        unavailable++;
        attention.push({ ...meta, kind: 'unavailable' });
      } else if (contentVersion !== entry.observed_content_version)
        attention.push({ ...meta, kind: 'source_changed' });
      else {
        const workflow = live!.campaign.workflow;
        if (
          live!.campaign.preparation.serviceDecision?.decision ===
            'correction_requested' ||
          live!.campaign.preparation.serviceDecision?.decision === 'rejected'
        )
          attention.push({ ...meta, kind: 'correction' });
        else if (workflow.state === 'uncertain')
          attention.push({ ...meta, kind: 'uncertain' });
        else if (workflow.state === 'error')
          attention.push({ ...meta, kind: 'failed' });
        else if (
          workflow.state === 'waiting' &&
          workflow.deliveryId &&
          workflow.scheduledAt &&
          Number.isFinite(Date.parse(workflow.scheduledAt))
        )
          attention.push({ ...meta, kind: 'scheduled' });
        else if (stage === 'to_deliver')
          attention.push({ ...meta, kind: 'to_schedule' });
        else if (stage !== 'delivered')
          attention.push({ ...meta, kind: 'pending' });
      }
      items.push({
        position: entry.position,
        contributionId: entry.contribution_id,
        obligationId: entry.obligation_id,
        observedVersion: entry.observed_version,
        state: entry.state,
        checkpoint: entry.checkpoint,
        visitedAt: entry.visited_at?.toISOString() ?? null,
        savedAt: entry.saved_at?.toISOString() ?? null,
        reference: meta.reference,
        companyName: meta.companyName,
        channel: meta.channel,
        currentStatus: stage,
        obsolete: version !== entry.observed_version
      });
    }
    return {
      ...summary({ ...row, item_count: entries.length }),
      filters: row.filters,
      items,
      report: { ...report, readyForDelivery, delivered, unavailable, attention }
    };
  }
  async state(
    actor: string,
    sessionId?: string,
    requestId?: string
  ): Promise<AdminPreflightWorkSessionState> {
    this.actor(actor);
    requireWorkSession(
      (sessionId === undefined || isValidUuid(sessionId)) &&
        (requestId === undefined || isValidUuid(requestId))
    );
    sessionId = sessionId?.toLowerCase();
    requestId = requestId?.toLowerCase();
    await this.ready();
    return withPostgresTransaction(
      this.pool,
      async (db) => {
        const rows = (
          await db.query<SessionRow>(
            `SELECT s.*,(SELECT count(*)::int FROM admin_preflight_work_session_items i WHERE i.session_id=s.id) AS item_count
        FROM admin_preflight_work_sessions s WHERE actor=$1 ORDER BY updated_at DESC,id DESC LIMIT 10`,
            [actor]
          )
        ).rows;
        const row = sessionId
          ? await this.row(db, actor, sessionId)
          : (rows.find((item) => item.status !== 'finished') ?? rows[0]);
        let command: AdminPreflightWorkSessionState['command'] = null;
        if (requestId) {
          const found = (
            await db.query<CommandRow>(
              'SELECT * FROM admin_preflight_work_session_commands WHERE request_id=$1::uuid AND actor=$2',
              [requestId, actor]
            )
          ).rows[0];
          command = {
            requestId,
            status:
              found && (!sessionId || found.session_id === sessionId)
                ? 'applied'
                : 'not_found'
          };
        }
        return {
          current: row ? await this.projection(db, row) : null,
          recent: rows.map(summary),
          command
        };
      },
      { readOnlySnapshot: true }
    );
  }
  private async audit(
    db: PoolClient,
    actor: string,
    action: string,
    sessionId: string | null,
    contributionId: string,
    obligationId: string,
    requestId: string
  ) {
    const audit = (
      await db.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
      VALUES($1,$2,'sponsorship_obligation',$3,'Private examination context updated; no delivery authorized.',$4::jsonb) RETURNING id`,
        [
          actor,
          action,
          obligationId,
          JSON.stringify({
            sessionId,
            contributionId,
            obligationId,
            requestId,
            correlationId: requestId
          })
        ]
      )
    ).rows[0];
    requireWorkSession(audit, 'WORK_SESSION_UNAVAILABLE', 503);
    return audit.id;
  }
  private async record(
    db: PoolClient,
    actor: string,
    requestId: string,
    sessionId: string | null,
    kind: string,
    hash: string,
    contributionId: string,
    obligationId: string
  ) {
    const audit = await this.audit(
      db,
      actor,
      kind === 'save_draft'
        ? 'preparation.service_draft_saved'
        : 'preflight.work_session.' + kind,
      sessionId,
      contributionId,
      obligationId,
      requestId
    );
    await db.query(
      `INSERT INTO admin_preflight_work_session_commands(request_id,session_id,actor,kind,request_hash,contribution_id,obligation_id,audit_reference)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid,$8::uuid)`,
      [
        requestId,
        sessionId,
        actor,
        kind,
        hash,
        contributionId,
        obligationId,
        audit
      ]
    );
  }
  private async execute<T>(
    actor: string,
    requestId: string,
    hash: string,
    operation: (db: PoolClient, prior: CommandRow | null) => Promise<T>
  ): Promise<T> {
    try {
      return await withPostgresTransaction(
        this.pool,
        async (db) => {
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            ['preflight-work-request:' + requestId]
          );
          return operation(db, await this.prior(db, actor, requestId, hash));
        },
        { preserveOriginalError: true, repeatableRead: true }
      );
    } catch (error) {
      if (error instanceof AdminAutomaticRunError) throw error;
      // COMMIT can succeed before its acknowledgement is lost. Read its receipt first.
      try {
        const recovered = await withPostgresTransaction(
          this.pool,
          async (db) => {
            const prior = await this.prior(db, actor, requestId, hash);
            return prior ? { value: await operation(db, prior) } : null;
          },
          { readOnlySnapshot: true }
        );
        if (recovered) return recovered.value;
      } catch (recovery) {
        if (
          recovery instanceof AdminAutomaticRunError &&
          recovery.code === 'WORK_SESSION_REQUEST_CONFLICT'
        )
          throw recovery;
      }
      const code = (error as { code?: string })?.code;
      throw new AdminAutomaticRunError(
        ['40001', '40P01', '23505'].includes(code ?? '')
          ? 'WORK_SESSION_VERSION_CONFLICT'
          : 'WORK_SESSION_UNAVAILABLE',
        ['40001', '40P01', '23505'].includes(code ?? '') ? 409 : 503
      );
    }
  }
  private async addScope(
    db: PoolClient,
    row: SessionRow,
    contributionId: string,
    obligationId: string
  ) {
    const selected = await this.receipt(db, contributionId, obligationId);
    const existing = (
      await db.query<ItemRow>(
        'SELECT * FROM admin_preflight_work_session_items WHERE session_id=$1::uuid ORDER BY position',
        [row.id]
      )
    ).rows;
    const requested = existing.find(
      (item) =>
        item.contribution_id === contributionId &&
        item.obligation_id === obligationId
    );
    requireWorkSession(
      requested || existing.length < 100,
      'WORK_SESSION_LIMIT',
      409
    );
    let position = existing.length;
    for (const service of [
      selected.service,
      ...selected.siblings.filter((item) => item.id !== obligationId)
    ]) {
      if (position >= 100) break;
      if (
        existing.some(
          (item) =>
            item.contribution_id === contributionId &&
            item.obligation_id === service.id
        )
      )
        continue;
      const receipt =
        service.id === obligationId
          ? selected
          : await projectServicePreparation(db, selected.dossier, service.id, {
              items: selected.siblings,
              generatedAt: selected.generatedAt
            });
      await db.query(
        `INSERT INTO admin_preflight_work_session_items(session_id,position,contribution_id,obligation_id,observed_version,observed_content_version)
        VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6)`,
        [
          row.id,
          ++position,
          contributionId,
          service.id,
          receipt.version,
          receipt.contentVersion
        ]
      );
    }
    return selected;
  }
  async start(raw: unknown, actor: string): Promise<AdminPreflightWorkSession> {
    this.actor(actor);
    const input = parseWorkSessionStart(raw),
      hash = preparationDigest({ kind: 'start', actor, input });
    await this.ready();
    return this.execute(actor, input.requestId, hash, async (db, prior) => {
      if (prior)
        return this.projection(
          db,
          await this.row(db, actor, prior.session_id!)
        );
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'preflight-work-actor:' + actor
      ]);
      requireWorkSession(
        !(
          await db.query(
            "SELECT id FROM admin_preflight_work_sessions WHERE actor=$1 AND status IN ('active','paused')",
            [actor]
          )
        ).rows[0],
        'WORK_SESSION_ALREADY_ACTIVE',
        409
      );
      await db.query(
        "INSERT INTO admin_preflight_work_sessions(id,actor,status,filters) VALUES($1::uuid,$2,'active',$3::jsonb)",
        [input.requestId, actor, JSON.stringify(input.filters ?? {})]
      );
      const row = await this.row(db, actor, input.requestId);
      await this.addScope(db, row, input.contributionId, input.obligationId);
      await db.query(
        'UPDATE admin_preflight_work_session_items SET visited_at=clock_timestamp() WHERE session_id=$1::uuid AND position=1',
        [row.id]
      );
      await this.record(
        db,
        actor,
        input.requestId,
        row.id,
        'start',
        hash,
        input.contributionId,
        input.obligationId
      );
      return this.projection(db, await this.row(db, actor, row.id));
    });
  }
  async command(
    sessionId: string,
    raw: unknown,
    actor: string
  ): Promise<AdminPreflightWorkSession> {
    this.actor(actor);
    requireWorkSession(isValidUuid(sessionId));
    sessionId = sessionId.toLowerCase();
    const input = parseWorkSessionCommand(raw),
      hash = preparationDigest({ sessionId, actor, input });
    await this.ready();
    return this.execute(actor, input.requestId, hash, async (db, prior) => {
      if (prior)
        return this.projection(db, await this.row(db, actor, sessionId));
      // The actor lock serializes resume with start of another session.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'preflight-work-actor:' + actor
      ]);
      const row = await this.row(db, actor, sessionId, true);
      requireWorkSession(
        row.revision === input.expectedRevision,
        'WORK_SESSION_VERSION_CONFLICT',
        409
      );
      if (input.action === 'resume') {
        requireWorkSession(
          row.status !== 'active',
          'WORK_SESSION_NOT_PAUSED',
          409
        );
        requireWorkSession(
          !(
            await db.query(
              "SELECT id FROM admin_preflight_work_sessions WHERE actor=$1 AND id<>$2::uuid AND status IN ('active','paused')",
              [actor, row.id]
            )
          ).rows[0],
          'WORK_SESSION_ALREADY_ACTIVE',
          409
        );
      } else
        requireWorkSession(
          row.status === 'active',
          'WORK_SESSION_NOT_ACTIVE',
          409
        );
      let item = (
        await db.query<ItemRow>(
          'SELECT * FROM admin_preflight_work_session_items WHERE session_id=$1::uuid AND position=$2',
          [row.id, row.last_position]
        )
      ).rows[0]!;
      if (input.contributionId) {
        if (input.action === 'visit')
          await this.addScope(
            db,
            row,
            input.contributionId,
            input.obligationId!
          );
        const found = (
          await db.query<ItemRow>(
            'SELECT * FROM admin_preflight_work_session_items WHERE session_id=$1::uuid AND contribution_id=$2::uuid AND obligation_id=$3::uuid',
            [row.id, input.contributionId, input.obligationId]
          )
        ).rows[0];
        requireWorkSession(found, 'WORK_SESSION_ITEM_NOT_FOUND', 404);
        item = found;
      }
      let observedVersion = item.observed_version,
        contentVersion = item.observed_content_version;
      if (input.action === 'visit' || input.observedVersion) {
        const receipt = await this.receipt(
          db,
          item.contribution_id,
          item.obligation_id
        );
        requireWorkSession(
          !input.observedVersion || receipt.version === input.observedVersion,
          'PREPARATION_VERSION_CONFLICT',
          409
        );
        observedVersion = receipt.version;
        contentVersion = receipt.contentVersion;
      }
      await db.query(
        `UPDATE admin_preflight_work_session_items SET observed_version=$3,observed_content_version=$4,
        visited_at=COALESCE(visited_at,clock_timestamp()),state=$5,checkpoint=$6::jsonb,saved_at=CASE WHEN $7::boolean THEN clock_timestamp() ELSE saved_at END
        WHERE session_id=$1::uuid AND position=$2`,
        [
          row.id,
          item.position,
          observedVersion,
          contentVersion,
          input.action === 'defer'
            ? 'deferred'
            : input.action === 'checkpoint'
              ? 'saved'
              : item.state,
          JSON.stringify(
            input.checkpoint ?? item.checkpoint ?? emptyCheckpoint
          ),
          input.action === 'checkpoint'
        ]
      );
      const status =
        input.action === 'pause'
          ? 'paused'
          : input.action === 'finish'
            ? 'finished'
            : input.action === 'resume'
              ? 'active'
              : row.status;
      await db.query(
        `UPDATE admin_preflight_work_sessions SET revision=revision+1,status=$3,last_position=$4,filters=$5::jsonb,
        finished_at=CASE WHEN $3='finished' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1::uuid AND actor=$2`,
        [
          row.id,
          actor,
          status,
          item.position,
          JSON.stringify(input.filters ?? row.filters)
        ]
      );
      await this.record(
        db,
        actor,
        input.requestId,
        row.id,
        input.action,
        hash,
        item.contribution_id,
        item.obligation_id
      );
      return this.projection(db, await this.row(db, actor, row.id));
    });
  }
  async saveDraft(
    raw: unknown,
    actor: string
  ): Promise<AdminServicePreparationSaveDraftResult> {
    this.actor(actor);
    const input = parseServicePreparationSaveDraft(raw),
      hash = preparationDigest({ kind: 'save_draft', actor, input });
    await this.ready();
    return this.execute(actor, input.requestId, hash, async (db, prior) => {
      if (prior)
        return {
          receipt: await this.receipt(
            db,
            input.contributionId,
            input.obligationId
          ),
          session: input.workSessionId
            ? await this.projection(
                db,
                await this.row(db, actor, input.workSessionId)
              )
            : null
        };
      let session: SessionRow | null = null;
      if (input.workSessionId) {
        session = await this.row(db, actor, input.workSessionId, true);
        requireWorkSession(
          session.revision === input.expectedSessionRevision,
          'WORK_SESSION_VERSION_CONFLICT',
          409
        );
        requireWorkSession(
          session.status === 'active',
          'WORK_SESSION_NOT_ACTIVE',
          409
        );
        requireWorkSession(
          (
            await db.query(
              'SELECT 1 FROM admin_preflight_work_session_items WHERE session_id=$1::uuid AND contribution_id=$2::uuid AND obligation_id=$3::uuid',
              [session.id, input.contributionId, input.obligationId]
            )
          ).rows[0],
          'WORK_SESSION_ITEM_NOT_FOUND',
          404
        );
      }
      requireWorkSession(
        (
          await db.query(
            'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
            [input.contributionId]
          )
        ).rows[0],
        'PREPARATION_NOT_FOUND',
        404
      );
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
      const before = await this.receipt(
        db,
        input.contributionId,
        input.obligationId
      );
      requireWorkSession(
        before.version === input.expectedVersion,
        'PREPARATION_VERSION_CONFLICT',
        409
      );
      requireWorkSession(
        before.draft?.kind === 'publication' &&
          ['draft', 'pending_review'].includes(before.draft.status) &&
          !['fulfilled', 'adjusted'].includes(before.service.obligationState),
        'PREPARATION_DRAFT_NOT_EDITABLE',
        409
      );
      const saved = await updateAdminPublicationDraftOnConnection(
        db,
        {
          draftId: before.draft.id,
          title: input.title,
          body: input.body,
          disclosureText: input.disclosureText
        },
        actor
      );
      requireWorkSession(saved.updated, 'PREPARATION_DRAFT_NOT_EDITABLE', 409);
      const receipt = await this.receipt(
        db,
        input.contributionId,
        input.obligationId
      );
      if (session) {
        await db.query(
          `UPDATE admin_preflight_work_session_items SET state='saved',observed_version=$4,observed_content_version=$5,saved_at=clock_timestamp(),checkpoint=checkpoint-'decisionRequestId'-'expectedPreparationVersion'
        WHERE session_id=$1::uuid AND contribution_id=$2::uuid AND obligation_id=$3::uuid`,
          [
            session.id,
            input.contributionId,
            input.obligationId,
            receipt.version,
            receipt.contentVersion
          ]
        );
        await db.query(
          'UPDATE admin_preflight_work_sessions SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid AND actor=$2',
          [session.id, actor]
        );
      }
      await this.record(
        db,
        actor,
        input.requestId,
        session?.id ?? null,
        'save_draft',
        hash,
        input.contributionId,
        input.obligationId
      );
      return {
        receipt,
        session: session
          ? await this.projection(db, await this.row(db, actor, session.id))
          : null
      };
    });
  }
}
