import type {
  AdminPublicationBatchMutationResult,
  AdminPublicationBatchRecord,
  AdminPublicationBatchScheduleRequest,
  PublicationBatchStatus
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { getAdminBackofficePresence } from './fund-admin.persistence.js';
import { withPostgresTransaction } from './postgres-transaction.js';

/**
 * Keep scheduling, its locks and cascades in one transaction. Reuse the caller's
 * projection reader without importing its lifecycle repository.
 */
export const schedulePublicationBatch = async (
  pool: Pool | null,
  input: AdminPublicationBatchScheduleRequest,
  readBatch: (
    connection: Pool | PoolClient,
    batchId: string
  ) => Promise<AdminPublicationBatchRecord | null>
): Promise<
  AdminPublicationBatchMutationResult & {
    readonly code?: 'PUBLICATION_SLOT_SCHEDULE_REQUIRED';
  }
> => {
  if (!pool) {
    return { updated: false, batch: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_publication_batches) {
    return { updated: false, batch: null };
  }

  if (!Number.isFinite(Date.parse(input.scheduledAt))) {
    return {
      updated: false,
      batch: await readBatch(pool, input.batchId)
    };
  }

  return withPostgresTransaction(
    pool,
    async (client) => {
      const unchanged = () => readBatch(client, input.batchId);
      const candidate = (
        await client.query<{
          status: PublicationBatchStatus;
          slot_id: string | null;
          date_is_future: boolean;
        }>(
          `SELECT status,${presence.has_publication_slots ? 'slot_id' : 'NULL::uuid AS slot_id'},$2::timestamptz > clock_timestamp() AS date_is_future
           FROM sponsor_publication_batches WHERE id=$1::uuid`,
          [input.batchId, input.scheduledAt]
        )
      ).rows[0];
      if (
        !candidate ||
        !['open', 'scheduled'].includes(candidate.status) ||
        !candidate.date_is_future
      )
        return { updated: false, batch: await unchanged() };

      // Lock the slot before its member batch, in the same order as calendar
      // updates. Never acquire a different slot lock after locking the batch.
      const slot = candidate.slot_id
        ? (
            await client.query<{
              status: string;
              date_is_future: boolean;
              date_matches: boolean;
            }>(
              `SELECT status,starts_at > clock_timestamp() AS date_is_future,
                    starts_at=$2::timestamptz AS date_matches
             FROM publication_slots WHERE id=$1::uuid FOR SHARE`,
              [candidate.slot_id, input.scheduledAt]
            )
          ).rows[0]
        : null;
      const batch = (
        await client.query<{
          status: PublicationBatchStatus;
          slot_id: string | null;
          date_is_future: boolean;
        }>(
          `SELECT status,${presence.has_publication_slots ? 'slot_id' : 'NULL::uuid AS slot_id'},$2::timestamptz > clock_timestamp() AS date_is_future
           FROM sponsor_publication_batches WHERE id=$1::uuid FOR UPDATE`,
          [input.batchId, input.scheduledAt]
        )
      ).rows[0];
      if (
        !batch ||
        batch.slot_id !== candidate.slot_id ||
        !['open', 'scheduled'].includes(batch.status) ||
        !batch.date_is_future
      )
        return { updated: false, batch: await unchanged() };

      if (batch.slot_id) {
        if (
          !slot ||
          !['open', 'scheduled'].includes(slot.status) ||
          !slot.date_is_future
        )
          return { updated: false, batch: await unchanged() };
        if (!slot.date_matches)
          return {
            updated: false,
            batch: await unchanged(),
            code: 'PUBLICATION_SLOT_SCHEDULE_REQUIRED' as const
          };
      }

      const result = await client.query(
        `UPDATE sponsor_publication_batches
         SET status='scheduled',scheduled_at=$2::timestamptz,updated_at=NOW()
         WHERE id=$1::uuid AND status IN ('open','scheduled')
           AND $2::timestamptz > clock_timestamp()`,
        [input.batchId, input.scheduledAt]
      );
      if ((result.rowCount ?? 0) === 0)
        return { updated: false, batch: await unchanged() };
      await client.query(
        `UPDATE sponsor_publication_drafts draft
         SET status='scheduled',slot_id=batch.slot_id,scheduled_at=$2::timestamptz,updated_at=NOW()
         FROM sponsor_publication_batches batch
         WHERE draft.batch_id=batch.id AND batch.id=$1::uuid
           AND draft.status IN ('approved','scheduled')`,
        [input.batchId, input.scheduledAt]
      );
      return { updated: true, batch: await unchanged() };
    },
    { shouldCommit: (result) => result.updated }
  );
};
