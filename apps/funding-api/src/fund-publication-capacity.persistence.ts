import type { PoolClient } from 'pg';

type PublicationCapacityConnection = Pick<PoolClient, 'query'>;

/**
 * Call with a transaction client: these locks must outlive the individual query.
 * Capacity is shared by child rows, so lock the parent before counting.
 */
export const lockPublicationSlotCapacity = async (
  client: PublicationCapacityConnection,
  slotId: string
): Promise<boolean> => {
  const result = await client.query<{ readonly id: string }>(
    'SELECT id::text AS id FROM publication_slots WHERE id=$1::uuid FOR UPDATE',
    [slotId]
  );
  return Boolean(result.rows[0]);
};

export const lockPublicationBatchCapacity = async (
  client: PublicationCapacityConnection,
  batchId: string
): Promise<boolean> => {
  // Read the association first, then follow the common slot -> batch -> drafts
  // order. A concurrent association change is a failed reservation, never a
  // reason to acquire another slot lock after the batch lock.
  const observed = (
    await client.query<{ readonly slot_id: string | null }>(
      'SELECT slot_id::text AS slot_id FROM sponsor_publication_batches WHERE id=$1::uuid',
      [batchId]
    )
  ).rows[0];
  if (!observed) return false;
  if (
    observed.slot_id &&
    !(await lockPublicationSlotCapacity(client, observed.slot_id))
  ) {
    return false;
  }
  const locked = (
    await client.query<{ readonly slot_id: string | null }>(
      'SELECT slot_id::text AS slot_id FROM sponsor_publication_batches WHERE id=$1::uuid FOR UPDATE',
      [batchId]
    )
  ).rows[0];
  return Boolean(locked && locked.slot_id === observed.slot_id);
};

export const lockPublicationSlotMembers = async (
  client: PublicationCapacityConnection,
  slotId: string
): Promise<void> => {
  await client.query(
    `SELECT id FROM sponsor_publication_batches
     WHERE slot_id=$1::uuid ORDER BY id FOR UPDATE`,
    [slotId]
  );
  await client.query(
    `SELECT id FROM sponsor_publication_drafts
     WHERE slot_id=$1::uuid OR batch_id IN (
       SELECT id FROM sponsor_publication_batches WHERE slot_id=$1::uuid
     ) ORDER BY id FOR UPDATE`,
    [slotId]
  );
};
