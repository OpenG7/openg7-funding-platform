import type {
  AdminPublicationBatchAssignRequest,
  AdminPublicationBatchCreateRequest,
  AdminPublicationBatchLifecycleRequest,
  AdminPublicationBatchMutationResult,
  AdminPublicationBatchRecord,
  AdminPublicationBatchScheduleRequest,
  AdminPublicationBatchUnassignRequest,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftMutationResult,
  PublicationBatchStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  mapPublicationBatchRow,
  type PublicationBatchRow
} from './fund-publication.mapping.js';
import { getAdminBackofficePresence } from './fund-admin.persistence.js';
import { getPublicationDraftById } from './fund-publication-drafts.repository.js';
import { schedulePublicationBatch } from './fund-publication-batch-scheduling.persistence.js';
import { lockPublicationBatchCapacity } from './fund-publication-capacity.persistence.js';
import { publicationMembershipFits } from './fund-publication-rendering.persistence.js';
import { publicationDraftFormatSql } from './fund-publication-draft-obligations.persistence.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { ModerationError } from './moderation/policy.js';
import { assertModerationApproved } from './moderation/repository.js';

export const allowedPublicationBatchStatuses = new Set<PublicationBatchStatus>([
  'open',
  'scheduled',
  'published',
  'cancelled'
]);

const publicationBatchSelect = `
  SELECT
    batch.id::text AS id,
    batch.channel,
    batch.publication_format,
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
  pool: Pool | PoolClient | null,
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
 * locking the slot (when associated), then the batch before counting members.
 * The count is read after obtaining those locks on the same transaction client.
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

  const updated = await withPostgresTransaction(pool, async (client) => {
    if (!(await lockPublicationBatchCapacity(client, input.batchId))) {
      return false;
    }
    await client.query(
      'SELECT id FROM sponsor_publication_drafts WHERE id=$1::uuid FOR UPDATE',
      [input.draftId]
    );
    if (
      !(await publicationMembershipFits(client, {
        batchId: input.batchId,
        draftIds: [input.draftId]
      }))
    )
      return false;
    const result = await client.query(
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
        AND (draft.slot_id IS NULL OR draft.slot_id = target_batch.slot_id)
        AND draft.channel = target_batch.channel
        AND target_batch.status IN ('open', 'scheduled')
        AND target_batch.used < target_batch.capacity
        AND (
          target_batch.slot_id IS NULL
          OR (
            draft.feed_target = target_batch.slot_feed_target
            AND target_batch.slot_status IN ('open', 'scheduled')
            AND target_batch.slot_starts_at > clock_timestamp()
            AND target_batch.slot_used < target_batch.slot_capacity
          )
        )
    `,
      [input.draftId, input.batchId]
    );
    if (!result.rowCount) return false;
    await client.query(
      `UPDATE sponsor_publication_batches SET publication_format=COALESCE(publication_format,
      (SELECT ${publicationDraftFormatSql()} FROM sponsor_publication_drafts d WHERE d.id=$1::uuid AND d.batch_id=$2::uuid)) WHERE id=$2::uuid`,
      [input.draftId, input.batchId]
    );
    return true;
  });

  return {
    updated,
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
): Promise<
  AdminPublicationBatchMutationResult & {
    readonly code?: 'PUBLICATION_SLOT_SCHEDULE_REQUIRED';
  }
> => {
  return schedulePublicationBatch(pool, input, getPublicationBatchById);
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

  if (input.confirmation !== input.batchId)
    throw new ModerationError('CONFIRMATION_REQUIRED', 400);
  return withPostgresTransaction(
    pool,
    async (db) => {
      if (!(await lockPublicationBatchCapacity(db, input.batchId)))
        return { updated: false, batch: null };
      const current = (
        await db.query<{ status: PublicationBatchStatus }>(
          'SELECT status FROM sponsor_publication_batches WHERE id=$1',
          [input.batchId]
        )
      ).rows[0];
      if (current?.status !== 'scheduled')
        return {
          updated: false,
          batch: await getPublicationBatchById(db, input.batchId)
        };
      const drafts = await db.query<{ id: string; contribution_id: string }>(
        'SELECT id,contribution_id FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
        [input.batchId]
      );
      if (!drafts.rows.length)
        throw new ModerationError('MODERATION_CONTENT_REQUIRED');
      for (const draft of drafts.rows) {
        await assertModerationApproved(db, {
          type: 'sponsorship',
          id: draft.contribution_id
        });
        await assertModerationApproved(db, {
          type: 'publication_draft',
          id: draft.id
        });
      }
      const result = await db.query(
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
        await db.query(
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
          await db.query(
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
        batch: await getPublicationBatchById(db, input.batchId)
      };
    },
    { shouldCommit: (result) => result.updated }
  );
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
