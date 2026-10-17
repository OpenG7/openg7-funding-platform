import type { Pool } from 'pg';

import type {
  AttentionDataset,
  PublicationSlotExecution
} from './contracts.js';

/** Read only the managed attempts that prohibit proposing a replacement slot. */
export async function loadPublicationSlotExecutions(
  pool: Pool | null
): Promise<readonly PublicationSlotExecution[]> {
  if (!pool) return [];
  const presence = await pool.query<{ available: boolean }>(`SELECT
    to_regclass('public.publication_deliveries') IS NOT NULL AND
    to_regclass('public.sponsor_publication_batches') IS NOT NULL AS available`);
  if (!presence.rows[0]?.available) return [];
  return (
    await pool.query<PublicationSlotExecution>(`SELECT b.slot_id::text AS "slotId",
      d.id::text AS "deliveryId",d.status
      FROM publication_deliveries d JOIN sponsor_publication_batches b ON b.id=d.batch_id
      WHERE b.slot_id IS NOT NULL AND d.status IN ('approved','publishing','uncertain')
      ORDER BY CASE d.status WHEN 'uncertain' THEN 0 WHEN 'publishing' THEN 1 ELSE 2 END,d.id`)
  ).rows;
}

/** Uncertainty takes priority when several deliveries share the same slot. */
export function publicationSlotExecution(
  dataset: Pick<AttentionDataset, 'publicationSlotExecutions'>,
  slotId: string
): PublicationSlotExecution | undefined {
  const matching = (dataset.publicationSlotExecutions ?? []).filter(
    (execution) => execution.slotId === slotId
  );
  return (
    matching.find((execution) => execution.status === 'uncertain') ??
    matching.find((execution) => execution.status === 'publishing') ??
    matching[0]
  );
}
