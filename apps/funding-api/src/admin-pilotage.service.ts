import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  EDITORIAL_INTENTS,
  type PublicationFeedId
} from '../../../packages/funding-core/src/index.js';
import type {
  PilotAction,
  PilotCommand,
  PilotDecision,
  PilotDomain,
  PilotReceipt,
  PilotState
} from '../../../packages/funding-core/src/index.js';

import { EditorialProgrammeService } from './editorial-programme.service.js';
import {
  loadAdminWorkQueue,
  WORK_QUEUE_PRIORITIES
} from './admin-work-queue.service.js';
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

const domains: PilotDomain[] = [
  'publications',
  'sponsors',
  'email',
  'invoices',
  'contributions',
  'projects',
  'operations'
];
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
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
async function transaction<T>(
  pool: Pool,
  fn: (db: PoolClient) => Promise<T>
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
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
    const missing: string[] = [];
    const decisions: PilotDecision[] = [];
    const [publicationResult, attentionResult, projectResult, receiptPresence] =
      await Promise.allSettled([
        this.publications.state(),
        loadAdminWorkQueue(this.pool),
        listAdminExpenses(this.pool),
        this.pool.query(
          "SELECT to_regclass('public.admin_command_receipts') IS NOT NULL AS present"
        )
      ]);
    if (
      receiptPresence.status !== 'fulfilled' ||
      !receiptPresence.value.rows[0]?.present
    ) {
      missing.push('commands');
      writable = false;
    }
    const publicationState =
      publicationResult.status === 'fulfilled' ? publicationResult.value : null;
    const representedSponsors = new Set<string>();
    const representedBatches = new Set<string>();
    if (!publicationState) missing.push('publications');
    else {
      for (const p of publicationState.deliveries) {
        if (
          ['draft', 'approved', 'publishing', 'blocked', 'uncertain'].includes(
            p.status
          )
        ) {
          if (p.batchId) representedBatches.add(p.batchId);
          for (const s of p.sponsors) representedSponsors.add(s.id);
        }
        if (!['draft', 'blocked', 'uncertain'].includes(p.status)) continue;
        const feed = publicationState.feeds.find((f) => f.id === p.feedId);
        const blocked =
          p.status !== 'draft'
            ? 'REVIEW_REQUIRED'
            : !feed?.configured || feed.connection !== 'ready'
              ? 'CONNECTION_REQUIRED'
              : Date.parse(p.scheduledAt) <= Date.now()
                ? 'SCHEDULE_EXPIRED'
                : p.sponsors.some(
                      (s) =>
                        s.reviewStatus === 'pending_review' &&
                        !s.presentationApproved
                    )
                  ? 'SPONSOR_MEDIA_REQUIRED'
                  : null;
        decisions.push({
          id: 'publication:' + p.id,
          domain: 'publications',
          kind: 'publication_' + p.status,
          targetId: p.id,
          version: String(p.version),
          title: p.message.split('\n')[0]!.slice(0, 140),
          severity:
            p.status === 'uncertain'
              ? 'urgent'
              : p.status === 'blocked'
                ? 'today'
                : 'this_week',
          dueAt: p.scheduledAt,
          detailsUrl:
            '/admin/fundraiser/publications/automation?deliveryId=' + p.id,
          facts: [
            { label: 'destination', value: p.feedId },
            { label: 'account', value: p.accountId || '—' },
            { label: 'mode', value: p.mode }
          ],
          actions:
            p.status === 'uncertain'
              ? []
              : [
                  { id: 'publication.approve', blocked },
                  { id: 'publication.reject', blocked: null },
                  { id: 'publication.edit', blocked: null }
                ],
          publication: p
        });
      }
      if (
        publicationState.summary.awaitingApproval +
          publicationState.summary.exceptions >
        publicationState.deliveries.filter((p) =>
          ['draft', 'blocked', 'uncertain'].includes(p.status)
        ).length
      )
        missing.push('publication_limit');
    }
    if (attentionResult.status === 'fulfilled') {
      missing.push(
        ...attentionResult.value.missingSources.map((s) => 'attention:' + s)
      );
      const items = attentionResult.value.items;
      const sponsorIds = [
        ...new Set(
          items.flatMap((i) => (i.sponsorshipId ? [i.sponsorshipId] : []))
        )
      ];
      const emailIds = items.flatMap((i) =>
        i.emailQueueId ? [i.emailQueueId] : []
      );
      const [sponsorResult, emailResult] = await Promise.allSettled([
        this.pool.query(
          `SELECT c.id,c.sponsor_company_name,c.sponsor_review_status,c.status,c.updated_at::text AS version,(SELECT m.id FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.deleted_at IS NULL ORDER BY (m.review_status='approved') DESC,m.created_at LIMIT 1) AS media_id,EXISTS(SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.review_status='approved' AND m.deleted_at IS NULL) AS photo FROM fund_contributions c WHERE c.id=ANY($1::uuid[])`,
          [sponsorIds]
        ),
        this.pool.query(
          `SELECT id,subject,status,updated_at::text AS version FROM email_messages WHERE id=ANY($1::uuid[])`,
          [emailIds]
        )
      ]);
      if (sponsorResult.status === 'rejected') missing.push('sponsors');
      if (emailResult.status === 'rejected') missing.push('email');
      const sponsors =
        sponsorResult.status === 'fulfilled'
          ? sponsorResult.value
          : { rows: [] };
      const emails =
        emailResult.status === 'fulfilled' ? emailResult.value : { rows: [] };
      for (const item of items) {
        const isPublication = item.type.startsWith('publication_');
        if (
          isPublication &&
          (representedSponsors.has(item.sponsorshipId ?? '') ||
            representedBatches.has(String(item.facts['reference'] ?? '')) ||
            (publicationState &&
              [
                'publication_needs_preparation',
                'publication_slot_upcoming'
              ].includes(item.type)))
        )
          continue;
        if (
          item.type === 'sponsorship_needs_review' &&
          representedSponsors.has(item.sponsorshipId ?? '')
        )
          continue;
        const domain: PilotDomain = item.type.startsWith('sponsorship_')
          ? 'sponsors'
          : isPublication
            ? 'publications'
            : item.type.startsWith('email_')
              ? 'email'
              : item.type.startsWith('invoice_')
                ? 'invoices'
                : 'contributions';
        const sponsor = sponsors.rows.find((s) => s.id === item.sponsorshipId);
        const email = emails.rows.find((e) => e.id === item.emailQueueId);
        const card: PilotDecision = {
          id: item.id,
          domain,
          kind: item.type,
          targetId:
            item.emailQueueId ??
            item.sponsorshipId ??
            String(item.facts['reference'] ?? item.id),
          version: email?.version ?? sponsor?.version ?? hash(item.facts),
          title: email?.subject ?? sponsor?.sponsor_company_name ?? '',
          severity: item.severity,
          dueAt: item.dueAt ?? null,
          detailsUrl: item.adminUrl ?? '/admin/fundraiser/attention',
          facts: Object.entries(item.facts)
            .filter(
              ([k]) =>
                !['reference', 'amount', 'amountPaid', 'email'].includes(k)
            )
            .slice(0, 6)
            .map(([label, value]) => ({ label, value: String(value ?? '—') })),
          actions: []
        };
        if (sponsor)
          card.sponsor = {
            id: sponsor.id,
            name: sponsor.sponsor_company_name ?? '',
            status: sponsor.sponsor_review_status,
            presentationId: sponsor.media_id,
            presentationApproved: sponsor.photo
          };
        if (item.type === 'sponsorship_needs_review' && sponsor)
          card.actions = [
            {
              id: 'sponsor.approve',
              blocked: !sponsor.photo
                ? 'SPONSOR_MEDIA_REQUIRED'
                : sponsor.status !== 'paid'
                  ? 'PAYMENT_REQUIRED'
                  : null
            },
            { id: 'sponsor.reject', blocked: null }
          ];
        if (email && email.status === 'failed')
          card.actions = [{ id: 'email.retry', blocked: null }];
        if (item.type.startsWith('stripe_event_'))
          card.inspection = {
            kind: 'stripe',
            id: String(item.facts['reference'])
          };
        if (item.type === 'invoice_missing')
          card.inspection = {
            kind: 'invoice',
            id: String(item.facts['contributionId']),
            contributionId: String(item.facts['contributionId'])
          };
        decisions.push(card);
      }
    } else missing.push('attention');
    if (projectResult.status === 'fulfilled')
      for (const p of projectResult.value.expenses.filter((p) =>
        ['draft', 'private'].includes(p.status)
      ))
        decisions.push({
          id: 'project:' + p.id,
          domain: 'projects',
          kind: 'project_review',
          targetId: p.id,
          version: p.updated_at,
          title: p.project_name,
          severity: 'this_week',
          dueAt: null,
          detailsUrl: '/admin/fundraiser/expenses?expenseId=' + p.id,
          facts: [
            { label: 'progress', value: p.progress_status },
            { label: 'outcome', value: p.expected_outcome }
          ],
          actions: [
            {
              id: 'project.publish',
              blocked: !p.public_description.trim() ? 'CONTENT_REQUIRED' : null
            }
          ],
          project: p
        });
    else if (projectResult.status === 'rejected') missing.push('projects');
    const sorted = [...new Map(decisions.map((d) => [d.id, d])).values()].sort(
      (a, b) =>
        WORK_QUEUE_PRIORITIES.indexOf(a.severity) -
          WORK_QUEUE_PRIORITIES.indexOf(b.severity) ||
        (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') ||
        a.id.localeCompare(b.id)
    );
    if (!writable)
      for (const d of sorted)
        for (const a of d.actions) a.blocked = 'READ_ONLY';
    if (!owner)
      for (const d of sorted)
        for (const a of d.actions)
          if (a.id.startsWith('project.')) a.blocked = 'READ_ONLY';
    const domainItems = sorted.filter(
      (d) => !query.domain || d.domain === query.domain
    );
    const selected = sorted.filter(
      (d) =>
        (!query.domain || d.domain === query.domain) &&
        (!query.id || d.id === query.id)
    );
    const pageSize = 30,
      page = Math.max(
        1,
        Math.min(
          query.page ?? 1,
          Math.max(1, Math.ceil(selected.length / pageSize))
        )
      );
    const pageItems = selected.slice((page - 1) * pageSize, page * pageSize);
    if (query.id && pageItems[0]?.domain === 'email') {
      const r = (
        await this.pool.query(
          'SELECT subject,text_body,recipient_email FROM email_messages WHERE id=$1',
          [pageItems[0].targetId]
        )
      ).rows[0];
      if (r)
        pageItems[0].email = {
          subject: r.subject,
          text: r.text_body,
          recipient: r.recipient_email
        };
    }
    return {
      generatedAt: new Date().toISOString(),
      coverage: missing.length ? 'partial' : 'complete',
      missingSources: missing,
      total: selected.length,
      page,
      pageSize,
      ...(query.id
        ? {
            focusPage: Math.max(
              1,
              Math.floor(
                domainItems.findIndex((d) => d.id === query.id) / pageSize
              ) + 1
            )
          }
        : {}),
      domains: Object.fromEntries(
        domains.map((d) => [d, sorted.filter((i) => i.domain === d).length])
      ) as Record<PilotDomain, number>,
      decisions: pageItems,
      feeds: (publicationState?.feeds ?? []).map((f) => ({
        ...f,
        version: hash(f)
      })),
      workerEnabled: publicationState?.workerEnabled ?? false,
      writable
    };
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
    return transaction(this.pool, async (db) => {
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
    const claimed = await transaction(this.pool, async (db) => {
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
    await transaction(this.pool, async (db) => {
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
      await transaction(this.pool, async (db) => {
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
      await transaction(this.pool, async (db) => {
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
      await transaction(this.pool, async (db) => {
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
