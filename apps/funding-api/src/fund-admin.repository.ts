import type {
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
  AdminSocialPublicationBatchPublishResult,
  AdminSocialPublicationJobRecord,
  AdminSocialPublicationJobsResponse,
  PublicationBatchStatus,
  PublicationDraftStatus,
  SocialPublicationMode,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  mapPublicationBatchRow,
  mapPublicationDraftRow,
  mapSocialPublicationJobRow,
  type PublicationBatchRow,
  type PublicationDraftRow,
  type SocialPublicationJobRow
} from './fund-publication.mapping.js';
import { getAdminBackofficePresence } from './fund-admin.persistence.js';

export {
  allowedAdminExpenseStatuses,
  AdminExpenseValidationError,
  listAdminExpenses,
  createAdminExpense,
  updateAdminExpense
} from './fund-expenses.repository.js';
export type { AdminExpenseAuditInput } from './fund-expenses.repository.js';
export {
  insertAdminAuditLog,
  findSponsorshipRequestAudit,
  listAdminAuditLog
} from './fund-admin-audit.repository.js';
export type {
  AdminAuditLogInput,
  SponsorshipRequestAudit
} from './fund-admin-audit.repository.js';

export {
  allowedPublicationSlotStatuses,
  getPublicSponsorshipBatchAvailability,
  listAdminPublicationSlots,
  createAdminPublicationSlot,
  updateAdminPublicationSlot,
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot,
  publishAdminPublicationSlot,
  cancelAdminPublicationSlot
} from './fund-publication-calendar.repository.js';

export const allowedPublicationDraftStatuses = new Set<PublicationDraftStatus>([
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'cancelled'
]);

export const allowedPublicationBatchStatuses = new Set<PublicationBatchStatus>([
  'open',
  'scheduled',
  'published',
  'cancelled'
]);

interface SponsorDraftSourceRow {
  readonly id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly sponsor_message: string | null;
}

const defaultDisclosureText =
  'Publication commanditee - Fonds des batisseurs OpenG7';

const createDefaultDraftText = (
  sponsor: SponsorDraftSourceRow,
  feedTarget: SponsorFeedTarget,
  channel: SponsorFeedChannel
): {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
} => {
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
        draft.slot_id::text AS slot_id,
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
  pool: Pool | PoolClient | null,
  options: {
    readonly all?: boolean;
    readonly id?: string;
    readonly contributionId?: string;
  } = {}
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
      draft.slot_id::text AS slot_id,
      draft.created_at::text AS created_at,
      draft.updated_at::text AS updated_at
    FROM sponsor_publication_drafts draft
    INNER JOIN fund_contributions contribution
      ON contribution.id = draft.contribution_id
    WHERE ($1::text IS NULL OR draft.id::text = $1)
      AND ($3::text IS NULL OR draft.contribution_id::text = $3)
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
    LIMIT $2
  `,
    [
      options.id ?? null,
      options.all ? null : 100,
      options.contributionId ?? null
    ]
  );

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
    addAssignment("public_url = NULLIF(?, '')", input.publicUrl.trim());
  }

  if (input.scheduledAt !== undefined) {
    addAssignment('scheduled_at = ?::timestamptz', input.scheduledAt);
  }

  if (input.reviewNote !== undefined) {
    addAssignment("review_note = NULLIF(?, '')", input.reviewNote.trim());
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
    batch.slot_id::text AS slot_id,
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

export const listAdminPublicationBatches = async (
  pool: Pool | null,
  options: { readonly all?: boolean; readonly id?: string } = {}
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
  const query = await pool.query<PublicationBatchRow>(
    `
    ${publicationBatchSelect}
    WHERE ($1::text IS NULL OR batch.id::text = $1)
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
    LIMIT $2
  `,
    [options.id ?? null, options.all ? null : 100]
  );

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
          batch.scheduled_at,
          batch.slot_id,
          slot.feed_target AS slot_feed_target,
          slot.starts_at AS slot_starts_at,
          slot.status AS slot_status,
          slot.capacity AS slot_capacity,
          (
            SELECT COUNT(*) FROM sponsor_publication_drafts
            WHERE batch_id = batch.id
          ) AS used,
          (
            SELECT COUNT(DISTINCT used_draft.id)::integer
            FROM sponsor_publication_drafts used_draft
            LEFT JOIN sponsor_publication_batches used_batch
              ON used_batch.id = used_draft.batch_id
            WHERE slot.id IS NOT NULL
              AND (
                used_draft.slot_id = slot.id
                OR used_batch.slot_id = slot.id
              )
          ) AS slot_used
        FROM sponsor_publication_batches batch
        LEFT JOIN publication_slots slot ON slot.id = batch.slot_id
        WHERE batch.id = $2::uuid
      )
      UPDATE sponsor_publication_drafts draft
      SET
        batch_id = $2::uuid,
        slot_id = target_batch.slot_id,
        status = CASE
          WHEN target_batch.status = 'scheduled' THEN 'scheduled'
          ELSE draft.status
        END,
        scheduled_at = CASE
          WHEN target_batch.status = 'scheduled'
            THEN COALESCE(target_batch.slot_starts_at, target_batch.scheduled_at)
          ELSE draft.scheduled_at
        END,
        updated_at = NOW()
      FROM target_batch
      WHERE draft.id = $1::uuid
        AND draft.status = 'approved'
        AND draft.batch_id IS NULL
        AND draft.channel = target_batch.channel
        AND target_batch.status IN ('open', 'scheduled')
        AND target_batch.used < target_batch.capacity
        AND (
          target_batch.slot_id IS NULL
          OR (
            draft.feed_target = target_batch.slot_feed_target
            AND target_batch.slot_status IN ('open', 'scheduled')
            AND target_batch.slot_starts_at > NOW()
            AND target_batch.slot_used < target_batch.slot_capacity
          )
        )
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
        slot_id = NULL,
        status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,
        scheduled_at = CASE
          WHEN status = 'scheduled' THEN NULL
          ELSE scheduled_at
        END,
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

  if (presence.has_publication_slots) {
    await pool.query(
      `
        UPDATE publication_slots slot
        SET starts_at = $2::timestamptz, status = 'scheduled', updated_at = NOW()
        FROM sponsor_publication_batches batch
        WHERE batch.id = $1::uuid
          AND batch.slot_id = slot.id
          AND slot.status IN ('open', 'scheduled')
          AND $2::timestamptz > NOW()
      `,
      [input.batchId, input.scheduledAt]
    );
  }

  const result = await pool.query(
    `
      UPDATE sponsor_publication_batches
      SET status = 'scheduled', scheduled_at = $2::timestamptz, updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('open', 'scheduled')
        AND $2::timestamptz > NOW()
    `,
    [input.batchId, input.scheduledAt]
  );

  if ((result.rowCount ?? 0) > 0) {
    await pool.query(
      `
        UPDATE sponsor_publication_drafts draft
        SET
          status = 'scheduled',
          slot_id = batch.slot_id,
          scheduled_at = $2::timestamptz,
          updated_at = NOW()
        FROM sponsor_publication_batches batch
        WHERE draft.batch_id = batch.id
          AND batch.id = $1::uuid
          AND draft.status IN ('approved', 'scheduled')
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

    if (presence.has_publication_slots) {
      await pool.query(
        `
          UPDATE publication_slots slot
          SET status = 'published', updated_at = NOW()
          WHERE slot.id IN (
              SELECT slot_id
              FROM sponsor_publication_batches
              WHERE id = $1::uuid
                AND slot_id IS NOT NULL
            )
            AND EXISTS (
              SELECT 1
              FROM sponsor_publication_drafts draft
              LEFT JOIN sponsor_publication_batches batch
                ON batch.id = draft.batch_id
              WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                AND draft.status = 'published'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM sponsor_publication_drafts draft
              LEFT JOIN sponsor_publication_batches batch
                ON batch.id = draft.batch_id
              WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                AND draft.status <> 'published'
            )
        `,
        [input.batchId]
      );
    }
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
      SET status = 'cancelled', slot_id = NULL, updated_at = NOW()
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
          slot_id = NULL,
          status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,
          scheduled_at = CASE
            WHEN status = 'scheduled' THEN NULL
            ELSE scheduled_at
          END,
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

const socialPublicationJobSelect = `
  SELECT
    id::text AS id,
    batch_id::text AS batch_id,
    channel,
    provider,
    mode,
    status,
    idempotency_key,
    title,
    body,
    disclosure_text,
    array(SELECT draft_id::text FROM unnest(draft_ids) AS draft_id) AS draft_ids,
    external_post_id,
    external_post_url,
    error_code,
    error_message,
    attempted_at::text AS attempted_at,
    published_at::text AS published_at,
    created_at::text AS created_at,
    updated_at::text AS updated_at
  FROM social_publication_jobs
`;

const getSocialPublicationJobById = async (
  pool: Pool,
  jobId: string
): Promise<AdminSocialPublicationJobRecord | null> => {
  const query = await pool.query<SocialPublicationJobRow>(
    `
      ${socialPublicationJobSelect}
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [jobId]
  );
  const row = query.rows[0];
  return row ? mapSocialPublicationJobRow(row) : null;
};

export const listAdminSocialPublicationJobs = async (
  pool: Pool | null,
  runtime: {
    readonly mode: SocialPublicationMode;
    readonly configuredChannels: readonly SponsorFeedChannel[];
  }
): Promise<AdminSocialPublicationJobsResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      data_source: 'database',
      mode: runtime.mode,
      configuredChannels: runtime.configuredChannels,
      jobs: [],
      last_updated_at: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_social_publication_jobs) {
    return {
      data_source: 'database',
      mode: runtime.mode,
      configuredChannels: runtime.configuredChannels,
      jobs: [],
      last_updated_at: now
    };
  }

  const query = await pool.query<SocialPublicationJobRow>(`
    ${socialPublicationJobSelect}
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return {
    data_source: 'database',
    mode: runtime.mode,
    configuredChannels: runtime.configuredChannels,
    jobs: query.rows.map(mapSocialPublicationJobRow),
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

const truncatePublicationText = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const buildSocialPublicationText = (
  batch: AdminPublicationBatchRecord,
  drafts: readonly AdminPublicationDraftRecord[]
): {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly draftIds: readonly string[];
} => {
  const targetNames = new Set(
    drafts.map((draft) =>
      draft.feed_target === 'openg20' ? 'OpenG20' : 'OpenG7'
    )
  );
  const audience = Array.from(targetNames).join(' et ') || 'OpenG7';
  const sponsorLines = drafts.map((draft) => {
    const summary = draft.sponsor_public_summary
      ? truncatePublicationText(draft.sponsor_public_summary, 220)
      : truncatePublicationText(draft.body, 220);
    const website = draft.sponsor_website_url
      ? ` (${draft.sponsor_website_url})`
      : '';

    return `- ${draft.sponsor_company_name}${website}: ${summary}`;
  });

  return {
    title: truncatePublicationText(
      `Merci aux commanditaires du Fonds des batisseurs ${audience}`,
      160
    ),
    body: truncatePublicationText(
      [
        `${audience} remercie ces organisations pour leur soutien au Fonds des batisseurs.`,
        sponsorLines.join('\n'),
        `Publication collective ${batch.channel === 'linkedin' ? 'LinkedIn' : 'Facebook'} preparee depuis le cockpit admin.`
      ].join('\n\n'),
      2500
    ),
    disclosureText: defaultDisclosureText,
    draftIds: drafts.map((draft) => draft.id)
  };
};

const listDraftsForPublicationBatch = async (
  pool: Pool,
  batchId: string
): Promise<readonly AdminPublicationDraftRecord[]> => {
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
      WHERE draft.batch_id = $1::uuid
        AND draft.status IN ('approved', 'scheduled')
      ORDER BY draft.created_at ASC
    `,
    [batchId]
  );

  return query.rows.map(mapPublicationDraftRow);
};

export const createSocialPublicationJobForBatch = async (
  pool: Pool | null,
  input: {
    readonly batchId: string;
    readonly mode: Exclude<SocialPublicationMode, 'disabled'>;
    readonly provider: 'facebook' | 'linkedin';
  }
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const presence = await getAdminBackofficePresence(pool);
  if (
    !presence.has_publication_drafts ||
    !presence.has_publication_batches ||
    !presence.has_social_publication_jobs
  ) {
    return null;
  }

  const batch = await getPublicationBatchById(pool, input.batchId);
  if (!batch || batch.status !== 'scheduled' || batch.capacityUsed <= 0) {
    return null;
  }

  const drafts = await listDraftsForPublicationBatch(pool, input.batchId);
  if (drafts.length === 0) {
    return null;
  }

  const text = buildSocialPublicationText(batch, drafts);
  const idempotencyKey = `social-publication-batch:${batch.id}:${batch.channel}`;
  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO social_publication_jobs (
        batch_id,
        channel,
        provider,
        mode,
        status,
        idempotency_key,
        title,
        body,
        disclosure_text,
        draft_ids
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        'pending',
        $5,
        $6,
        $7,
        $8,
        $9::uuid[]
      )
      ON CONFLICT (idempotency_key)
      DO UPDATE SET
        provider = EXCLUDED.provider,
        mode = EXCLUDED.mode,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        disclosure_text = EXCLUDED.disclosure_text,
        draft_ids = EXCLUDED.draft_ids,
        status = CASE
          WHEN social_publication_jobs.status = 'failed' THEN 'pending'
          ELSE social_publication_jobs.status
        END,
        error_code = CASE
          WHEN social_publication_jobs.status = 'failed' THEN NULL
          ELSE social_publication_jobs.error_code
        END,
        error_message = CASE
          WHEN social_publication_jobs.status = 'failed' THEN NULL
          ELSE social_publication_jobs.error_message
        END,
        updated_at = NOW()
      RETURNING id::text AS id
    `,
    [
      batch.id,
      batch.channel,
      input.provider,
      input.mode,
      idempotencyKey,
      text.title,
      text.body,
      text.disclosureText,
      text.draftIds
    ]
  );

  const jobId = insertResult.rows[0]?.id;
  return jobId ? getSocialPublicationJobById(pool, jobId) : null;
};

export const markSocialPublicationJobPublishing = async (
  pool: Pool | null,
  jobId: string
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      UPDATE social_publication_jobs
      SET
        status = 'publishing',
        attempted_at = NOW(),
        error_code = NULL,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND status IN ('pending', 'failed')
      RETURNING id::text AS id
    `,
    [jobId]
  );
  const updatedJobId = result.rows[0]?.id;
  return updatedJobId ? getSocialPublicationJobById(pool, updatedJobId) : null;
};

export const markSocialPublicationJobPublished = async (
  pool: Pool | null,
  input: {
    readonly jobId: string;
    readonly externalPostId: string;
    readonly externalPostUrl: string | null;
  }
): Promise<AdminSocialPublicationBatchPublishResult> => {
  if (!pool) {
    return { published: false, mode: 'disabled', job: null, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const jobResult = await client.query<SocialPublicationJobRow>(
      `
        UPDATE social_publication_jobs
        SET
          status = 'published',
          external_post_id = $2,
          external_post_url = $3,
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
          id::text AS id,
          batch_id::text AS batch_id,
          channel,
          provider,
          mode,
          status,
          idempotency_key,
          title,
          body,
          disclosure_text,
          array(SELECT draft_id::text FROM unnest(draft_ids) AS draft_id) AS draft_ids,
          external_post_id,
          external_post_url,
          error_code,
          error_message,
          attempted_at::text AS attempted_at,
          published_at::text AS published_at,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [input.jobId, input.externalPostId, input.externalPostUrl]
    );
    const job = jobResult.rows[0]
      ? mapSocialPublicationJobRow(jobResult.rows[0])
      : null;

    if (job) {
      await client.query(
        `
          UPDATE sponsor_publication_batches
          SET
            status = 'published',
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'scheduled'
        `,
        [job.batchId]
      );
      await client.query(
        `
          UPDATE sponsor_publication_drafts
          SET
            status = 'published',
            public_url = COALESCE($2, public_url),
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE batch_id = $1::uuid
            AND status IN ('approved', 'scheduled')
        `,
        [job.batchId, input.externalPostUrl]
      );
      if (presence.has_publication_slots) {
        await client.query(
          `
            UPDATE publication_slots slot
            SET status = 'published', updated_at = NOW()
            WHERE slot.id IN (
                SELECT slot_id
                FROM sponsor_publication_batches
                WHERE id = $1::uuid
                  AND slot_id IS NOT NULL
              )
              AND EXISTS (
                SELECT 1
                FROM sponsor_publication_drafts draft
                LEFT JOIN sponsor_publication_batches batch
                  ON batch.id = draft.batch_id
                WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                  AND draft.status = 'published'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM sponsor_publication_drafts draft
                LEFT JOIN sponsor_publication_batches batch
                  ON batch.id = draft.batch_id
                WHERE (draft.slot_id = slot.id OR batch.slot_id = slot.id)
                  AND draft.status <> 'published'
              )
          `,
          [job.batchId]
        );
      }
    }

    await client.query('COMMIT');

    return {
      published: Boolean(job),
      mode: job?.mode ?? 'disabled',
      job,
      batch: job ? await getPublicationBatchById(pool, job.batchId) : null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const markSocialPublicationJobFailed = async (
  pool: Pool | null,
  input: {
    readonly jobId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
  }
): Promise<AdminSocialPublicationJobRecord | null> => {
  if (!pool) {
    return null;
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      UPDATE social_publication_jobs
      SET
        status = 'failed',
        error_code = $2,
        error_message = $3,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id::text AS id
    `,
    [
      input.jobId,
      truncatePublicationText(input.errorCode, 160),
      truncatePublicationText(input.errorMessage, 1000)
    ]
  );
  const jobId = result.rows[0]?.id;
  return jobId ? getSocialPublicationJobById(pool, jobId) : null;
};
