import type { Pool } from 'pg';

import type {
  PilotAction,
  PilotReceipt
} from '../../../../packages/funding-core/src/index.js';
import { pilotageVersion as hash } from '../admin-pilotage-version.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import {
  PublicationAutomationError,
  validId
} from '../publication-automation/policy.js';

import { audit } from './audit.js';
import { parsePilotCommand } from './command-policy.js';
import type { PilotCommandExecutor } from './contracts.js';
import { PilotError, requireValue } from './errors.js';

const receipt = (row: Record<string, unknown>): PilotReceipt => ({
  requestId: row['request_id'] as string,
  status: row['status'] as PilotReceipt['status'],
  action: row['action'] as PilotAction,
  targetId: row['target_id'] as string,
  code: row['code'] as string | null,
  reviewedAt:
    row['reviewed_at'] instanceof Date ? row['reviewed_at'].toISOString() : null
});
export class AdminPilotageReceipts {
  constructor(
    private readonly pool: Pool,
    private readonly execute: PilotCommandExecutor
  ) {}
  async readReceipt(id: string, actor: string): Promise<PilotReceipt | null> {
    requireValue(validId(id), 'INVALID_REQUEST', 400);
    // A process that vanished cannot safely be treated as a failed mutation.
    await this.pool.query(
      `UPDATE admin_command_receipts SET status='uncertain',code='RESULT_UNKNOWN',updated_at=NOW() WHERE request_id=$1 AND actor=$2 AND status='executing' AND created_at<NOW()-INTERVAL '2 minutes'`,
      [id, actor]
    );
    const row = (
      await this.pool.query(
        'SELECT * FROM admin_command_receipts WHERE request_id=$1 AND actor=$2',
        [id, actor]
      )
    ).rows[0];
    return row ? receipt(row) : null;
  }
  async acknowledgeReceipt(
    value: unknown,
    actor: string
  ): Promise<PilotReceipt> {
    requireValue(value && typeof value === 'object', 'INVALID_COMMAND', 400);
    const input = value as {
      requestId: string;
      confirmation: string;
      reason: string;
    };
    requireValue(
      Object.keys(input).every((k) =>
        ['requestId', 'confirmation', 'reason'].includes(k)
      ) &&
        validId(input.requestId) &&
        input.confirmation === input.requestId &&
        typeof input.reason === 'string' &&
        input.reason.trim().length >= 10 &&
        input.reason.length <= 500,
      'INVALID_COMMAND',
      400
    );
    return withPostgresTransaction(this.pool, async (db) => {
      const row = (
        await db.query(
          'SELECT * FROM admin_command_receipts WHERE request_id=$1 AND actor=$2 FOR UPDATE',
          [input.requestId, actor]
        )
      ).rows[0];
      requireValue(row && row.status === 'uncertain', 'RECEIPT_NOT_UNCERTAIN');
      if (!row.reviewed_at) {
        const updated = (
          await db.query(
            'UPDATE admin_command_receipts SET reviewed_at=NOW(),updated_at=NOW() WHERE request_id=$1 RETURNING *',
            [input.requestId]
          )
        ).rows[0];
        await audit(db, actor, 'incident_reviewed', row.target_id, {
          requestId: input.requestId,
          command: row.action,
          reason: input.reason.trim()
        });
        return receipt(updated);
      }
      return receipt(row);
    });
  }
  async command(
    value: unknown,
    actor: string,
    writable = true,
    owner = true
  ): Promise<PilotReceipt> {
    requireValue(writable, 'READ_ONLY', 403);
    const c = parsePilotCommand(value),
      digest = hash(c);
    requireValue(owner || !c.action.startsWith('project.'), 'READ_ONLY', 403);
    if (
      [
        'programme.apply',
        'editorial.preferences',
        'publication.repair'
      ].includes(c.action) ||
      c.payload?.editorialIntent
    ) {
      const schema = (
        await this.pool.query(
          "SELECT to_regclass('public.publication_editorial_profiles') AS profiles,to_regclass('public.publication_editorial_observations') AS observations"
        )
      ).rows[0];
      requireValue(
        schema?.profiles && schema?.observations,
        'PROGRAMME_UNAVAILABLE',
        503
      );
    }
    const claimed = await withPostgresTransaction(this.pool, async (db) => {
      const result = await db.query(
        `INSERT INTO admin_command_receipts(request_id,actor,action,target_id,request_hash,status) VALUES($1,$2,$3,$4,$5,'executing') ON CONFLICT DO NOTHING RETURNING *`,
        [c.requestId, actor, c.action, c.targetId, digest]
      );
      if (result.rowCount) {
        await audit(db, actor, 'requested', c.targetId, {
          requestId: c.requestId,
          command: c.action
        });
        return true;
      }
      const existing = (
        await db.query(
          'SELECT actor,request_hash FROM admin_command_receipts WHERE request_id=$1',
          [c.requestId]
        )
      ).rows[0];
      requireValue(
        existing?.actor === actor && existing.request_hash === digest,
        'REQUEST_CONFLICT'
      );
      return false;
    });
    if (!claimed) return (await this.readReceipt(c.requestId, actor))!;
    let status: PilotReceipt['status'] = 'completed',
      code: string | null = null;
    try {
      code = await this.execute(c, actor);
    } catch (error) {
      const known =
        error instanceof PilotError ||
        error instanceof PublicationAutomationError;
      status = known ? 'failed' : 'uncertain';
      code = known ? error.code : 'RESULT_UNKNOWN';
    }
    await withPostgresTransaction(this.pool, async (db) => {
      await db.query(
        'UPDATE admin_command_receipts SET status=$2,code=$3,updated_at=NOW() WHERE request_id=$1',
        [c.requestId, status, code]
      );
      await audit(db, actor, status, c.targetId, {
        requestId: c.requestId,
        command: c.action,
        code
      });
    });
    return {
      requestId: c.requestId,
      action: c.action,
      targetId: c.targetId,
      status,
      code
    };
  }
}
