import type {
  AdminAuditLogEntry,
  AdminAuditLogResponse,
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminExpensesSummary,
  AdminExpenseStatus,
  AdminExpenseUpdateRequest,
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchMutationResult,
  AdminPublicationBatchRecord,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftCreateRequest,
  AdminPublicationDraftMutationResult,
  AdminPublicationDraftRecord,
  AdminPublicationDraftUpdateRequest,
  AdminPublicationDraftsResponse,
  PublicationBatchStatus,
  PublicationDraftStatus,
  PublicSponsorshipBatchAvailability,
  PublicSponsorshipBatchAvailabilityResponse,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';
import type { Pool } from 'pg';

export const allowedPublicationDraftStatuses =
  new Set<PublicationDraftStatus>([
    'draft',
    'pending_review',
    'approved',
    'scheduled',
    'published',
    'rejected',
    'cancelled'
  ]);

export const allowedPublicationBatchStatuses =
  new Set<PublicationBatchStatus>([
    'open',
    'scheduled',
    'published',
    'cancelled'
  ]);

export const allowedAdminExpenseStatuses = new Set<AdminExpenseStatus>([
  'draft',
  'published',
  'active',
  'private',
  'archived'
]);

interface PublicationDraftRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly feed_target: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly title: string;
  readonly body: string;
  readonly disclosure_text: string;
  readonly status: PublicationDraftStatus;
  readonly public_url: string | null;
  readonly scheduled_at: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly review_note: string | null;
  readonly batch_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PublicationBatchRow {
  readonly id: string;
  readonly channel: SponsorFeedChannel;
  readonly capacity: string;
  readonly status: PublicationBatchStatus;
  readonly scheduled_at: string | null;
  readonly published_at: string | null;
  readonly notes: string | null;
  readonly assigned_draft_ids: readonly string[] | null;
  readonly capacity_used: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SponsorDraftSourceRow {
  readonly id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly sponsor_message: string | null;
}

interface AuditLogRow {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly summary: string | null;
  readonly metadata: unknown;
  readonly created_at: string;
}

interface AdminBackofficePresenceRow {
  readonly has_publication_drafts: boolean;
  readonly has_publication_batches: boolean;
  readonly has_audit_log: boolean;
  readonly has_fund_allocations: boolean;
}

interface AdminExpenseRow {
  readonly id: string;
  readonly project_name: string;
  readonly public_description: string;
  readonly amount_allocated: string;
  readonly currency: string;
  readonly status: AdminExpenseStatus;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AdminExpensesSummaryRow {
  readonly total_count: string;
  readonly published_count: string;
  readonly draft_count: string;
  readonly private_count: string;
  readonly archived_count: string;
  readonly total_allocated: string;
  readonly published_allocated: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

export interface AdminAuditLogInput {
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly summary: string | null;
  readonly metadata?: Record<string, unknown>;
}

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

const amountToCents = (value: number): number => Math.round(value * 100);

const parseDbInt = (value: string): number => Number.parseInt(value, 10);

const normalizeAdminExpenseStatus = (
  value: AdminExpenseStatus
): AdminExpenseStatus =>
  allowedAdminExpenseStatuses.has(value) ? value : 'draft';

const mapAdminExpenseRow = (row: AdminExpenseRow): AdminExpenseRecord => ({
  id: row.id,
  project_name: row.project_name,
  public_description: row.public_description,
  amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
  currency: row.currency.toUpperCase(),
  status: normalizeAdminExpenseStatus(row.status),
  published_at: row.published_at,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapPublicationDraftRow = (
  row: PublicationDraftRow
): AdminPublicationDraftRecord => ({
  id: row.id,
  contribution_id: row.contribution_id,
  sponsor_company_name: row.sponsor_company_name,
  sponsor_website_url: row.sponsor_website_url,
  sponsor_logo_url: row.sponsor_logo_url,
  sponsor_public_summary: row.sponsor_public_summary,
  feed_target: row.feed_target,
  channel: row.channel,
  title: row.title,
  body: row.body,
  disclosure_text: row.disclosure_text,
  status: row.status,
  public_url: row.public_url,
  scheduled_at: row.scheduled_at,
  approved_at: row.approved_at,
  published_at: row.published_at,
  review_note: row.review_note,
  batch_id: row.batch_id,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const mapPublicationBatchRow = (
  row: PublicationBatchRow
): AdminPublicationBatchRecord => {
  const capacity = parseDbInt(row.capacity);
  const capacityUsed = parseDbInt(row.capacity_used);

  return {
    id: row.id,
    channel: row.channel,
    capacity,
    status: row.status,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    notes: row.notes,
    assignedDraftIds: (row.assigned_draft_ids ?? []).filter(
      (draftId): draftId is string => Boolean(draftId)
    ),
    capacityUsed,
    capacityAvailable: Math.max(0, capacity - capacityUsed),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const mapAuditLogRow = (row: AuditLogRow): AdminAuditLogEntry => ({
  id: row.id,
  actor: row.actor,
  action: row.action,
  entity_type: row.entity_type,
  entity_id: row.entity_id,
  summary: row.summary,
  metadata:
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {},
  created_at: row.created_at
});

const getAdminBackofficePresence = async (
  pool: Pool
): Promise<AdminBackofficePresenceRow> => {
  const query = await pool.query<AdminBackofficePresenceRow>(`
    SELECT
      to_regclass('public.sponsor_publication_drafts') IS NOT NULL AS has_publication_drafts,
      to_regclass('public.sponsor_publication_batches') IS NOT NULL AS has_publication_batches,
      to_regclass('public.admin_audit_log') IS NOT NULL AS has_audit_log,
      to_regclass('public.fund_allocations') IS NOT NULL AS has_fund_allocations
  `);

  return query.rows[0] ?? {
    has_publication_drafts: false,
    has_publication_batches: false,
    has_audit_log: false,
    has_fund_allocations: false
  };
};

const defaultDisclosureText =
  'Publication commanditee - Fonds des batisseurs OpenG7';

const createDefaultDraftText = (
  sponsor: SponsorDraftSourceRow,
  feedTarget: SponsorFeedTarget,
  channel: SponsorFeedChannel
): { readonly title: string; readonly body: string; readonly disclosureText: string } => {
  const publicSummary =
    sponsor.sponsor_public_summary?.trim() ||
    sponsor.sponsor_message?.trim() ||
    'Cette commandite soutient le developpement independant et open source du projet.';
  const feedName = feedTarget === 'openg20' ? 'OpenG20' : 'OpenG7';
  const channelName = channel === 'linkedin' ? 'LinkedIn' : 'Facebook';

  return {
    title: `Commandite de visibilite - ${sponsor.sponsor_company_name}`,
    body: [
      `${feedName} remercie ${sponsor.sponsor_company_name} pour son soutien au Fonds des batisseurs.`,
      publicSummary,
      `Texte prepare pour ${channelName}.`,
      'Transparence: cette publication fait partie d une contrepartie de visibilite associee au Fonds des batisseurs OpenG7.'
    ].join('\n\n'),
    disclosureText: defaultDisclosureText
  };
};

const getPublicationDraftById = async (
  pool: Pool,
  draftId: string
): Promise<AdminPublicationDraftRecord | null> => {
  const query = await pool.query<PublicationDraftRow>(
    `
      SELECT
        draft.id::text AS id,
        draft.contribution_id::text AS contribution_id,
        contribution.sponsor_company_name,
        contribution.sponsor_website_url,
        contribution.sponsor_logo_url,
        contribution.sponsor_public_summary,
        draft.feed_target,
        draft.channel,
        draft.title,
        draft.body,
        draft.disclosure_text,
        draft.status,
        draft.public_url,
        draft.scheduled_at::text AS scheduled_at,
        draft.approved_at::text AS approved_at,
        draft.published_at::text AS published_at,
        draft.review_note,
        draft.batch_id::text AS batch_id,
        draft.created_at::text AS created_at,
        draft.updated_at::text AS updated_at
      FROM sponsor_publication_drafts draft
      INNER JOIN fund_contributions contribution
        ON contribution.id = draft.contribution_id
      WHERE draft.id = $1::uuid
      LIMIT 1
    `,
    [draftId]
  );

  const row = query.rows[0];
  return row ? mapPublicationDraftRow(row) : null;
};

export const listAdminPublicationDrafts = async (
  pool: Pool | null
): Promise<AdminPublicationDraftsResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      drafts: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return {
      data_source: 'database',
      drafts: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<PublicationDraftRow>(`
    SELECT
      draft.id::text AS id,
      draft.contribution_id::text AS contribution_id,
      contribution.sponsor_company_name,
      contribution.sponsor_website_url,
      contribution.sponsor_logo_url,
      contribution.sponsor_public_summary,
      draft.feed_target,
      draft.channel,
      draft.title,
      draft.body,
      draft.disclosure_text,
      draft.status,
      draft.public_url,
      draft.scheduled_at::text AS scheduled_at,
      draft.approved_at::text AS approved_at,
      draft.published_at::text AS published_at,
      draft.review_note,
      draft.batch_id::text AS batch_id,
      draft.created_at::text AS created_at,
      draft.updated_at::text AS updated_at
    FROM sponsor_publication_drafts draft
    INNER JOIN fund_contributions contribution
      ON contribution.id = draft.contribution_id
    ORDER BY
      CASE draft.status
        WHEN 'pending_review' THEN 0
        WHEN 'draft' THEN 1
        WHEN 'approved' THEN 2
        WHEN 'scheduled' THEN 3
        WHEN 'published' THEN 4
        ELSE 5
      END,
      draft.updated_at DESC
    LIMIT 100
  `);

  return {
    data_source: 'database',
    drafts: query.rows.map(mapPublicationDraftRow),
    last_updated_at:
      query.rows.reduce<string | null>((latest, row) => {
        if (!latest) {
          return row.updated_at;
        }

        return new Date(row.updated_at).getTime() > new Date(latest).getTime()
          ? row.updated_at
          : latest;
      }, null) ?? now
  };
};

export const createAdminPublicationDraft = async (
  pool: Pool | null,
  input: AdminPublicationDraftCreateRequest
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return { updated: false, draft: null };
  }

  const sponsorQuery = await pool.query<SponsorDraftSourceRow>(
    `
      SELECT
        id::text AS id,
        sponsor_company_name,
        sponsor_website_url,
        sponsor_logo_url,
        sponsor_public_summary,
        sponsor_message
      FROM fund_contributions
      WHERE id = $1::uuid
        AND contribution_type = 'sponsorship_interest'
        AND status IN ('paid', 'refunded', 'disputed')
        AND public_display_consent IS TRUE
        AND sponsor_review_status = 'approved'
        AND sponsor_company_name IS NOT NULL
        AND btrim(sponsor_company_name) <> ''
      LIMIT 1
    `,
    [input.contributionId]
  );
  const sponsor = sponsorQuery.rows[0];
  if (!sponsor) {
    return { updated: false, draft: null };
  }

  const draftText = createDefaultDraftText(
    sponsor,
    input.feedTarget,
    input.channel
  );

  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO sponsor_publication_drafts (
        contribution_id,
        feed_target,
        channel,
        title,
        body,
        disclosure_text,
        status
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, 'draft')
      ON CONFLICT (contribution_id, feed_target, channel)
      DO UPDATE SET updated_at = sponsor_publication_drafts.updated_at
      RETURNING id::text AS id
    `,
    [
      input.contributionId,
      input.feedTarget,
      input.channel,
      draftText.title,
      draftText.body,
      draftText.disclosureText
    ]
  );

  const draftId = insertResult.rows[0]?.id;
  return {
    updated: Boolean(draftId),
    draft: draftId ? await getPublicationDraftById(pool, draftId) : null
  };
};

export const updateAdminPublicationDraft = async (
  pool: Pool | null,
  input: AdminPublicationDraftUpdateRequest
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return { updated: false, draft: null };
  }

  const assignments: string[] = [];
  const values: unknown[] = [input.draftId];

  const addAssignment = (sql: string, value: unknown): void => {
    values.push(value);
    assignments.push(sql.replace('?', `$${values.length}`));
  };

  if (input.title !== undefined) {
    addAssignment('title = ?', input.title.trim());
  }

  if (input.body !== undefined) {
    addAssignment('body = ?', input.body.trim());
  }

  if (input.disclosureText !== undefined) {
    addAssignment('disclosure_text = ?', input.disclosureText.trim());
  }

  if (input.status !== undefined) {
    addAssignment('status = ?', input.status);
    if (input.status === 'approved') {
      assignments.push('approved_at = COALESCE(approved_at, NOW())');
    }
    if (input.status === 'published') {
      assignments.push('published_at = COALESCE(published_at, NOW())');
    }
  }

  if (input.publicUrl !== undefined) {
    addAssignment('public_url = NULLIF(?, \'\')', input.publicUrl.trim());
  }

  if (input.scheduledAt !== undefined) {
    addAssignment('scheduled_at = ?::timestamptz', input.scheduledAt);
  }

  if (input.reviewNote !== undefined) {
    addAssignment('review_note = NULLIF(?, \'\')', input.reviewNote.trim());
  }

  if (assignments.length === 0) {
    return {
      updated: false,
      draft: await getPublicationDraftById(pool, input.draftId)
    };
  }

  assignments.push('updated_at = NOW()');
  const result = await pool.query(
    `
      UPDATE sponsor_publication_drafts
      SET ${assignments.join(', ')}
      WHERE id = $1::uuid
    `,
    values
  );

  return {
    updated: (result.rowCount ?? 0) > 0,
    draft: await getPublicationDraftById(pool, input.draftId)
  };
};

const publicationBatchSelect = `
  SELECT
    batch.id::text AS id,
    batch.channel,
    batch.capacity::text AS capacity,
    batch.status,
    batch.scheduled_at::text AS scheduled_at,
    batch.published_at::text AS published_at,
    batch.notes,
    COALESCE(
      array_agg(draft.id::text) FILTER (WHERE draft.id IS NOT NULL),
      ARRAY[]::text[]
    ) AS assigned_draft_ids,
    COUNT(draft.id)::text AS capacity_used,
    batch.created_at::text AS created_at,
    batch.updated_at::text AS updated_at
  FROM sponsor_publication_batches batch
  LEFT JOIN sponsor_publication_drafts draft ON draft.batch_id = batch.id
`;

export const getPublicationBatchById = async (
  pool: Pool | null,
  batchId: string
): Promise<AdminPublicationBatchRecord | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<PublicationBatchRow>(
    `
      ${publicationBatchSelect}
      WHERE batch.id = $1::uuid
      GROUP BY batch.id
      LIMIT 1
    `,
    [batchId]
  );

  const row = query.rows[0];
  return row ? mapPublicationBatchRow(row) : null;
};

const publicSponsorshipBatchChannels: readonly SponsorFeedChannel[] = [
  'facebook',
  'linkedin'
];

/**
 * Public-safe: only the earliest scheduled date per channel, no sponsor
 * names, no draft content, no capacity numbers. Open (undated) batches are
 * intentionally excluded since their date is not committed yet.
 */
export const getPublicSponsorshipBatchAvailability = async (
  pool: Pool | null
): Promise<PublicSponsorshipBatchAvailabilityResponse> => {
  if (!pool) {
    return { data_source: 'empty', availability: [] };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { data_source: 'empty', availability: [] };
  }

  const query = await pool.query<{
    readonly channel: SponsorFeedChannel;
    readonly next_available_at: string | null;
  }>(`
    SELECT channel, MIN(scheduled_at)::text AS next_available_at
    FROM sponsor_publication_batches
    WHERE status = 'scheduled'
    GROUP BY channel
  `);

  const nextAvailableByChannel = new Map(
    query.rows.map((row) => [row.channel, row.next_available_at])
  );

  const availability: readonly PublicSponsorshipBatchAvailability[] =
    publicSponsorshipBatchChannels.map((channel) => ({
      channel,
      nextAvailableAt: nextAvailableByChannel.get(channel) ?? null
    }));

  return { data_source: 'database', availability };
};

export const listAdminPublicationBatches = async (
  pool: Pool | null
): Promise<AdminPublicationBatchesResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return { data_source: 'database', batches: [], last_updated_at: now };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { data_source: 'database', batches: [], last_updated_at: now };
  }

  // Grouped by channel, then chronologically within each channel, so an
  // admin sees several upcoming batches for a channel at a glance instead
  // of a flat status-only list: scheduled batches soonest-first, then
  // open (undated) batches, then published/cancelled history.
  const query = await pool.query<PublicationBatchRow>(`
    ${publicationBatchSelect}
    GROUP BY batch.id
    ORDER BY
      batch.channel,
      CASE batch.status
        WHEN 'scheduled' THEN 0
        WHEN 'open' THEN 1
        WHEN 'published' THEN 2
        ELSE 3
      END,
      COALESCE(batch.scheduled_at, batch.created_at) ASC
    LIMIT 100
  `);

  return {
    data_source: 'database',
    batches: query.rows.map(mapPublicationBatchRow),
    last_updated_at:
      query.rows.reduce<string | null>((latest, row) => {
        if (!latest) {
          return row.updated_at;
        }

        return new Date(row.updated_at).getTime() > new Date(latest).getTime()
          ? row.updated_at
          : latest;
      }, null) ?? now
  };
};

export const createAdminPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchCreateRequest
): Promise<AdminPublicationBatchMutationResult> => {
  if (!pool) {
    return { updated: false, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { updated: false, batch: null };
  }

  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO sponsor_publication_batches (channel, capacity, notes)
      VALUES ($1, $2, NULLIF($3, ''))
      RETURNING id::text AS id
    `,
    [input.channel, input.capacity, input.notes?.trim() ?? '']
  );

  const batchId = insertResult.rows[0]?.id;
  return {
    updated: Boolean(batchId),
    batch: batchId ? await getPublicationBatchById(pool, batchId) : null
  };
};

/**
 * Assigns an already-approved draft to an open batch of the same channel,
 * atomically enforcing the batch's remaining capacity in a single statement
 * so two concurrent admin actions cannot overbook the same collective post.
 */
export const assignDraftToPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchAssignRequest
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts || !presence.has_publication_batches) {
    return { updated: false, draft: null };
  }

  const result = await pool.query(
    `
      WITH target_batch AS (
        SELECT
          batch.id,
          batch.channel,
          batch.status,
          batch.capacity,
          (
            SELECT COUNT(*) FROM sponsor_publication_drafts
            WHERE batch_id = batch.id
          ) AS used
        FROM sponsor_publication_batches batch
        WHERE batch.id = $2::uuid
      )
      UPDATE sponsor_publication_drafts draft
      SET batch_id = $2::uuid, updated_at = NOW()
      FROM target_batch
      WHERE draft.id = $1::uuid
        AND draft.status = 'approved'
        AND draft.channel = target_batch.channel
        AND target_batch.status = 'open'
        AND target_batch.used < target_batch.capacity
    `,
    [input.draftId, input.batchId]
  );

  return {
    updated: (result.rowCount ?? 0) > 0,
    draft: await getPublicationDraftById(pool, input.draftId)
  };
};

export const unassignDraftFromPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchUnassignRequest
): Promise<AdminPublicationDraftMutationResult> => {
  if (!pool) {
    return { updated: false, draft: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_drafts) {
    return { updated: false, draft: null };
  }

  const result = await pool.query(
    `
      UPDATE sponsor_publication_drafts
      SET
        batch_id = NULL,
        status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND batch_id IS NOT NULL
        AND status <> 'published'
    `,
    [input.draftId]
  );

  return {
    updated: (result.rowCount ?? 0) > 0,
    draft: await getPublicationDraftById(pool, input.draftId)
  };
};

export const scheduleAdminPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchScheduleRequest
): Promise<AdminPublicationBatchMutationResult> => {
  if (!pool) {
    return { updated: false, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { updated: false, batch: null };
  }

  const result = await pool.query(
    `
      UPDATE sponsor_publication_batches
      SET status = 'scheduled', scheduled_at = $2::timestamptz, updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('open', 'scheduled')
    `,
    [input.batchId, input.scheduledAt]
  );

  if ((result.rowCount ?? 0) > 0) {
    await pool.query(
      `
        UPDATE sponsor_publication_drafts
        SET status = 'scheduled', scheduled_at = $2::timestamptz, updated_at = NOW()
        WHERE batch_id = $1::uuid
          AND status = 'approved'
      `,
      [input.batchId, input.scheduledAt]
    );
  }

  return {
    updated: (result.rowCount ?? 0) > 0,
    batch: await getPublicationBatchById(pool, input.batchId)
  };
};

/**
 * Publishing is always an explicit admin action taken on an already
 * scheduled batch. It cascades to every draft still assigned to the batch,
 * mirroring one real collective post going out for all of them at once.
 */
export const publishAdminPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchLifecycleRequest
): Promise<AdminPublicationBatchMutationResult> => {
  if (!pool) {
    return { updated: false, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { updated: false, batch: null };
  }

  const result = await pool.query(
    `
      UPDATE sponsor_publication_batches
      SET
        status = 'published',
        published_at = COALESCE(published_at, NOW()),
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status = 'scheduled'
    `,
    [input.batchId]
  );

  if ((result.rowCount ?? 0) > 0) {
    await pool.query(
      `
        UPDATE sponsor_publication_drafts
        SET
          status = 'published',
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
        WHERE batch_id = $1::uuid
          AND status IN ('approved', 'scheduled')
      `,
      [input.batchId]
    );
  }

  return {
    updated: (result.rowCount ?? 0) > 0,
    batch: await getPublicationBatchById(pool, input.batchId)
  };
};

export const cancelAdminPublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchLifecycleRequest
): Promise<AdminPublicationBatchMutationResult> => {
  if (!pool) {
    return { updated: false, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { updated: false, batch: null };
  }

  const result = await pool.query(
    `
      UPDATE sponsor_publication_batches
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('open', 'scheduled')
    `,
    [input.batchId]
  );

  if ((result.rowCount ?? 0) > 0) {
    await pool.query(
      `
        UPDATE sponsor_publication_drafts
        SET
          batch_id = NULL,
          status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,
          updated_at = NOW()
        WHERE batch_id = $1::uuid
      `,
      [input.batchId]
    );
  }

  return {
    updated: (result.rowCount ?? 0) > 0,
    batch: await getPublicationBatchById(pool, input.batchId)
  };
};

const emptyAdminExpensesSummary = (): AdminExpensesSummary => ({
  total_count: 0,
  published_count: 0,
  draft_count: 0,
  private_count: 0,
  archived_count: 0,
  total_allocated: 0,
  published_allocated: 0,
  currency: 'CAD'
});

const getAdminExpensesSummary = async (
  pool: Pool | null
): Promise<{
  readonly summary: AdminExpensesSummary;
  readonly lastUpdatedAt: string;
}> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  const query = await pool.query<AdminExpensesSummaryRow>(`
    SELECT
      COUNT(*)::text AS total_count,
      COALESCE(SUM(CASE WHEN status IN ('published', 'active') THEN 1 ELSE 0 END), 0)::text AS published_count,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0)::text AS draft_count,
      COALESCE(SUM(CASE WHEN status = 'private' THEN 1 ELSE 0 END), 0)::text AS private_count,
      COALESCE(SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END), 0)::text AS archived_count,
      COALESCE(SUM(CASE WHEN status <> 'archived' THEN amount_allocated ELSE 0 END), 0)::text AS total_allocated,
      COALESCE(SUM(CASE WHEN status IN ('published', 'active') THEN amount_allocated ELSE 0 END), 0)::text AS published_allocated,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(updated_at), NOW())::text AS last_updated_at
    FROM fund_allocations
  `);

  const row = query.rows[0];
  if (!row) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  return {
    summary: {
      total_count: parseDbInt(row.total_count),
      published_count: parseDbInt(row.published_count),
      draft_count: parseDbInt(row.draft_count),
      private_count: parseDbInt(row.private_count),
      archived_count: parseDbInt(row.archived_count),
      total_allocated: centsToAmount(parseDbInt(row.total_allocated)),
      published_allocated: centsToAmount(parseDbInt(row.published_allocated)),
      currency: row.currency.toUpperCase()
    },
    lastUpdatedAt: row.last_updated_at
  };
};

const getAdminExpenseById = async (
  pool: Pool,
  expenseId: string
): Promise<AdminExpenseRecord | null> => {
  const query = await pool.query<AdminExpenseRow>(
    `
      SELECT
        id::text AS id,
        project_name,
        public_description,
        amount_allocated::text AS amount_allocated,
        currency,
        status,
        published_at::text AS published_at,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM fund_allocations
      WHERE id = $1::bigint
      LIMIT 1
    `,
    [expenseId]
  );

  const row = query.rows[0];
  return row ? mapAdminExpenseRow(row) : null;
};

export const listAdminExpenses = async (
  pool: Pool | null
): Promise<AdminExpensesResponse> => {
  const now = new Date().toISOString();
  const { summary, lastUpdatedAt } = await getAdminExpensesSummary(pool);

  if (!pool) {
    return {
      data_source: 'database',
      summary,
      expenses: [],
      last_updated_at: lastUpdatedAt
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return {
      data_source: 'database',
      summary,
      expenses: [],
      last_updated_at: lastUpdatedAt
    };
  }

  const query = await pool.query<AdminExpenseRow>(`
    SELECT
      id::text AS id,
      project_name,
      public_description,
      amount_allocated::text AS amount_allocated,
      currency,
      status,
      published_at::text AS published_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM fund_allocations
    ORDER BY
      CASE status
        WHEN 'draft' THEN 0
        WHEN 'published' THEN 1
        WHEN 'active' THEN 1
        WHEN 'private' THEN 2
        ELSE 3
      END,
      COALESCE(published_at, updated_at, created_at) DESC
    LIMIT 250
  `);

  return {
    data_source: 'database',
    summary,
    expenses: query.rows.map(mapAdminExpenseRow),
    last_updated_at: query.rows[0]?.updated_at ?? lastUpdatedAt ?? now
  };
};

export const createAdminExpense = async (
  pool: Pool | null,
  input: AdminExpenseCreateRequest
): Promise<AdminExpenseMutationResult> => {
  if (!pool) {
    return { updated: false, expense: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return { updated: false, expense: null };
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO fund_allocations (
        project_name,
        public_description,
        amount_allocated,
        currency,
        status,
        published_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
      RETURNING id::text AS id
    `,
    [
      input.projectName.trim(),
      input.publicDescription.trim(),
      amountToCents(input.amountAllocated),
      input.currency.toLowerCase(),
      input.status,
      input.publishedAt ??
        (input.status === 'published' || input.status === 'active'
          ? new Date().toISOString()
          : null)
    ]
  );

  const id = result.rows[0]?.id;
  return {
    updated: Boolean(id),
    expense: id ? await getAdminExpenseById(pool, id) : null
  };
};

export const updateAdminExpense = async (
  pool: Pool | null,
  input: AdminExpenseUpdateRequest
): Promise<AdminExpenseMutationResult> => {
  if (!pool) {
    return { updated: false, expense: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return { updated: false, expense: null };
  }

  const assignments: string[] = [];
  const values: unknown[] = [input.expenseId];

  const addAssignment = (sql: string, value: unknown): void => {
    values.push(value);
    assignments.push(sql.replace('?', `$${values.length}`));
  };

  if (input.projectName !== undefined) {
    addAssignment('project_name = ?', input.projectName.trim());
  }

  if (input.publicDescription !== undefined) {
    addAssignment('public_description = ?', input.publicDescription.trim());
  }

  if (input.amountAllocated !== undefined) {
    addAssignment('amount_allocated = ?', amountToCents(input.amountAllocated));
  }

  if (input.currency !== undefined) {
    addAssignment('currency = ?', input.currency.toLowerCase());
  }

  if (input.status !== undefined) {
    addAssignment('status = ?', input.status);
    if (input.status === 'published' || input.status === 'active') {
      assignments.push('published_at = COALESCE(published_at, NOW())');
    }
  }

  if (input.publishedAt !== undefined) {
    addAssignment('published_at = ?::timestamptz', input.publishedAt);
  }

  if (assignments.length === 0) {
    return {
      updated: false,
      expense: await getAdminExpenseById(pool, input.expenseId)
    };
  }

  assignments.push('updated_at = NOW()');
  const result = await pool.query(
    `
      UPDATE fund_allocations
      SET ${assignments.join(', ')}
      WHERE id = $1::bigint
    `,
    values
  );

  return {
    updated: (result.rowCount ?? 0) > 0,
    expense: await getAdminExpenseById(pool, input.expenseId)
  };
};

export const insertAdminAuditLog = async (
  pool: Pool | null,
  input: AdminAuditLogInput
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_audit_log) {
    return false;
  }

  const result = await pool.query(
    `
      INSERT INTO admin_audit_log (
        actor,
        action,
        entity_type,
        entity_id,
        summary,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.actor,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return (result.rowCount ?? 0) > 0;
};

export const listAdminAuditLog = async (
  pool: Pool | null
): Promise<AdminAuditLogResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      entries: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_audit_log) {
    return {
      data_source: 'database',
      entries: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<AuditLogRow>(`
    SELECT
      id::text AS id,
      actor,
      action,
      entity_type,
      entity_id,
      summary,
      metadata,
      created_at::text AS created_at
    FROM admin_audit_log
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return {
    data_source: 'database',
    entries: query.rows.map(mapAuditLogRow),
    last_updated_at: query.rows[0]?.created_at ?? now
  };
};
