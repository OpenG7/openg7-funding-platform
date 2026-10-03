import type { Pool } from 'pg';

import type {
  PilotDecision,
  PilotDomain,
  PilotState,
  PublicationAutomationState
} from '../../../packages/funding-core/src/index.js';

import {
  loadAdminWorkQueue,
  WORK_QUEUE_PRIORITIES
} from './admin-work-queue.service.js';
import { listAdminExpenses } from './fund-admin.repository.js';
import { pilotageVersion as hash } from './admin-pilotage-version.js';

const domains: PilotDomain[] = [
  'publications',
  'sponsors',
  'email',
  'invoices',
  'contributions',
  'projects',
  'operations'
];

/** Read existing sources independently and project decisions without executing commands. */
export async function loadAdminPilotageState(
  pool: Pool,
  publications: { state(): Promise<PublicationAutomationState> },
  query: { page?: number; domain?: string; id?: string } = {},
  writable = true,
  owner = true
): Promise<PilotState> {
  const missing: string[] = [];
  const decisions: PilotDecision[] = [];
  const [publicationResult, attentionResult, projectResult, receiptPresence] =
    await Promise.allSettled([
      publications.state(),
      loadAdminWorkQueue(pool),
      listAdminExpenses(pool),
      pool.query(
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
      pool.query(
        `SELECT c.id,c.sponsor_company_name,c.sponsor_review_status,c.status,c.updated_at::text AS version,(SELECT m.id FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.deleted_at IS NULL ORDER BY (m.review_status='approved') DESC,m.created_at LIMIT 1) AS media_id,EXISTS(SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.review_status='approved' AND m.deleted_at IS NULL) AS photo FROM fund_contributions c WHERE c.id=ANY($1::uuid[])`,
        [sponsorIds]
      ),
      pool.query(
        `SELECT id,subject,status,updated_at::text AS version FROM email_messages WHERE id=ANY($1::uuid[])`,
        [emailIds]
      )
    ]);
    if (sponsorResult.status === 'rejected') missing.push('sponsors');
    if (emailResult.status === 'rejected') missing.push('email');
    const sponsors =
      sponsorResult.status === 'fulfilled' ? sponsorResult.value : { rows: [] };
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
            ([k]) => !['reference', 'amount', 'amountPaid', 'email'].includes(k)
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
    for (const d of sorted) for (const a of d.actions) a.blocked = 'READ_ONLY';
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
      await pool.query(
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
