import type { PoolClient } from 'pg';

import { releasePublicationObligations } from './sponsorship-fulfilment.repository.js';
import { releaseAccountReservation } from './publication-automation/account-reservations.js';
import { audit, type DeliveryRow } from './publication-automation/context.js';

type CalendarConnection = PoolClient;
const slotDeliveries = `FROM publication_deliveries delivery
  JOIN sponsor_publication_batches batch ON batch.id=delivery.batch_id
  WHERE batch.slot_id=$1::uuid AND delivery.status<>'cancelled'`;

/** Transaction client required. Deliveries precede slot, batch and source locks. */
export async function lockPublicationSlotDeliveries(
  db: CalendarConnection,
  slotId: string
): Promise<DeliveryRow[]> {
  return (
    await db.query<DeliveryRow>(
      `SELECT delivery.* ${slotDeliveries} ORDER BY delivery.id FOR UPDATE OF delivery`,
      [slotId]
    )
  ).rows;
}

/** Never acquire a newly associated delivery lock after holding the slot. */
export async function publicationSlotDeliveriesUnchanged(
  db: CalendarConnection,
  slotId: string,
  deliveries: readonly DeliveryRow[]
): Promise<boolean> {
  const current = (
    await db.query<{ id: string }>(
      `SELECT delivery.id ${slotDeliveries} ORDER BY delivery.id`,
      [slotId]
    )
  ).rows;
  return (
    current.length === deliveries.length &&
    current.every((row, index) => row.id === deliveries[index]!.id)
  );
}

export async function canRescheduleSlotDeliveries(
  db: CalendarConnection,
  deliveries: readonly DeliveryRow[]
): Promise<boolean> {
  if (
    deliveries.some(
      (row) => !['draft', 'approved', 'blocked'].includes(row.status)
    )
  )
    return false;
  if (!deliveries.length) return true;
  return !(
    await db.query(
      `SELECT 1 FROM publication_account_leases WHERE delivery_id=ANY($1::uuid[])
       UNION ALL SELECT 1 FROM publication_account_reservations
       WHERE delivery_id=ANY($1::uuid[]) AND status IN ('publishing','uncertain','published') LIMIT 1`,
      [deliveries.map((row) => row.id)]
    )
  ).rowCount;
}

/** Date changes revoke authority but preserve source, media and commercial terms. */
export async function rescheduleSlotDeliveries(
  db: CalendarConnection,
  slotId: string,
  deliveries: readonly DeliveryRow[],
  scheduledAt: Date,
  actor: string
): Promise<void> {
  const reserved = new Set(
    (
      await db.query<{ delivery_id: string }>(
        'SELECT delivery_id FROM publication_account_reservations WHERE delivery_id=ANY($1::uuid[])',
        [deliveries.map((row) => row.id)]
      )
    ).rows.map((row) => row.delivery_id)
  );
  for (const row of deliveries) {
    if (reserved.has(row.id)) await releaseAccountReservation(db, row);
    await releasePublicationObligations(db, row.id);
    await db.query(
      `UPDATE publication_deliveries SET scheduled_at=$2,status='draft',auto_managed=FALSE,
       approved_at=NULL,approved_by=NULL,lease_until=NULL,error_code=NULL,next_attempt_at=NULL,
       provider_media_id=NULL,version=version+1,updated_at=NOW() WHERE id=$1`,
      [row.id, scheduledAt]
    );
    await audit(db, actor, 'reschedule_calendar', row.id, {
      slotId,
      previousScheduledAt: row.scheduled_at.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      previousStatus: row.status,
      previousVersion: row.version
    });
  }
}
