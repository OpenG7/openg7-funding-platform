import type { Pool, PoolClient } from 'pg';

import {
  EDITORIAL_INTENTS,
  type PublicationFeedId
} from '../../../packages/funding-core/src/index.js';
import type {
  PilotAction,
  PilotCommand,
  PilotReceipt,
  PilotState
} from '../../../packages/funding-core/src/index.js';

import { EditorialProgrammeService } from './editorial-programme.service.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { loadAdminPilotageState } from './admin-pilotage.read-model.js';
import { pilotageVersion as hash } from './admin-pilotage-version.js';
import {
  listAdminExpenses,
  updateAdminExpense
} from './fund-admin.repository.js';
import { updateSponsorshipReview } from './fund-contributions.repository.js';
import { PublicationAutomationService } from './publication-automation/service.js';
import {
  PublicationAutomationError,
  validId
} from './publication-automation/policy.js';

const actions: PilotAction[] = [
  'programme.apply',
  'editorial.preferences',
  'publication.repair',
  'publication.approve',
  'publication.reject',
  'publication.edit',
  'feed.pause',
  'feed.resume',
  'sponsor.approve',
  'sponsor.reject',
  'email.retry',
  'project.publish',
  'project.hide'
];
export class PilotError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
function requireValue(
  value: unknown,
  code: string,
  status = 409
): asserts value {
  if (!value) throw new PilotError(code, status);
}
export function parsePilotCommand(value: unknown): PilotCommand {
  requireValue(value && typeof value === 'object', 'INVALID_COMMAND', 400);
  const c = value as PilotCommand;
  requireValue(
    Object.keys(c).every((k) =>
      [
        'requestId',
        'action',
        'targetId',
        'version',
        'confirmation',
        'payload'
      ].includes(k)
    ),
    'INVALID_COMMAND',
    400
  );
  requireValue(
    validId(c.requestId) &&
      actions.includes(c.action) &&
      typeof c.targetId === 'string' &&
      c.targetId.length <= 100 &&
      typeof c.version === 'string' &&
      c.version.length > 0 &&
      c.version.length <= 100 &&
      c.confirmation === c.targetId,
    'INVALID_COMMAND',
    400
  );
  if (
    c.action.startsWith('feed.') ||
    c.action === 'programme.apply' ||
    c.action === 'editorial.preferences'
  )
    requireValue(
      /^openg(?:7|20):(facebook|linkedin)$/.test(c.targetId),
      'INVALID_COMMAND',
      400
    );
  else if (c.action.startsWith('project.'))
    requireValue(/^[1-9]\d{0,15}$/.test(c.targetId), 'INVALID_COMMAND', 400);
  else requireValue(validId(c.targetId), 'INVALID_COMMAND', 400);
  if (c.payload !== undefined)
    requireValue(
      c.payload &&
        typeof c.payload === 'object' &&
        !Array.isArray(c.payload) &&
        Object.keys(c.payload).every((k) =>
          [
            'message',
            'scheduledAt',
            'mediaId',
            'approveSponsors',
            'reason',
            'editorialIntent',
            'preferences',
            'moves'
          ].includes(k)
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.editorialIntent !== undefined)
    requireValue(
      c.action === 'publication.edit' &&
        EDITORIAL_INTENTS.includes(c.payload.editorialIntent),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.moves !== undefined)
    requireValue(c.action === 'programme.apply', 'INVALID_COMMAND', 400);
  if (c.payload?.preferences !== undefined)
    requireValue(c.action === 'editorial.preferences', 'INVALID_COMMAND', 400);
  if (c.action === 'editorial.preferences')
    requireValue(
      /^[1-9]\d{0,8}$/.test(c.version) &&
        Array.isArray(c.payload?.preferences) &&
        c.payload.preferences.length <= 4 &&
        c.payload.preferences.every((p) => EDITORIAL_INTENTS.includes(p)),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'programme.apply')
    requireValue(
      Array.isArray(c.payload?.moves) &&
        c.payload.moves.length > 0 &&
        c.payload.moves.length <= 100 &&
        c.payload.moves.every(
          (m) =>
            m &&
            Object.keys(m).every((k) =>
              ['id', 'version', 'scheduledAt'].includes(k)
            ) &&
            validId(m.id) &&
            Number.isSafeInteger(m.version) &&
            m.version > 0 &&
            typeof m.scheduledAt === 'string' &&
            m.scheduledAt.length <= 40
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.approveSponsors !== undefined)
    requireValue(
      Array.isArray(c.payload.approveSponsors) &&
        c.payload.approveSponsors.length <= 100 &&
        c.payload.approveSponsors.every(
          (s) =>
            s &&
            validId(s.id) &&
            typeof s.version === 'string' &&
            s.version.length > 0 &&
            s.version.length <= 100
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'publication.edit')
    requireValue(
      typeof c.payload?.message === 'string' &&
        c.payload.message.trim().length > 0 &&
        c.payload.message.length <= 2900 &&
        typeof c.payload.scheduledAt === 'string' &&
        (c.payload.mediaId === null || validId(c.payload.mediaId)),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'sponsor.reject')
    requireValue(
      typeof c.payload?.reason === 'string' &&
        c.payload.reason.trim().length >= 3 &&
        c.payload.reason.length <= 500,
      'REASON_REQUIRED',
      400
    );
  // Canonicalize object key order without storing the private payload in a receipt.
  return {
    requestId: c.requestId,
    action: c.action,
    targetId: c.targetId,
    version: c.version,
    confirmation: c.confirmation,
    ...(c.payload
      ? {
          payload: {
            message: c.payload.message,
            scheduledAt: c.payload.scheduledAt,
            mediaId: c.payload.mediaId,
            approveSponsors: c.payload.approveSponsors?.map((s) => ({
              id: s.id,
              version: s.version
            })),
            reason: c.payload.reason,
            editorialIntent: c.payload.editorialIntent,
            preferences: c.payload.preferences,
            moves: c.payload.moves?.map((m) => ({
              id: m.id,
              version: m.version,
              scheduledAt: m.scheduledAt
            }))
          }
        }
      : {})
  };
}
const receipt = (row: Record<string, unknown>): PilotReceipt => ({
  requestId: row['request_id'] as string,
  status: row['status'] as PilotReceipt['status'],
  action: row['action'] as PilotAction,
  targetId: row['target_id'] as string,
  code: row['code'] as string | null,
  reviewedAt:
    row['reviewed_at'] instanceof Date ? row['reviewed_at'].toISOString() : null
});
async function audit(
  db: Pool | PoolClient,
  actor: string,
  action: string,
  target: string,
  metadata: object = {}
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata) VALUES($1,$2,'pilotage',$3,$4::jsonb)`,
    [actor, 'pilotage.' + action, target, JSON.stringify(metadata)]
  );
}

export class AdminPilotageService {
  readonly editorial: EditorialProgrammeService;
  constructor(
    private readonly pool: Pool,
    private readonly publications: PublicationAutomationService
  ) {
    this.editorial = new EditorialProgrammeService(pool, publications);
  }
  async state(
    query: { page?: number; domain?: string; id?: string } = {},
    writable = true,
    owner = true
  ): Promise<PilotState> {
    return loadAdminPilotageState(
      this.pool,
      this.publications,
      query,
      writable,
      owner
    );
  }
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
  private async execute(c: PilotCommand, actor: string): Promise<string> {
    if (c.action === 'programme.apply') {
      await this.editorial.apply(
        c.targetId as PublicationFeedId,
        c.version,
        c.payload!.moves!,
        actor
      );
      return 'REVIEW_REQUIRED';
    }
    if (c.action === 'editorial.preferences') {
      await this.editorial.preferences(
        c.targetId as PublicationFeedId,
        c.version,
        c.payload!.preferences!,
        actor
      );
      return 'SAVED';
    }
    if (c.action === 'publication.repair') {
      await this.publications.repair(c.targetId, c.version, actor);
      return 'REVIEW_REQUIRED';
    }
    if (c.action === 'publication.edit' && c.payload?.editorialIntent) {
      await this.editorial.editWithIntent(c, actor);
      return 'REVIEW_REQUIRED';
    }
    if (c.action.startsWith('publication.')) {
      const version = Number(c.version);
      requireValue(
        Number.isSafeInteger(version) && version > 0,
        'INVALID_COMMAND',
        400
      );
      if (c.action === 'publication.edit')
        await this.publications.command(
          {
            action: 'edit',
            id: c.targetId,
            version,
            message: c.payload!.message!,
            scheduledAt: c.payload!.scheduledAt!,
            mediaId: c.payload!.mediaId!
          },
          actor
        );
      else if (c.action === 'publication.approve')
        await this.publications.command(
          {
            action: 'approve',
            id: c.targetId,
            version,
            confirmation: c.targetId,
            approveSponsors: c.payload?.approveSponsors
          },
          actor
        );
      else
        await this.publications.command(
          {
            action: 'reject',
            id: c.targetId,
            version,
            confirmation: c.targetId
          },
          actor
        );
      return c.action === 'publication.approve'
        ? 'SCHEDULED'
        : c.action === 'publication.reject'
          ? 'REJECTED'
          : 'SAVED';
    }
    if (c.action.startsWith('feed.')) {
      const current = (await this.publications.state()).feeds.find(
        (f) => f.id === c.targetId
      );
      requireValue(current && hash(current) === c.version, 'VERSION_CONFLICT');
      await withPostgresTransaction(this.pool, async (db) => {
        const feed = (
          await db.query(
            'SELECT * FROM publication_feeds WHERE id=$1 FOR UPDATE',
            [c.targetId]
          )
        ).rows[0];
        requireValue(
          feed &&
            feed.paused === current.paused &&
            feed.auto_prepare === current.autoPrepare &&
            feed.timezone === current.timezone &&
            JSON.stringify(feed.weekdays) ===
              JSON.stringify(current.weekdays) &&
            String(feed.local_time).slice(0, 5) === current.localTime &&
            feed.capacity === current.capacity &&
            feed.horizon_days === current.horizonDays &&
            feed.connection === current.connection &&
            (feed.checked_at?.toISOString() ?? null) === current.checkedAt,
          'VERSION_CONFLICT'
        );
        await db.query(
          'UPDATE publication_feeds SET paused=$2,updated_at=NOW() WHERE id=$1',
          [c.targetId, c.action === 'feed.pause']
        );
        await audit(db, actor, c.action, c.targetId);
      });
      return 'SAVED';
    }
    if (c.action.startsWith('sponsor.')) {
      await withPostgresTransaction(this.pool, async (db) => {
        const row = (
          await db.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1 FOR UPDATE',
            [c.targetId]
          )
        ).rows[0];
        requireValue(
          row?.sponsor_review_status === 'pending_review',
          'REVIEW_UNAVAILABLE'
        );
        const r = await updateSponsorshipReview(db as unknown as Pool, {
          contributionId: c.targetId,
          expectedVersion: c.version,
          reviewStatus:
            c.action === 'sponsor.approve' ? 'approved' : 'rejected',
          reviewNote: c.payload?.reason ?? null
        });
        requireValue(
          r.updated,
          r.status === 'media_required'
            ? 'SPONSOR_MEDIA_REQUIRED'
            : r.status === 'payment_not_eligible'
              ? 'PAYMENT_REQUIRED'
              : 'VERSION_CONFLICT'
        );
        if (c.action === 'sponsor.approve')
          await db.query(
            'UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE WHERE id=$1',
            [c.targetId]
          );
        await audit(db, actor, c.action, c.targetId);
      });
      return c.action === 'sponsor.approve' ? 'APPROVED' : 'REJECTED';
    }
    if (c.action === 'email.retry') {
      await withPostgresTransaction(this.pool, async (db) => {
        const r = await db.query(
          `UPDATE email_messages SET status='queued',attempts=LEAST(attempts,GREATEST(max_attempts-1,0)),next_attempt_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='failed' AND updated_at::text=$2 RETURNING id`,
          [c.targetId, c.version]
        );
        requireValue(r.rowCount, 'VERSION_CONFLICT');
        await audit(db, actor, 'email.retry_queued', c.targetId);
      });
      return 'EMAIL_QUEUED';
    }
    const p = (await listAdminExpenses(this.pool)).expenses.find(
      (p) => p.id === c.targetId
    );
    requireValue(p && p.updated_at === c.version, 'VERSION_CONFLICT');
    requireValue(
      c.action !== 'project.publish' || p.public_description.trim(),
      'CONTENT_REQUIRED'
    );
    const r = await updateAdminExpense(
      this.pool,
      {
        expenseId: c.targetId,
        expectedVersion: c.version,
        confirmation: c.confirmation,
        status: c.action === 'project.publish' ? 'published' : 'private'
      },
      {
        actor,
        action:
          c.action === 'project.publish'
            ? 'achievement.published'
            : 'achievement.hidden'
      }
    );
    requireValue(r.updated, 'VERSION_CONFLICT');
    return 'SAVED';
  }
}
