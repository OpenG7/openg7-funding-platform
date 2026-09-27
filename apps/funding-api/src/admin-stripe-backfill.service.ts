import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type Stripe from 'stripe';
import type {
  AdminStripeBackfillCounts,
  AdminStripeBackfillRun,
  AdminStripeBackfillScope
} from '@openg7/funding-core';

import { insertAdminAuditLog } from './fund-admin.repository.js';
import {
  runStripeBackfill,
  type StripeBackfillOptions,
  type StripeBackfillSummary
} from './stripe-backfill.service.js';

export class AdminStripeBackfillError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
const fail = (status: number, code: string): never => {
  throw new AdminStripeBackfillError(status, code);
};
const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const day = 86400000;

export function parseStripeBackfillScope(
  raw: unknown,
  now = Date.now()
): AdminStripeBackfillScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return fail(400, 'INVALID_SCOPE');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['from', 'to', 'limit'].includes(key)))
    return fail(400, 'INVALID_SCOPE');
  const date = (input: unknown) => {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input))
      return NaN;
    const parsed = Date.parse(input + 'T00:00:00Z');
    return Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === input
      ? parsed
      : NaN;
  };
  const from = date(value.from),
    to = date(value.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from > to ||
    to - from >= 31 * day ||
    from > now ||
    to > now ||
    typeof value.limit !== 'number' ||
    !Number.isInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 100
  )
    return fail(400, 'INVALID_SCOPE');
  return {
    from: value.from as string,
    to: value.to as string,
    limit: value.limit
  };
}

interface Row {
  id: string;
  actor: string;
  status: AdminStripeBackfillRun['status'];
  mode: 'test' | 'live';
  account_id: string;
  project_id: string;
  credential_hash: string;
  scope: AdminStripeBackfillScope;
  created_range: { gte: number; lte: number };
  counts: AdminStripeBackfillCounts;
  expires_at: Date;
}
const view = (row: Row): AdminStripeBackfillRun => ({
  id: row.id,
  status: row.status,
  mode: row.mode,
  accountId: row.account_id,
  projectId: row.project_id,
  scope: row.scope,
  counts: row.counts,
  expiresAt: row.expires_at.toISOString()
});
const counts = (summary: StripeBackfillSummary): AdminStripeBackfillCounts => ({
  scanned: summary.checkoutSessions.scanned,
  matched: summary.checkoutSessions.matched,
  payments: summary.dryRun
    ? summary.paymentIntents.dryRunWouldInsertTransactions
    : summary.paymentIntents.insertedTransactions,
  refunds: summary.dryRun
    ? summary.refunds.dryRunWouldInsertTransactions
    : summary.refunds.insertedTransactions,
  disputes: summary.dryRun
    ? summary.disputes.dryRunWouldUpdate
    : summary.disputes.statusUpdated,
  missingFees: summary.paymentIntents.missingBalanceTransactions
});

/** Server-owned, bounded scopes; durable receipts survive lost HTTP responses. */
export class AdminStripeBackfillService {
  constructor(
    private readonly pool: Pool,
    private readonly stripe: Stripe,
    private readonly config: {
      apiKey: string;
      projectId: string;
      environment: string;
    }
  ) {}

  private mode(): 'test' | 'live' {
    if (/^(sk|rk)_test_/.test(this.config.apiKey)) return 'test';
    if (
      /^(sk|rk)_live_/.test(this.config.apiKey) &&
      this.config.environment === 'production'
    )
      return 'live';
    return fail(503, 'STRIPE_MODE_UNAVAILABLE');
  }
  private fingerprint(): string {
    return createHash('sha256').update(this.config.apiKey).digest('hex');
  }
  private async audit(
    client: PoolClient,
    row: Row,
    action: string
  ): Promise<void> {
    if (
      !(await insertAdminAuditLog(client, {
        actor: row.actor,
        action: 'stripe_backfill.' + action,
        entityType: 'stripe_backfill',
        entityId: row.id,
        summary: 'Stripe payment recovery: ' + action,
        metadata: {
          mode: row.mode,
          accountId: row.account_id,
          projectId: row.project_id,
          scope: row.scope,
          counts: row.counts,
          status: row.status
        }
      }))
    )
      fail(503, 'BACKFILL_UNAVAILABLE');
  }
  private async withLock<T>(
    fn: (client: PoolClient) => Promise<T>,
    projectId = this.config.projectId
  ): Promise<T> {
    const client = await this.pool.connect();
    const lockKey = 'admin-stripe-backfill:' + projectId;
    let locked = false;
    try {
      locked = (
        await client.query(
          'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
          [lockKey]
        )
      ).rows[0].locked;
      if (!locked) return fail(409, 'BACKFILL_BUSY');
      return await fn(client);
    } finally {
      try {
        if (locked)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [lockKey]
          );
      } catch (error) {
        client.release(true);
        throw error;
      }
      client.release();
    }
  }
  private async save(
    client: PoolClient,
    row: Row,
    action: string
  ): Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query(
        'UPDATE admin_stripe_backfills SET status=$2, counts=$3::jsonb, updated_at=now() WHERE id=$1',
        [row.id, row.status, JSON.stringify(row.counts)]
      );
      await this.audit(client, row, action);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  private options(
    scope: AdminStripeBackfillScope,
    range: Row['created_range'],
    dryRun: boolean
  ): StripeBackfillOptions {
    return {
      projectId: this.config.projectId,
      includeUnmatched: false,
      includePayouts: false,
      includeRefunds: true,
      includeDisputes: true,
      dryRun,
      assumeNonCharityAcknowledged: false,
      created: range,
      maxRecords: scope.limit,
      deadlineAt: Date.now() + 60000
    };
  }
  async preview(raw: unknown, actor: string): Promise<AdminStripeBackfillRun> {
    const scope = parseStripeBackfillScope(raw);
    const mode = this.mode();
    return this.withLock(async (client) => {
      // Check storage before contacting Stripe. Migrations are never run by the API.
      await client.query('SELECT id FROM admin_stripe_backfills LIMIT 0');
      const account = await this.stripe.accounts.retrieve();
      const range = {
        gte: Date.parse(scope.from + 'T00:00:00Z') / 1000,
        lte: Math.min(
          Math.floor(Date.now() / 1000),
          Date.parse(scope.to + 'T00:00:00Z') / 1000 + 86399
        )
      };
      const summary = await runStripeBackfill(
        this.stripe,
        this.pool,
        this.options(scope, range, true)
      );
      const row: Row = {
        id: randomUUID(),
        actor,
        status: 'preview',
        mode,
        account_id: account.id,
        project_id: this.config.projectId,
        credential_hash: this.fingerprint(),
        scope,
        created_range: range,
        counts: counts(summary),
        expires_at: new Date(Date.now() + 10 * 60000)
      };
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO admin_stripe_backfills (id,actor,status,mode,account_id,project_id,credential_hash,scope,created_range,counts,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
          [
            row.id,
            actor,
            row.status,
            mode,
            account.id,
            row.project_id,
            row.credential_hash,
            JSON.stringify(scope),
            JSON.stringify(range),
            JSON.stringify(row.counts),
            row.expires_at
          ]
        );
        await this.audit(client, row, 'preview');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return view(row);
    });
  }
  private async row(id: unknown, actor: string): Promise<Row> {
    if (!validId(id)) return fail(400, 'INVALID_REQUEST');
    const row = (
      await this.pool.query<Row>(
        'SELECT * FROM admin_stripe_backfills WHERE id=$1 AND actor=$2',
        [id, actor]
      )
    ).rows[0];
    if (!row) return fail(404, 'BACKFILL_NOT_FOUND');
    return row;
  }
  async read(
    id: unknown,
    actor: string
  ): Promise<AdminStripeBackfillRun | null> {
    const row = id
      ? await this.row(id, actor)
      : (
          await this.pool.query<Row>(
            'SELECT * FROM admin_stripe_backfills WHERE actor=$1 ORDER BY created_at DESC LIMIT 1',
            [actor]
          )
        ).rows[0];
    if (!row) return null;
    if (row.status === 'running') {
      try {
        await this.withLock(async (client) => {
          const latest = await this.row(row.id, actor);
          if (latest.status === 'running') {
            latest.status = 'interrupted';
            await this.save(client, latest, 'interrupted');
          }
          Object.assign(row, latest);
        }, row.project_id);
      } catch (error) {
        if (!(
          error instanceof AdminStripeBackfillError &&
          error.code === 'BACKFILL_BUSY'
        ))
          throw error;
      }
    }
    return view(row);
  }
  async execute(
    id: unknown,
    confirmation: unknown,
    actor: string
  ): Promise<AdminStripeBackfillRun> {
    const row = await this.row(id, actor);
    if (confirmation !== `${row.mode}:${row.id}`)
      return fail(400, 'CONFIRMATION_REQUIRED');
    if (row.status !== 'preview') return (await this.read(row.id, actor))!;
    return this.withLock(async (client) => {
      const current = await this.row(row.id, actor);
      if (current.status !== 'preview') return view(current);
      if (current.expires_at.getTime() <= Date.now())
        return fail(409, 'PREVIEW_EXPIRED');
      if (
        current.credential_hash !== this.fingerprint() ||
        current.mode !== this.mode() ||
        current.project_id !== this.config.projectId
      )
        return fail(409, 'PREVIEW_CHANGED');
      const account = await this.stripe.accounts.retrieve();
      if (account.id !== current.account_id)
        return fail(409, 'PREVIEW_CHANGED');
      current.status = 'running';
      await this.save(client, current, 'started');
      try {
        const summary = await runStripeBackfill(
          this.stripe,
          this.pool,
          this.options(current.scope, current.created_range, false)
        );
        current.counts = counts(summary);
        current.status = 'completed';
        await this.save(client, current, 'completed');
      } catch {
        // Earlier financial writes may already have committed. Never claim rollback or replay automatically.
        current.status = 'failed';
        await this.save(client, current, 'failed');
      }
      return view(current);
    });
  }
}
