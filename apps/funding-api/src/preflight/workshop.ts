import { randomUUID } from 'node:crypto';

import type {
  PublicationWorkshopState,
  WorkshopProposal
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { isValidUuid } from '../business-helpers/request-validation.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { lockModerationDependencies } from '../moderation/content.js';

import { PreflightClient, PreflightClientError } from './client.js';
import type { PreflightConfig, EnabledPreflightConfig } from './config.js';
import type { PreflightMission, RemoteMissionDetail } from './contracts.js';
import { PreflightContractError } from './contracts.js';
import { projectWorkshopProposals } from './workshop-proposal.js';
import { adoptWorkshopContent } from './workshop-adoption.js';
import {
  buildWorkshopMission,
  loadWorkshopSource,
  workshopDigest,
  requireWorkshop,
  PublicationWorkshopError,
  type WorkshopSourceSnapshot
} from './workshop-source.js';

export { PublicationWorkshopError } from './workshop-source.js';
export type WorkshopClient = Pick<
  PreflightClient,
  'submit' | 'getMission' | 'notifySourceUpdate'
>;
interface MissionRow {
  id: string;
  event_id: string;
  contribution_id: string;
  source_version: number;
  snapshot_digest: string;
  payload: PreflightMission;
  draft_baseline: WorkshopSourceSnapshot['draftBaseline'];
  delivery: NonNullable<PublicationWorkshopState['mission']>['delivery'];
  mission_status: string;
  attempts: number;
  claim_id: string;
  created_at: Date;
  updated_at: Date;
  error_code: string | null;
}

/** Preparation transport and Funding adoption share no publication or approval port. */
export class PublicationWorkshopService {
  private working = false;
  private readonly client: WorkshopClient | null;
  constructor(
    private readonly pool: Pool,
    readonly config: PreflightConfig,
    options: { client?: WorkshopClient } = {}
  ) {
    this.client = config.enabled
      ? (options.client ?? new PreflightClient(config))
      : null;
  }

  async ready(): Promise<void> {
    if (!this.config.enabled) return;
    let ready = false;
    try {
      ready =
        (
          await this.pool.query<{
            ready: boolean;
          }>(`WITH expected(name,mutable) AS (VALUES
        ('preflight_workshop_events',true),('preflight_workshop_missions',true),('preflight_workshop_proposals',false),
        ('preflight_workshop_requests',false),('preflight_workshop_adoptions',false))
        SELECT bool_and(COALESCE(c.oid IS NOT NULL AND has_table_privilege(current_user,c.oid,'SELECT')
          AND has_table_privilege(current_user,c.oid,'INSERT')
          AND (NOT expected.mutable OR has_table_privilege(current_user,c.oid,'UPDATE')),false)) AS ready
        FROM expected LEFT JOIN pg_namespace n ON n.nspname='public'
        LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name AND c.relkind='r'`)
        ).rows[0]?.ready === true;
    } catch {
      /* Safe failure without connection diagnostics. */
    }
    requireWorkshop(ready, 'PUBLICATION_WORKSHOP_SCHEMA_REQUIRED', 503);
  }

  private disabled(contributionId: string): PublicationWorkshopState {
    return {
      contributionId,
      enabled: false,
      sourceVersion: null,
      sourceSnapshotDigest: null,
      mission: null,
      proposal: null,
      history: [],
      canPrepare: false,
      canAdopt: false
    };
  }

  private async latest(
    db: PoolClient,
    contributionId: string
  ): Promise<MissionRow | undefined> {
    if (!this.config.enabled) return undefined;
    return (
      await db.query<MissionRow>(
        `SELECT * FROM preflight_workshop_missions
      WHERE tenant_id=$1 AND contribution_id=$2::uuid ORDER BY source_version DESC LIMIT 1`,
        [this.config.tenantId, contributionId]
      )
    ).rows[0];
  }

  private async state(
    db: PoolClient,
    contributionId: string
  ): Promise<PublicationWorkshopState> {
    if (!this.config.enabled) return this.disabled(contributionId);
    const source = await loadWorkshopSource(db, contributionId),
      latest = await this.latest(db, contributionId);
    const rows = (
      await db.query<{
        proposal: WorkshopProposal;
        source_version: number;
        snapshot_digest: string;
        adopted_at: Date | null;
      }>(
        `SELECT p.proposal,p.source_version,p.snapshot_digest,a.created_at AS adopted_at FROM preflight_workshop_proposals p
       LEFT JOIN preflight_workshop_adoptions a ON a.proposal_id=p.id
       WHERE p.tenant_id=$1 AND p.contribution_id=$2::uuid ORDER BY p.source_version DESC,p.created_at DESC,p.id LIMIT 30`,
        [this.config.tenantId, contributionId]
      )
    ).rows;
    const history = rows.map((row) => ({
      ...row.proposal,
      obsolete:
        row.proposal.obsolete ||
        !source.active ||
        row.source_version !== latest?.source_version ||
        row.snapshot_digest !== source.digest,
      adoptedAt: row.adopted_at?.toISOString() ?? null
    }));
    const proposal = history.find((p) => !p.obsolete) ?? null;
    return {
      contributionId,
      enabled: true,
      sourceVersion: latest?.source_version ?? null,
      sourceSnapshotDigest: source.digest,
      mission: latest
        ? {
            id: latest.id,
            status: latest.mission_status,
            delivery: latest.delivery,
            createdAt: latest.created_at.toISOString(),
            updatedAt: latest.updated_at.toISOString(),
            errorCode: latest.error_code
          }
        : null,
      proposal,
      history,
      canPrepare: source.active && source.destinations.length > 0,
      canAdopt:
        !!proposal &&
        !proposal.adoptedAt &&
        proposal.editorialPreparation.state === 'ready_for_review' &&
        source.active &&
        source.reviewed &&
        source.publicConsent &&
        !!source.displayName &&
        (!source.destinations.some((d) => d.destination === 'website') ||
          source.websiteHeld)
    };
  }

  async read(contributionId: string): Promise<PublicationWorkshopState> {
    requireWorkshop(
      isValidUuid(contributionId),
      'PUBLICATION_WORKSHOP_INVALID_REQUEST',
      400
    );
    if (!this.config.enabled)
      return this.disabled(contributionId.toLowerCase());
    await this.ready();
    return withPostgresTransaction(
      this.pool,
      (db) => this.state(db, contributionId.toLowerCase()),
      { readOnlySnapshot: true }
    );
  }

  /** Caller owns the source transaction. An identical automatic snapshot reuses its durable mission. */
  async enqueueOnConnection(
    db: PoolClient,
    source: WorkshopSourceSnapshot,
    force = false
  ): Promise<string> {
    requireWorkshop(this.config.enabled, 'PUBLICATION_WORKSHOP_DISABLED');
    const previous = await this.latest(db, source.contributionId);
    if (
      previous?.snapshot_digest === source.digest &&
      (!force ||
        ![
          'review_ready',
          'completed',
          'failed',
          'cancelled',
          'superseded'
        ].includes(previous.mission_status))
    )
      return previous.id;
    const sourceVersion = (previous?.source_version ?? 0) + 1,
      id = randomUUID(),
      eventId = randomUUID();
    const payload = buildWorkshopMission(
      this.config,
      source,
      sourceVersion,
      id,
      randomUUID()
    );
    await db.query(
      `UPDATE preflight_workshop_missions SET delivery='failed',mission_status='superseded',error_code='SOURCE_UPDATED',updated_at=NOW()
      WHERE tenant_id=$1 AND contribution_id=$2::uuid AND mission_status NOT IN ('completed','failed','cancelled','superseded')`,
      [this.config.tenantId, source.contributionId]
    );
    await db.query(
      `INSERT INTO preflight_workshop_missions(id,event_id,contribution_id,tenant_id,source_version,snapshot_digest,payload,draft_baseline,mission_status)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [
        id,
        eventId,
        source.contributionId,
        this.config.tenantId,
        sourceVersion,
        source.digest,
        JSON.stringify(payload),
        JSON.stringify(source.draftBaseline),
        source.active && source.destinations.length
          ? 'queued'
          : 'invalidate_only'
      ]
    );
    return id;
  }

  private async command(
    raw: unknown,
    action: 'prepare' | 'adopt',
    actor: string
  ): Promise<PublicationWorkshopState> {
    requireWorkshop(this.config.enabled, 'PUBLICATION_WORKSHOP_DISABLED');
    const config = this.config;
    requireWorkshop(
      raw && typeof raw === 'object' && !Array.isArray(raw),
      'PUBLICATION_WORKSHOP_INVALID_REQUEST',
      400
    );
    const input = raw as Record<string, unknown>,
      allowed = [
        'contributionId',
        'expectedSourceVersion',
        'requestId',
        ...(action === 'adopt' ? ['proposalId'] : [])
      ];
    requireWorkshop(
      Object.keys(input).length === allowed.length &&
        Object.keys(input).every((k) => allowed.includes(k)) &&
        isValidUuid(input.contributionId) &&
        isValidUuid(input.requestId) &&
        (input.expectedSourceVersion === null
          ? action === 'prepare'
          : Number.isSafeInteger(input.expectedSourceVersion) &&
            Number(input.expectedSourceVersion) > 0) &&
        (action !== 'adopt' || isValidUuid(input.proposalId)) &&
        typeof actor === 'string' &&
        actor.trim().length > 0 &&
        actor.length <= 200,
      'PUBLICATION_WORKSHOP_INVALID_REQUEST',
      400
    );
    const contributionId = (input.contributionId as string).toLowerCase(),
      requestId = (input.requestId as string).toLowerCase();
    const proposalId =
      action === 'adopt' ? (input.proposalId as string).toLowerCase() : null;
    const hash = workshopDigest({
      action,
      actor,
      contributionId,
      requestId,
      expectedSourceVersion: input.expectedSourceVersion,
      proposalId
    });
    await this.ready();
    const execute = async (
      db: PoolClient,
      reconcileOnly = false
    ): Promise<boolean> => {
      if (!reconcileOnly) {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'publication-workshop:' + requestId
        ]);
        if (action === 'adopt')
          await lockModerationDependencies(db, {
            type: 'sponsorship',
            id: contributionId
          });
        await db.query(
          'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
          [contributionId]
        );
      }
      const prior = (
        await db.query<{
          tenant_id: string;
          contribution_id: string;
          actor: string;
          action: string;
          request_hash: string;
        }>(
          'SELECT * FROM preflight_workshop_requests WHERE request_id=$1::uuid',
          [requestId]
        )
      ).rows[0];
      if (prior) {
        requireWorkshop(
          prior.tenant_id === config.tenantId &&
            prior.contribution_id === contributionId &&
            prior.actor === actor &&
            prior.action === action &&
            prior.request_hash === hash,
          'PUBLICATION_WORKSHOP_REQUEST_CONFLICT'
        );
        return true;
      }
      if (reconcileOnly) return false;
      const source = await loadWorkshopSource(db, contributionId),
        latest = await this.latest(db, contributionId);
      requireWorkshop(
        (latest?.source_version ?? null) === input.expectedSourceVersion,
        'PUBLICATION_WORKSHOP_VERSION_CONFLICT'
      );
      requireWorkshop(
        source.active && source.destinations.length > 0,
        'PUBLICATION_WORKSHOP_SOURCE_INACTIVE'
      );
      let resultId: string;
      if (action === 'prepare')
        resultId = await this.enqueueOnConnection(db, source, true);
      else {
        const state = await this.state(db, contributionId);
        requireWorkshop(
          state.proposal?.id === proposalId && state.canAdopt,
          'PUBLICATION_WORKSHOP_PROPOSAL_NOT_CURRENT'
        );
        requireWorkshop(
          latest?.snapshot_digest === source.digest,
          'PUBLICATION_WORKSHOP_VERSION_CONFLICT'
        );
        const drafts = await adoptWorkshopContent(
          db,
          source,
          state.proposal,
          latest.draft_baseline,
          actor,
          config.tenantId
        );
        resultId = proposalId!;
        await db.query(
          `INSERT INTO preflight_workshop_adoptions(proposal_id,request_id,actor,drafts) VALUES($1,$2,$3,$4::jsonb)`,
          [proposalId, requestId, actor, JSON.stringify(drafts)]
        );
      }
      await db.query(
        `INSERT INTO preflight_workshop_requests(request_id,tenant_id,contribution_id,action,actor,request_hash,result_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          requestId,
          config.tenantId,
          contributionId,
          action,
          actor,
          hash,
          resultId
        ]
      );
      await db.query(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
        VALUES($1,$2,'sponsorship',$3,$4::jsonb)`,
        [
          actor,
          'publication_workshop.' + action,
          contributionId,
          JSON.stringify({
            requestId,
            resultId,
            sourceVersion: input.expectedSourceVersion
          })
        ]
      );
      return true;
    };
    try {
      await withPostgresTransaction(this.pool, (db) => execute(db));
    } catch (error) {
      if (error instanceof PublicationWorkshopError) throw error;
      // A lost COMMIT response must be resolved using the immutable request receipt.
      const recovered = await withPostgresTransaction(
        this.pool,
        (db) => execute(db, true),
        { readOnlySnapshot: true }
      ).catch(() => false);
      if (!recovered)
        throw new PublicationWorkshopError(
          'PUBLICATION_WORKSHOP_UNAVAILABLE',
          503
        );
    }
    return this.read(contributionId);
  }
  prepare(raw: unknown, actor: string): Promise<PublicationWorkshopState> {
    return this.command(raw, 'prepare', actor);
  }
  adopt(raw: unknown, actor: string): Promise<PublicationWorkshopState> {
    return this.command(raw, 'adopt', actor);
  }

  /** Reconcile durable dirty sources before contacting Preflight. GET requests never call this path. */
  private async reconcile(): Promise<void> {
    await this.pool
      .query(`INSERT INTO preflight_workshop_events(contribution_id)
      SELECT c.id FROM fund_contributions c JOIN sponsorship_commitments a ON a.contribution_id=c.id
      WHERE c.status='paid' AND a.state='active' AND NOT EXISTS(SELECT 1 FROM preflight_workshop_events e WHERE e.contribution_id=c.id)
      ORDER BY c.id LIMIT 20 ON CONFLICT DO NOTHING`);
    const sources = (
      await this.pool.query<{
        contribution_id: string;
      }>(`SELECT contribution_id FROM preflight_workshop_events
      WHERE revision>processed_revision ORDER BY updated_at,contribution_id LIMIT 20`)
    ).rows;
    for (const row of sources)
      await withPostgresTransaction(this.pool, async (db) => {
        await db.query(
          'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
          [row.contribution_id]
        );
        const event = (
          await db.query<{ revision: string; processed_revision: string }>(
            'SELECT revision,processed_revision FROM preflight_workshop_events WHERE contribution_id=$1::uuid FOR UPDATE',
            [row.contribution_id]
          )
        ).rows[0];
        if (!event || event.revision === event.processed_revision) return;
        try {
          const source = await loadWorkshopSource(db, row.contribution_id);
          if (
            source.destinations.length ||
            (await this.latest(db, row.contribution_id))
          )
            await this.enqueueOnConnection(db, source);
        } catch (error) {
          if (!(
            error instanceof PublicationWorkshopError && error.status === 404
          ))
            throw error;
        }
        await db.query(
          'UPDATE preflight_workshop_events SET processed_revision=$2 WHERE contribution_id=$1::uuid',
          [row.contribution_id, event.revision]
        );
      });
  }

  private async relay(config: EnabledPreflightConfig): Promise<void> {
    await this.pool.query(
      `UPDATE preflight_workshop_missions SET
      delivery=CASE WHEN attempts>=10 THEN 'failed' ELSE 'uncertain' END,
      mission_status=CASE WHEN attempts>=10 THEN 'failed' ELSE mission_status END,
      error_code='PREFLIGHT_LEASE_EXPIRED',lease_until=NULL,updated_at=NOW()
      WHERE tenant_id=$1 AND delivery='sending' AND lease_until<NOW()`,
      [config.tenantId]
    );
    const claimId = randomUUID();
    const row = (
      await this.pool.query<MissionRow>(
        `WITH candidate AS (SELECT id FROM preflight_workshop_missions
      WHERE tenant_id=$1 AND next_attempt_at<=NOW() AND attempts<10
      AND ((delivery IN ('queued','uncertain','acknowledged') AND mission_status NOT IN ('review_ready','completed','failed','cancelled','superseded'))
        OR (delivery='sending' AND lease_until<NOW()))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE preflight_workshop_missions m SET delivery='sending',claim_id=$2::uuid,attempts=attempts+1,
        lease_until=NOW()+INTERVAL '120 seconds',updated_at=NOW() FROM candidate c WHERE m.id=c.id RETURNING m.*`,
        [config.tenantId, claimId]
      )
    ).rows[0];
    if (!row) return;
    try {
      await this.client!.notifySourceUpdate({
        schemaVersion: '1.0',
        type: 'source.updated',
        eventId: row.event_id,
        tenantId: config.tenantId,
        source: row.payload.source
      });
      if (row.mission_status === 'invalidate_only') {
        await this.pool.query(
          `UPDATE preflight_workshop_missions SET delivery='acknowledged',mission_status='superseded',lease_until=NULL,error_code=NULL,updated_at=NOW()
          WHERE id=$1 AND claim_id=$2 AND delivery='sending'`,
          [row.id, claimId]
        );
        return;
      }
      let detail: RemoteMissionDetail;
      try {
        detail = await this.client!.getMission(row.id);
      } catch (error) {
        if (!(error instanceof PreflightClientError && error.status === 404))
          throw error;
        await this.client!.submit(row.payload);
        detail = await this.client!.getMission(row.id);
      }
      const proposals = projectWorkshopProposals(detail, row.payload);
      await withPostgresTransaction(this.pool, async (db) => {
        const current = (
          await db.query(
            `SELECT id FROM preflight_workshop_missions
          WHERE id=$1 AND claim_id=$2 AND delivery='sending' FOR UPDATE`,
            [row.id, claimId]
          )
        ).rows[0];
        if (!current) return;
        for (const proposal of proposals)
          await db.query(
            `INSERT INTO preflight_workshop_proposals(id,mission_id,contribution_id,tenant_id,source_version,snapshot_digest,proposal)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING`,
            [
              proposal.id,
              row.id,
              row.contribution_id,
              config.tenantId,
              row.source_version,
              row.snapshot_digest,
              JSON.stringify(proposal)
            ]
          );
        const failed = ['failed', 'cancelled', 'superseded'].includes(
          detail.mission.status
        );
        await db.query(
          `UPDATE preflight_workshop_missions SET delivery=$3,mission_status=$4,lease_until=NULL,error_code=$5,
          attempts=0,next_attempt_at=NOW()+INTERVAL '2 seconds',updated_at=NOW() WHERE id=$1 AND claim_id=$2`,
          [
            row.id,
            claimId,
            failed ? 'failed' : 'acknowledged',
            detail.mission.status,
            failed ? 'PREFLIGHT_GENERATION_FAILED' : null
          ]
        );
      });
    } catch (error) {
      const retryable =
        error instanceof PreflightClientError
          ? error.retryable
          : !(
              error instanceof PublicationWorkshopError ||
              error instanceof PreflightContractError
            );
      await this.pool.query(
        `UPDATE preflight_workshop_missions SET delivery=$3,
        mission_status=CASE WHEN $3='failed' THEN 'failed' ELSE mission_status END,lease_until=NULL,error_code=$4,
        next_attempt_at=NOW()+($5::int*INTERVAL '1 second'),updated_at=NOW()
        WHERE id=$1 AND claim_id=$2 AND delivery='sending'`,
        [
          row.id,
          claimId,
          retryable && row.attempts < 10 ? 'uncertain' : 'failed',
          error instanceof PublicationWorkshopError
            ? error.code
            : retryable
              ? 'PREFLIGHT_TEMPORARILY_UNAVAILABLE'
              : 'PREFLIGHT_RESPONSE_REJECTED',
          Math.min(300, 2 ** row.attempts)
        ]
      );
    }
  }

  async tick(): Promise<void> {
    if (!this.config.enabled || this.working) return;
    this.working = true;
    try {
      await this.ready();
      await this.reconcile();
      await this.relay(this.config);
    } finally {
      this.working = false;
    }
  }
}
