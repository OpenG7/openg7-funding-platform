import type {
  AdminPublicationSlotAssignBatchRequest,
  AdminPublicationSlotAssignDraftRequest,
  AdminPublicationSlotCreateRequest,
  AdminPublicationSlotLifecycleRequest,
  AdminPublicationSlotMutationResult,
  AdminPublicationSlotRecord,
  AdminPublicationSlotsResponse,
  AdminPublicationSlotUpdateRequest,
  PublicationSlotStatus,
  PublicSponsorshipBatchAvailability,
  PublicSponsorshipBatchAvailabilityResponse,
  PublicSponsorshipPublicationSlot,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { getAdminBackofficePresence } from './fund-admin.persistence.js';
import {
  mapPublicationSlotRow,
  type PublicationSlotRow
} from './fund-publication.mapping.js';

export const allowedPublicationSlotStatuses = new Set<PublicationSlotStatus>([
  'open',
  'scheduled',
  'published',
  'cancelled'
]);

const publicationSlotSelect = `
  SELECT
    slot.id::text AS id,
    slot.feed_target,
    slot.channel,
    slot.starts_at::text AS starts_at,
    slot.timezone,
    slot.capacity::text AS capacity,
    slot.status,
    slot.notes,
    COALESCE(
      array_agg(DISTINCT batch.id::text) FILTER (WHERE batch.id IS NOT NULL),
      ARRAY[]::text[]
    ) AS assigned_batch_ids,
    COALESCE(
      array_agg(DISTINCT draft.id::text) FILTER (WHERE draft.id IS NOT NULL),
      ARRAY[]::text[]
    ) AS assigned_draft_ids,
    COUNT(DISTINCT draft.id)::text AS capacity_used,
    slot.created_at::text AS created_at,
    slot.updated_at::text AS updated_at
  FROM publication_slots slot
  LEFT JOIN sponsor_publication_batches batch ON batch.slot_id = slot.id
  LEFT JOIN sponsor_publication_drafts draft
    ON draft.slot_id = slot.id OR draft.batch_id = batch.id
`;

const getPublicationSlotById = async (
  pool: Pool | null,
  slotId: string
): Promise<AdminPublicationSlotRecord | null> => {
  if (!pool) {
    return null;
  }

  const query = await pool.query<PublicationSlotRow>(
    `
      ${publicationSlotSelect}
      WHERE slot.id = $1::uuid
      GROUP BY slot.id
      LIMIT 1
    `,
    [slotId]
  );

  const row = query.rows[0];
  return row ? mapPublicationSlotRow(row) : null;
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
    return { data_source: 'empty', availability: [], slots: [] };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { data_source: 'empty', availability: [], slots: [] };
  }

  if (presence.has_publication_slots) {
    const query = await pool.query<{
      readonly feed_target: SponsorFeedTarget;
      readonly channel: SponsorFeedChannel;
      readonly starts_at: string;
      readonly timezone: string;
    }>(`
      SELECT
        feed_target,
        channel,
        starts_at::text AS starts_at,
        timezone
      FROM publication_slots
      WHERE status = 'scheduled'
        AND starts_at > NOW()
      ORDER BY starts_at ASC
      LIMIT 20
    `);

    const slots: readonly PublicSponsorshipPublicationSlot[] = query.rows.map(
      (row) => ({
        feedTarget: row.feed_target,
        channel: row.channel,
        startsAt: row.starts_at,
        timezone: row.timezone
      })
    );

    const nextAvailableByChannel = new Map<SponsorFeedChannel, string>();
    for (const slot of slots) {
      if (!nextAvailableByChannel.has(slot.channel)) {
        nextAvailableByChannel.set(slot.channel, slot.startsAt);
      }
    }

    const availability: readonly PublicSponsorshipBatchAvailability[] =
      publicSponsorshipBatchChannels.map((channel) => ({
        channel,
        nextAvailableAt: nextAvailableByChannel.get(channel) ?? null
      }));

    return { data_source: 'database', availability, slots };
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

  return { data_source: 'database', availability, slots: [] };
};

export const listAdminPublicationSlots = async (
  pool: Pool | null,
  options: { readonly all?: boolean; readonly id?: string } = {}
): Promise<AdminPublicationSlotsResponse> => {
  const now = new Date().toISOString();
  if (!pool) {
    return { data_source: 'database', slots: [], last_updated_at: now };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots) {
    return { data_source: 'database', slots: [], last_updated_at: now };
  }

  const query = await pool.query<PublicationSlotRow>(
    `
    ${publicationSlotSelect}
    WHERE ($1::text IS NULL OR slot.id::text = $1)
    GROUP BY slot.id
    ORDER BY
      CASE slot.status
        WHEN 'scheduled' THEN 0
        WHEN 'open' THEN 1
        WHEN 'published' THEN 2
        ELSE 3
      END,
      slot.starts_at ASC
    LIMIT $2
  `,
    [options.id ?? null, options.all ? null : 100]
  );

  return {
    data_source: 'database',
    slots: query.rows.map(mapPublicationSlotRow),
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

export const createAdminPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotCreateRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots) {
    return { updated: false, slot: null };
  }

  const insertResult = await pool.query<{ readonly id: string }>(
    `
      INSERT INTO publication_slots (
        feed_target,
        channel,
        starts_at,
        timezone,
        capacity,
        status,
        notes
      )
      SELECT $1, $2, $3::timestamptz, $4, $5, 'scheduled', NULLIF($6, '')
      WHERE $3::timestamptz > NOW()
      RETURNING id::text AS id
    `,
    [
      input.feedTarget,
      input.channel,
      input.startsAt,
      input.timezone?.trim() || 'America/Toronto',
      input.capacity,
      input.notes?.trim() ?? ''
    ]
  );

  const slotId = insertResult.rows[0]?.id;
  return {
    updated: Boolean(slotId),
    slot: slotId ? await getPublicationSlotById(pool, slotId) : null
  };
};

export const updateAdminPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotUpdateRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots) {
    return { updated: false, slot: null };
  }

  const notesTouched = input.notes !== undefined;
  const result = await pool.query<{ readonly id: string }>(
    `
      WITH slot_usage AS (
        SELECT
          slot.id,
          COUNT(DISTINCT draft.id)::integer AS capacity_used
        FROM publication_slots slot
        LEFT JOIN sponsor_publication_batches batch ON batch.slot_id = slot.id
        LEFT JOIN sponsor_publication_drafts draft
          ON draft.slot_id = slot.id OR draft.batch_id = batch.id
        WHERE slot.id = $1::uuid
        GROUP BY slot.id
      )
      UPDATE publication_slots slot
      SET
        starts_at = COALESCE($2::timestamptz, slot.starts_at),
        timezone = COALESCE(NULLIF($3, ''), slot.timezone),
        capacity = COALESCE($4::integer, slot.capacity),
        notes = CASE
          WHEN $5::boolean THEN NULLIF($6, '')
          ELSE slot.notes
        END,
        status = CASE
          WHEN slot.status = 'open' THEN 'scheduled'
          ELSE slot.status
        END,
        updated_at = NOW()
      FROM slot_usage
      WHERE slot.id = slot_usage.id
        AND slot.id = $1::uuid
        AND slot.status IN ('open', 'scheduled')
        AND COALESCE($2::timestamptz, slot.starts_at) > NOW()
        AND COALESCE($4::integer, slot.capacity) >= slot_usage.capacity_used
      RETURNING slot.id::text AS id
    `,
    [
      input.slotId,
      input.startsAt ?? null,
      input.timezone?.trim() ?? null,
      input.capacity ?? null,
      notesTouched,
      input.notes?.trim() ?? ''
    ]
  );

  const slotId = result.rows[0]?.id;
  if (slotId) {
    await pool.query(
      `
        UPDATE sponsor_publication_batches batch
        SET
          scheduled_at = slot.starts_at,
          status = CASE
            WHEN batch.status = 'open' THEN 'scheduled'
            ELSE batch.status
          END,
          updated_at = NOW()
        FROM publication_slots slot
        WHERE batch.slot_id = slot.id
          AND slot.id = $1::uuid
          AND batch.status IN ('open', 'scheduled')
      `,
      [slotId]
    );
    await pool.query(
      `
        UPDATE sponsor_publication_drafts draft
        SET
          scheduled_at = slot.starts_at,
          status = CASE
            WHEN draft.status = 'approved' THEN 'scheduled'
            ELSE draft.status
          END,
          updated_at = NOW()
        FROM publication_slots slot
        WHERE draft.slot_id = slot.id
          AND slot.id = $1::uuid
          AND draft.status IN ('approved', 'scheduled')
      `,
      [slotId]
    );
  }

  return {
    updated: Boolean(slotId),
    slot: await getPublicationSlotById(pool, input.slotId)
  };
};

export const assignBatchToPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotAssignBatchRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots || !presence.has_publication_batches) {
    return { updated: false, slot: null };
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      WITH target_slot AS (
        SELECT
          slot.id,
          slot.feed_target,
          slot.channel,
          slot.starts_at,
          slot.capacity,
          (
            SELECT COUNT(DISTINCT used_draft.id)::integer
            FROM sponsor_publication_drafts used_draft
            LEFT JOIN sponsor_publication_batches used_batch
              ON used_batch.id = used_draft.batch_id
            WHERE used_draft.slot_id = slot.id
              OR used_batch.slot_id = slot.id
          ) AS used
        FROM publication_slots slot
        WHERE slot.id = $1::uuid
          AND slot.status IN ('open', 'scheduled')
          AND slot.starts_at > NOW()
      ),
      target_batch AS (
        SELECT
          batch.id,
          batch.channel,
          batch.status,
          batch.slot_id,
          COUNT(draft.id)::integer AS draft_count,
          COALESCE(BOOL_AND(draft.feed_target = target_slot.feed_target), TRUE)
            AS drafts_match_target
        FROM sponsor_publication_batches batch
        CROSS JOIN target_slot
        LEFT JOIN sponsor_publication_drafts draft ON draft.batch_id = batch.id
        WHERE batch.id = $2::uuid
        GROUP BY batch.id, target_slot.feed_target
      )
      UPDATE sponsor_publication_batches batch
      SET
        slot_id = target_slot.id,
        status = 'scheduled',
        scheduled_at = target_slot.starts_at,
        updated_at = NOW()
      FROM target_slot, target_batch
      WHERE batch.id = target_batch.id
        AND target_batch.channel = target_slot.channel
        AND target_batch.status IN ('open', 'scheduled')
        AND (target_batch.slot_id IS NULL OR target_batch.slot_id = target_slot.id)
        AND target_batch.drafts_match_target
        AND target_slot.used + CASE
          WHEN target_batch.slot_id = target_slot.id THEN 0
          ELSE target_batch.draft_count
        END <= target_slot.capacity
      RETURNING batch.slot_id::text AS id
    `,
    [input.slotId, input.batchId]
  );

  const slotId = result.rows[0]?.id;
  if (slotId) {
    await pool.query(
      `
        UPDATE sponsor_publication_drafts draft
        SET
          slot_id = $1::uuid,
          status = 'scheduled',
          scheduled_at = slot.starts_at,
          updated_at = NOW()
        FROM publication_slots slot
        WHERE draft.batch_id = $2::uuid
          AND slot.id = $1::uuid
          AND draft.status IN ('approved', 'scheduled')
      `,
      [slotId, input.batchId]
    );
  }

  return {
    updated: Boolean(slotId),
    slot: await getPublicationSlotById(pool, input.slotId)
  };
};

export const assignDraftToPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotAssignDraftRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots || !presence.has_publication_drafts) {
    return { updated: false, slot: null };
  }

  const result = await pool.query<{ readonly id: string }>(
    `
      WITH target_slot AS (
        SELECT
          slot.id,
          slot.feed_target,
          slot.channel,
          slot.starts_at,
          slot.capacity,
          (
            SELECT COUNT(DISTINCT used_draft.id)::integer
            FROM sponsor_publication_drafts used_draft
            LEFT JOIN sponsor_publication_batches used_batch
              ON used_batch.id = used_draft.batch_id
            WHERE used_draft.slot_id = slot.id
              OR used_batch.slot_id = slot.id
          ) AS used
        FROM publication_slots slot
        WHERE slot.id = $1::uuid
          AND slot.status IN ('open', 'scheduled')
          AND slot.starts_at > NOW()
      )
      UPDATE sponsor_publication_drafts draft
      SET
        slot_id = target_slot.id,
        status = 'scheduled',
        scheduled_at = target_slot.starts_at,
        updated_at = NOW()
      FROM target_slot
      WHERE draft.id = $2::uuid
        AND draft.batch_id IS NULL
        AND draft.status IN ('approved', 'scheduled')
        AND draft.channel = target_slot.channel
        AND draft.feed_target = target_slot.feed_target
        AND (draft.slot_id IS NULL OR draft.slot_id = target_slot.id)
        AND target_slot.used + CASE
          WHEN draft.slot_id = target_slot.id THEN 0
          ELSE 1
        END <= target_slot.capacity
      RETURNING draft.slot_id::text AS id
    `,
    [input.slotId, input.draftId]
  );

  const slotId = result.rows[0]?.id;
  return {
    updated: Boolean(slotId),
    slot: await getPublicationSlotById(pool, input.slotId)
  };
};

export const publishAdminPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotLifecycleRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots) {
    return { updated: false, slot: null };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<{ readonly id: string }>(
      `
        WITH target_slot AS (
          SELECT
            slot.id,
            COUNT(DISTINCT draft.id)::integer AS capacity_used
          FROM publication_slots slot
          LEFT JOIN sponsor_publication_batches batch ON batch.slot_id = slot.id
          LEFT JOIN sponsor_publication_drafts draft
            ON draft.slot_id = slot.id OR draft.batch_id = batch.id
          WHERE slot.id = $1::uuid
            AND slot.status = 'scheduled'
          GROUP BY slot.id
        )
        UPDATE publication_slots slot
        SET status = 'published', updated_at = NOW()
        FROM target_slot
        WHERE slot.id = target_slot.id
          AND target_slot.capacity_used > 0
        RETURNING slot.id::text AS id
      `,
      [input.slotId]
    );

    const slotId = result.rows[0]?.id;
    if (slotId) {
      await client.query(
        `
          UPDATE sponsor_publication_batches
          SET
            status = 'published',
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE slot_id = $1::uuid
            AND status = 'scheduled'
        `,
        [slotId]
      );
      await client.query(
        `
          UPDATE sponsor_publication_drafts
          SET
            status = 'published',
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
          WHERE (
              slot_id = $1::uuid
              OR batch_id IN (
                SELECT id FROM sponsor_publication_batches
                WHERE slot_id = $1::uuid
              )
            )
            AND status IN ('approved', 'scheduled')
        `,
        [slotId]
      );
    }

    await client.query('COMMIT');

    return {
      updated: Boolean(slotId),
      slot: await getPublicationSlotById(pool, input.slotId)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const cancelAdminPublicationSlot = async (
  pool: Pool | null,
  input: AdminPublicationSlotLifecycleRequest
): Promise<AdminPublicationSlotMutationResult> => {
  if (!pool) {
    return { updated: false, slot: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_slots) {
    return { updated: false, slot: null };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<{ readonly id: string }>(
      `
        UPDATE publication_slots
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1::uuid
          AND status IN ('open', 'scheduled')
        RETURNING id::text AS id
      `,
      [input.slotId]
    );

    const slotId = result.rows[0]?.id;
    if (slotId) {
      await client.query(
        `
          UPDATE sponsor_publication_drafts
          SET
            slot_id = NULL,
            status = CASE WHEN status = 'scheduled' THEN 'approved' ELSE status END,
            scheduled_at = NULL,
            updated_at = NOW()
          WHERE slot_id = $1::uuid
            AND status <> 'published'
        `,
        [slotId]
      );
      await client.query(
        `
          UPDATE sponsor_publication_batches
          SET
            slot_id = NULL,
            status = CASE WHEN status = 'scheduled' THEN 'open' ELSE status END,
            scheduled_at = NULL,
            updated_at = NOW()
          WHERE slot_id = $1::uuid
            AND status <> 'published'
        `,
        [slotId]
      );
    }

    await client.query('COMMIT');

    return {
      updated: Boolean(slotId),
      slot: await getPublicationSlotById(pool, input.slotId)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
