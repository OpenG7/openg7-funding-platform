import { createHash } from 'node:crypto';

import type {
  AdminAutomaticRun,
  AdminAutomaticRunAction,
  AdminAutomaticRunAdvanceRequest,
  AdminAutomaticRunControlRequest,
  AdminAutomaticRunEntry,
  AdminAutomaticRunReport,
  AdminAutomaticRunStartRequest,
  AdminAutomaticRunState,
  ResponsibilityBalance
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  loadResponsibilityBalanceOnClient,
  ResponsibilityBalanceError
} from './admin-responsibility-balance.service.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import { createAdminPublicationDraftOnConnection } from './fund-publication-drafts.repository.js';
import { moderationApprovedSql } from './moderation/policy.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { AdminPreparationService } from './admin-preparation.service.js';
import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

export { AdminAutomaticRunError } from './admin-automatic-run-error.js';

function check(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new AdminAutomaticRunError(code, status);
}
const integer = (value: unknown): number => {
  const number = Number(value);
  check(Number.isSafeInteger(number) && number >= 0, 'RUN_TOTAL_UNSAFE', 503);
  return number;
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = (value: Date | string): string => new Date(value).toISOString();
const confirmed = "c.status IN ('paid','refunded','disputed')";

interface RunRow {
  id: string;
  actor: string;
  version: number;
  status: AdminAutomaticRun['status'];
  pass: number;
  cursor: string;
  in_flight_request_id: string | null;
  last_balance: ResponsibilityBalance | null;
  started_at: Date;
  updated_at: Date;
}
interface DossierRow {
  position: string;
  contribution_id: string;
  reference: string;
  contribution_type: ResponsibilityBalance['contributionType'];
  amount_minor: string;
  currency: string;
  payment_status: string;
}
interface EntryRow {
  id: string;
  run_id: string;
  pass: number;
  contribution_id: string;
  reference: string;
  actor: string;
  request_id: string;
  audit_reference: string;
  before_balance: ResponsibilityBalance;
  balance: ResponsibilityBalance;
  actions: AdminAutomaticRunAction[];
  created_at: Date;
}

function entry(row: EntryRow): AdminAutomaticRunEntry {
  return {
    seq: integer(row.id),
    runId: row.run_id,
    pass: row.pass,
    contributionId: row.contribution_id,
    reference: row.reference,
    balanceStatus: row.balance.status,
    reasonCodes: row.balance.reasons,
    actions: row.actions,
    beforeBalance: row.before_balance,
    balance: row.balance,
    createdAt: date(row.created_at),
    actor: row.actor,
    requestId: row.request_id,
    auditReference: row.audit_reference
  };
}

function parse<T>(raw: unknown, fields: readonly string[]): T {
  check(
    raw && typeof raw === 'object' && !Array.isArray(raw),
    'RUN_INVALID_REQUEST',
    400
  );
  const value = raw as Record<string, unknown>;
  check(
    Object.keys(value).every((field) => fields.includes(field)) &&
      isValidUuid(value['requestId']),
    'RUN_INVALID_REQUEST',
    400
  );
  if (fields.includes('runId'))
    check(
      isValidUuid(value['runId']) &&
        Number.isSafeInteger(value['expectedVersion']) &&
        Number(value['expectedVersion']) > 0,
      'RUN_INVALID_REQUEST',
      400
    );
  return value as T;
}

async function audit(
  db: PoolClient,
  actor: string,
  action: string,
  runId: string,
  metadata: Record<string, unknown>
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
     VALUES($1,$2,'automatic_run',$3,'Private administrative responsibility reconciliation.',$4::jsonb)
     RETURNING id::text AS id`,
    [actor, 'automatic_run.' + action, runId, JSON.stringify(metadata)]
  );
  check(result.rows[0], 'RUN_AUDIT_UNAVAILABLE', 503);
  return result.rows[0].id;
}

/** No network, publication, email, financial correction or human decision port exists. */
export class AdminAutomaticRunsService {
  constructor(private readonly pool: Pool) {}

  preparation(actor: string, runId: string, position: number) {
    return new AdminPreparationService(this.pool).preparation(
      actor,
      runId,
      position
    );
  }

  approvePreparation(raw: unknown, actor: string) {
    return new AdminPreparationService(this.pool).approvePreparation(
      raw,
      actor
    );
  }

  private async run(
    db: PoolClient,
    actor: string,
    id: string,
    lock = false
  ): Promise<RunRow> {
    const row = (
      await db.query<RunRow>(
        `SELECT * FROM admin_automatic_runs WHERE id=$1::uuid AND actor=$2${lock ? ' FOR UPDATE' : ''}`,
        [id, actor]
      )
    ).rows[0];
    check(row, 'RUN_NOT_FOUND', 404);
    return row;
  }

  private async prior(
    db: PoolClient,
    actor: string,
    requestId: string,
    hash: string
  ): Promise<AdminAutomaticRunState | null> {
    const row = (
      await db.query<{
        actor: string;
        request_hash: string;
        status: string;
        response: AdminAutomaticRunState | null;
      }>(
        'SELECT actor,request_hash,status,response FROM admin_automatic_run_commands WHERE request_id=$1::uuid',
        [requestId]
      )
    ).rows[0];
    if (!row) return null;
    check(
      row.actor === actor && row.request_hash === hash,
      'RUN_REQUEST_CONFLICT'
    );
    check(
      row.status === 'completed' && row.response,
      row.status === 'executing' ? 'RUN_IN_PROGRESS' : 'RUN_UNCERTAIN'
    );
    return row.response;
  }

  private async saveCommand(
    db: PoolClient,
    input: { requestId: string; runId: string },
    actor: string,
    kind: string,
    hash: string,
    state: AdminAutomaticRunState
  ): Promise<void> {
    await db.query(
      `INSERT INTO admin_automatic_run_commands(request_id,run_id,actor,kind,request_hash,status,response)
       VALUES($1::uuid,$2::uuid,$3,$4,$5,'completed',$6::jsonb)`,
      [input.requestId, input.runId, actor, kind, hash, JSON.stringify(state)]
    );
  }

  private async stateOnClient(
    db: PoolClient,
    row: RunRow
  ): Promise<AdminAutomaticRunState> {
    const counts = (
      await db.query<{
        total: string;
        processed: string;
        balanced: string;
        unknown: string;
      }>(
        `SELECT count(*) AS total,count(*) FILTER(WHERE last_pass=$2) AS processed,
       count(*) FILTER(WHERE last_pass=$2 AND last_balance->>'status'='balanced') AS balanced,
       count(*) FILTER(WHERE last_pass IS DISTINCT FROM $2 OR last_balance IS NULL OR last_balance->>'status'='unknown') AS unknown
       FROM admin_automatic_run_dossiers WHERE run_id=$1::uuid`,
        [row.id, row.pass]
      )
    ).rows[0]!;
    const latest = (
      await db.query<EntryRow>(
        'SELECT * FROM admin_automatic_run_entries WHERE run_id=$1::uuid ORDER BY id DESC LIMIT 1',
        [row.id]
      )
    ).rows[0];
    const next = (
      await db.query<{ contribution_id: string }>(
        'SELECT contribution_id FROM admin_automatic_run_dossiers WHERE run_id=$1::uuid AND position>$2::bigint ORDER BY position LIMIT 1',
        [row.id, row.cursor]
      )
    ).rows[0];
    const newPaymentCount = integer(
      (
        await db.query<{ count: string }>(
          `SELECT count(*) FROM fund_contributions c WHERE ${confirmed}
       AND NOT EXISTS(SELECT 1 FROM admin_automatic_run_dossiers d WHERE d.run_id=$1::uuid AND d.contribution_id=c.id)`,
          [row.id]
        )
      ).rows[0]!.count
    );
    const totals = await db.query<{ currency: string; total: string }>(
      'SELECT currency,sum(amount_minor)::text AS total FROM admin_automatic_run_dossiers WHERE run_id=$1::uuid GROUP BY currency ORDER BY currency',
      [row.id]
    );
    const dossierCount = integer(counts.total),
      processedCount = integer(counts.processed),
      balancedCount = integer(counts.balanced);
    return {
      run: {
        id: row.id,
        version: row.version,
        // A browser returning during a lost command must inspect, never auto-replay it.
        status: row.in_flight_request_id ? 'uncertain' : row.status,
        startedAt: date(row.started_at),
        updatedAt: date(row.updated_at),
        observedAt: latest ? date(latest.created_at) : null,
        pass: row.pass,
        cursor: integer(row.cursor),
        dossierCount,
        processedCount,
        balancedCount,
        outstandingCount: dossierCount - balancedCount,
        unknownCount: integer(counts.unknown),
        uncoveredCount: 0,
        newPaymentCount,
        currencyTotals: totals.rows.map((total) => ({
          currency: total.currency,
          amountMinor: integer(total.total)
        })),
        latestEntry: latest ? entry(latest) : null,
        nextContributionId: next?.contribution_id ?? null,
        globalBalanced:
          row.status === 'completed' &&
          !row.in_flight_request_id &&
          processedCount === dossierCount &&
          balancedCount === dossierCount &&
          newPaymentCount === 0
      },
      balance: row.last_balance
    };
  }

  async state(actor: string, runId?: string): Promise<AdminAutomaticRunState> {
    check(
      runId === undefined || isValidUuid(runId),
      'RUN_INVALID_REQUEST',
      400
    );
    return withPostgresTransaction(
      this.pool,
      async (db) => {
        const row = runId
          ? await this.run(db, actor, runId)
          : (
              await db.query<RunRow>(
                'SELECT * FROM admin_automatic_runs WHERE actor=$1 ORDER BY started_at DESC,id DESC LIMIT 1',
                [actor]
              )
            ).rows[0];
        return row ? this.stateOnClient(db, row) : { run: null, balance: null };
      },
      { readOnlySnapshot: true }
    );
  }

  async report(
    actor: string,
    runId: string,
    after = 0,
    limit = 50
  ): Promise<AdminAutomaticRunReport> {
    check(
      isValidUuid(runId) &&
        Number.isSafeInteger(after) &&
        after >= 0 &&
        Number.isSafeInteger(limit) &&
        limit >= 1 &&
        limit <= 100,
      'RUN_INVALID_REQUEST',
      400
    );
    return withPostgresTransaction(
      this.pool,
      async (db) => {
        await this.run(db, actor, runId);
        const rows = (
          await db.query<EntryRow>(
            'SELECT * FROM admin_automatic_run_entries WHERE run_id=$1::uuid AND id>$2::bigint ORDER BY id LIMIT $3',
            [runId, after, limit + 1]
          )
        ).rows;
        const page = rows.slice(0, limit);
        return {
          entries: page.map(entry),
          nextCursor: rows.length > limit ? integer(page.at(-1)!.id) : null
        };
      },
      { readOnlySnapshot: true }
    );
  }

  async start(raw: unknown, actor: string): Promise<AdminAutomaticRunState> {
    const input = parse<AdminAutomaticRunStartRequest>(raw, ['requestId']);
    const hash = digest({
      actor,
      kind: 'start',
      input: { requestId: input.requestId }
    });
    return withPostgresTransaction(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'automatic-run:' + actor
      ]);
      const prior = await this.prior(db, actor, input.requestId, hash);
      if (prior) return prior;
      check(
        !(
          await db.query(
            "SELECT id FROM admin_automatic_runs WHERE actor=$1 AND status IN ('running','paused','uncertain') LIMIT 1",
            [actor]
          )
        ).rows[0],
        'RUN_ALREADY_ACTIVE'
      );
      check(
        !(
          await db.query(
            `SELECT 1 FROM fund_contributions c WHERE ${confirmed}
           AND (c.amount_cents<=0 OR upper(c.currency)!~'^[A-Z]{3}$') LIMIT 1`
          )
        ).rows[0],
        'RUN_INVALID_PAYMENT_FACTS',
        503
      );
      await db.query(
        "INSERT INTO admin_automatic_runs(id,actor,status) VALUES($1::uuid,$2,'running')",
        [input.requestId, actor]
      );
      await db.query(
        `INSERT INTO admin_automatic_run_dossiers(run_id,position,contribution_id,reference,contribution_type,amount_minor,currency,payment_status)
         SELECT $1::uuid,row_number() OVER(ORDER BY COALESCE(c.paid_at,c.created_at),c.id),c.id,
           COALESCE(c.public_reference,c.id::text),c.contribution_type,c.amount_cents,upper(c.currency),c.status
         FROM fund_contributions c WHERE ${confirmed}`,
        [input.requestId]
      );
      await db.query(
        "UPDATE admin_automatic_runs SET status='completed' WHERE id=$1::uuid AND NOT EXISTS(SELECT 1 FROM admin_automatic_run_dossiers WHERE run_id=$1::uuid)",
        [input.requestId]
      );
      await audit(db, actor, 'started', input.requestId, {
        requestId: input.requestId
      });
      const state = await this.stateOnClient(
        db,
        await this.run(db, actor, input.requestId)
      );
      await this.saveCommand(
        db,
        { ...input, runId: input.requestId },
        actor,
        'start',
        hash,
        state
      );
      return state;
    });
  }

  async control(raw: unknown, actor: string): Promise<AdminAutomaticRunState> {
    const input = parse<AdminAutomaticRunControlRequest>(raw, [
      'requestId',
      'runId',
      'expectedVersion',
      'action'
    ]);
    check(
      ['pause', 'resume', 'recheck', 'reconcile'].includes(input.action),
      'RUN_INVALID_REQUEST',
      400
    );
    const hash = digest({
      actor,
      kind: input.action,
      input: {
        requestId: input.requestId,
        runId: input.runId,
        expectedVersion: input.expectedVersion,
        action: input.action
      }
    });
    return withPostgresTransaction(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'automatic-run:' + actor
      ]);
      const prior = await this.prior(db, actor, input.requestId, hash);
      if (prior) return prior;
      const row = await this.run(db, actor, input.runId, true);
      check(row.version === input.expectedVersion, 'RUN_VERSION_CONFLICT');
      if (input.action === 'reconcile') {
        check(row.in_flight_request_id, 'RUN_NO_UNCERTAIN_COMMAND');
        const command = (
          await db.query<{
            status: string;
            response: AdminAutomaticRunState | null;
          }>(
            'SELECT status,response FROM admin_automatic_run_commands WHERE request_id=$1::uuid AND run_id=$2::uuid AND actor=$3 FOR UPDATE',
            [row.in_flight_request_id, row.id, actor]
          )
        ).rows[0];
        check(command, 'RUN_RECONCILIATION_REQUIRED');
        const recorded = (
          await db.query(
            'SELECT id FROM admin_automatic_run_entries WHERE request_id=$1::uuid',
            [row.in_flight_request_id]
          )
        ).rows[0];
        const prepared = (
          await db.query(
            "SELECT id FROM admin_audit_log WHERE action='publication_draft.create' AND metadata->>'requestId'=$1 AND metadata->>'runId'=$2 LIMIT 1",
            [row.in_flight_request_id, row.id]
          )
        ).rows[0];
        // The same transaction writes private drafts, report, cursor and completion.
        // Holding the run lock fences any original process before another decision.
        check(
          (!recorded && !prepared) || command.status === 'completed',
          'RUN_RECONCILIATION_REQUIRED'
        );
        if (command.status !== 'completed')
          await db.query(
            "UPDATE admin_automatic_run_commands SET status='failed',updated_at=clock_timestamp() WHERE request_id=$1::uuid",
            [row.in_flight_request_id]
          );
        const reconciled = (
          await db.query<RunRow>(
            "UPDATE admin_automatic_runs SET in_flight_request_id=NULL,status='paused',version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING *",
            [row.id]
          )
        ).rows[0]!;
        await audit(
          db,
          actor,
          command.status === 'completed'
            ? 'reconciled_completed'
            : 'reconciled_no_effect',
          row.id,
          {
            requestId: input.requestId,
            originalRequestId: row.in_flight_request_id
          }
        );
        const state = await this.stateOnClient(db, reconciled);
        await this.saveCommand(db, input, actor, input.action, hash, state);
        return state;
      }
      check(row.status !== 'uncertain', 'RUN_UNCERTAIN');
      if (input.action !== 'pause')
        check(!row.in_flight_request_id, 'RUN_IN_PROGRESS');
      if (input.action === 'pause')
        check(['running', 'paused'].includes(row.status), 'RUN_NOT_RUNNING');
      if (input.action === 'resume')
        check(row.status === 'paused', 'RUN_NOT_PAUSED');
      if (input.action === 'recheck') {
        check(
          row.status === 'completed' || row.status === 'paused',
          'RUN_NOT_COMPLETED'
        );
        check(
          !(
            await db.query(
              "SELECT id FROM admin_automatic_runs WHERE actor=$1 AND id<>$2::uuid AND status IN ('running','paused','uncertain') LIMIT 1",
              [actor, input.runId]
            )
          ).rows[0],
          'RUN_ALREADY_ACTIVE'
        );
      }
      const updated = (
        await db.query<RunRow>(
          `UPDATE admin_automatic_runs SET status=$2,version=version+1,updated_at=clock_timestamp(),
          pass=pass+CASE WHEN $3 THEN 1 ELSE 0 END,cursor=CASE WHEN $3 THEN 0 ELSE cursor END
         WHERE id=$1::uuid RETURNING *`,
          [
            row.id,
            input.action === 'pause' ? 'paused' : 'running',
            input.action === 'recheck'
          ]
        )
      ).rows[0]!;
      await audit(db, actor, input.action, row.id, {
        requestId: input.requestId,
        pass: updated.pass
      });
      const state = await this.stateOnClient(db, updated);
      await this.saveCommand(db, input, actor, input.action, hash, state);
      return state;
    });
  }

  private missing(dossier: DossierRow): ResponsibilityBalance {
    return {
      contributionId: dossier.contribution_id,
      reference: dossier.reference,
      contributionType: dossier.contribution_type,
      amountMinor: integer(dossier.amount_minor),
      currency: dossier.currency,
      paymentStatus: dossier.payment_status,
      version: 'missing',
      status: 'unknown',
      expected: 0,
      fulfilled: 0,
      waived: 0,
      outstanding: 0,
      unknown: 1,
      promisedBenefits: [],
      reasons: ['contribution_missing'],
      obligations: [],
      next: null
    };
  }

  private async balance(
    db: PoolClient,
    dossier: DossierRow
  ): Promise<ResponsibilityBalance> {
    try {
      return await loadResponsibilityBalanceOnClient(
        db,
        dossier.contribution_id
      );
    } catch (error) {
      if (
        error instanceof ResponsibilityBalanceError &&
        error.code === 'CONTRIBUTION_NOT_FOUND'
      )
        return this.missing(dossier);
      throw error;
    }
  }

  private async prepare(
    db: PoolClient,
    balance: ResponsibilityBalance,
    requestId: string,
    runId: string,
    actor: string
  ): Promise<AdminAutomaticRunAction[]> {
    const actions: AdminAutomaticRunAction[] = [];
    if (
      balance.status === 'unknown' ||
      balance.contributionType !== 'sponsorship_interest'
    )
      return actions;
    // Private preparation has no power to infer consent, settle a refund or approve content.
    const eligible = await db.query(
      `SELECT c.id FROM fund_contributions c JOIN sponsorship_commitments s ON s.contribution_id=c.id
       WHERE c.id=$1::uuid AND c.status='paid' AND c.public_display_consent IS TRUE
       AND c.sponsor_review_status='approved' AND c.sponsor_feed_status<>'hidden'
       AND c.sponsorship_refund_status='not_requested' AND s.state='active'
       AND ${moderationApprovedSql('sponsorship', 'c.id')}`,
      [balance.contributionId]
    );
    if (!eligible.rows[0]) return actions;
    const seen = new Set<string>();
    for (const obligation of balance.obligations) {
      if (
        obligation.state !== 'pending' ||
        !['facebook', 'linkedin'].includes(obligation.channel) ||
        !['openg7', 'openg20'].includes(obligation.target)
      )
        continue;
      const key = obligation.target + ':' + obligation.channel;
      if (seen.has(key)) continue;
      seen.add(key);
      const next = (
        await db.query<{ id: string; state: string }>(
          `SELECT id,state FROM sponsorship_obligations WHERE contribution_id=$1::uuid AND target=$2 AND channel=$3
         AND state IN ('pending','blocked') ORDER BY ordinal,id LIMIT 1`,
          [balance.contributionId, obligation.target, obligation.channel]
        )
      ).rows[0];
      if (next?.id !== obligation.id || next.state !== 'pending') continue;
      if (
        (
          await db.query(
            `SELECT id FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid AND feed_target=$2 AND channel=$3
         AND status='rejected' AND (obligation_id=$4::uuid OR obligation_id IS NULL) LIMIT 1`,
            [
              balance.contributionId,
              obligation.target,
              obligation.channel,
              obligation.id
            ]
          )
        ).rows[0]
      )
        continue;
      await db.query('SAVEPOINT automatic_private_draft');
      const result = await createAdminPublicationDraftOnConnection(
        db,
        {
          contributionId: balance.contributionId,
          feedTarget: obligation.target as 'openg7' | 'openg20',
          channel: obligation.channel as 'facebook' | 'linkedin'
        },
        actor,
        {
          requestId,
          runId,
          expectedObligationId: obligation.id,
          preserveExistingDeliveries: true
        }
      );
      if (!result.updated || !result.draft)
        await db.query('ROLLBACK TO SAVEPOINT automatic_private_draft');
      await db.query('RELEASE SAVEPOINT automatic_private_draft');
      if (result.updated && result.draft)
        actions.push({
          kind: 'draft_prepared',
          targetId: result.draft.id,
          target: obligation.target as 'openg7' | 'openg20',
          channel: obligation.channel as 'facebook' | 'linkedin',
          created: result.created === true,
          auditReference: result.auditReference ?? null
        });
    }
    return actions;
  }

  async advance(raw: unknown, actor: string): Promise<AdminAutomaticRunState> {
    const input = parse<AdminAutomaticRunAdvanceRequest>(raw, [
      'requestId',
      'runId',
      'expectedVersion'
    ]);
    const hash = digest({
      actor,
      kind: 'advance',
      input: {
        requestId: input.requestId,
        runId: input.runId,
        expectedVersion: input.expectedVersion
      }
    });
    const replay = await withPostgresTransaction(this.pool, async (db) => {
      const row = await this.run(db, actor, input.runId, true);
      const prior = await this.prior(db, actor, input.requestId, hash);
      if (prior) return prior;
      check(row.version === input.expectedVersion, 'RUN_VERSION_CONFLICT');
      check(!row.in_flight_request_id, 'RUN_UNCERTAIN');
      check(
        row.status === 'running',
        row.status === 'uncertain' ? 'RUN_UNCERTAIN' : 'RUN_NOT_RUNNING'
      );
      await db.query(
        `INSERT INTO admin_automatic_run_commands(request_id,run_id,actor,kind,request_hash,status)
         VALUES($1::uuid,$2::uuid,$3,'advance',$4,'executing')`,
        [input.requestId, row.id, actor, hash]
      );
      await db.query(
        'UPDATE admin_automatic_runs SET in_flight_request_id=$2::uuid,version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid',
        [row.id, input.requestId]
      );
      return null;
    });
    if (replay) return replay;
    try {
      return await withPostgresTransaction(
        this.pool,
        async (db) => {
          const row = await this.run(db, actor, input.runId, true);
          check(
            row.in_flight_request_id === input.requestId,
            'RUN_REQUEST_CONFLICT'
          );
          check(['running', 'paused'].includes(row.status), 'RUN_UNCERTAIN');
          if (row.status === 'running') {
            const dossier = (
              await db.query<DossierRow>(
                'SELECT * FROM admin_automatic_run_dossiers WHERE run_id=$1::uuid AND position>$2::bigint ORDER BY position LIMIT 1',
                [row.id, row.cursor]
              )
            ).rows[0];
            if (dossier) {
              const before = await this.balance(db, dossier);
              const actions = await this.prepare(
                db,
                before,
                input.requestId,
                row.id,
                actor
              );
              const after = actions.length
                ? await this.balance(db, dossier)
                : before;
              const auditReference = await audit(
                db,
                actor,
                'dossier_checked',
                row.id,
                {
                  requestId: input.requestId,
                  contributionId: dossier.contribution_id,
                  pass: row.pass,
                  beforeVersion: before.version,
                  afterVersion: after.version,
                  balanceStatus: after.status,
                  preparedDrafts: actions.map((action) => action.targetId)
                }
              );
              await db.query(
                `INSERT INTO admin_automatic_run_entries(run_id,pass,position,contribution_id,reference,actor,request_id,audit_reference,before_balance,balance,actions)
               VALUES($1::uuid,$2,$3::bigint,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9::jsonb,$10::jsonb,$11::jsonb)`,
                [
                  row.id,
                  row.pass,
                  dossier.position,
                  dossier.contribution_id,
                  dossier.reference,
                  actor,
                  input.requestId,
                  auditReference,
                  JSON.stringify(before),
                  JSON.stringify(after),
                  JSON.stringify(actions)
                ]
              );
              await db.query(
                'UPDATE admin_automatic_run_dossiers SET last_pass=$3,last_balance=$4::jsonb WHERE run_id=$1::uuid AND position=$2::bigint',
                [row.id, dossier.position, row.pass, JSON.stringify(after)]
              );
              await db.query(
                'UPDATE admin_automatic_runs SET cursor=$2::bigint,last_balance=$3::jsonb WHERE id=$1::uuid',
                [row.id, dossier.position, JSON.stringify(after)]
              );
            }
          }
          const updated = (
            await db.query<RunRow>(
              `UPDATE admin_automatic_runs r SET in_flight_request_id=NULL,version=version+1,updated_at=clock_timestamp(),
            status=CASE WHEN status='running' AND NOT EXISTS(SELECT 1 FROM admin_automatic_run_dossiers d WHERE d.run_id=r.id AND d.position>r.cursor) THEN 'completed' ELSE status END
           WHERE id=$1::uuid RETURNING *`,
              [row.id]
            )
          ).rows[0]!;
          const state = await this.stateOnClient(db, updated);
          await db.query(
            "UPDATE admin_automatic_run_commands SET status='completed',response=$2::jsonb,updated_at=clock_timestamp() WHERE request_id=$1::uuid",
            [input.requestId, JSON.stringify(state)]
          );
          return state;
        },
        { repeatableRead: true }
      );
    } catch (error) {
      // If COMMIT was acknowledged ambiguously, reconcile its durable receipt first.
      const recovered = await withPostgresTransaction(this.pool, async (db) => {
        const row = await this.run(db, actor, input.runId, true);
        const saved = (
          await db.query<{
            status: string;
            response: AdminAutomaticRunState | null;
          }>(
            'SELECT status,response FROM admin_automatic_run_commands WHERE request_id=$1::uuid AND actor=$2',
            [input.requestId, actor]
          )
        ).rows[0];
        if (saved?.status === 'completed' && saved.response)
          return saved.response;
        if (row.in_flight_request_id === input.requestId) {
          await db.query(
            "UPDATE admin_automatic_run_commands SET status='uncertain',updated_at=clock_timestamp() WHERE request_id=$1::uuid",
            [input.requestId]
          );
          await db.query(
            "UPDATE admin_automatic_runs SET status='uncertain',version=version+1,updated_at=clock_timestamp() WHERE id=$1::uuid",
            [row.id]
          );
          await audit(db, actor, 'uncertain', row.id, {
            requestId: input.requestId
          });
        }
        return null;
      });
      if (recovered) return recovered;
      if (error instanceof AdminAutomaticRunError) throw error;
      throw new AdminAutomaticRunError('RUN_UNCERTAIN');
    }
  }
}
