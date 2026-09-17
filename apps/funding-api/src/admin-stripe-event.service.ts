import type { AdminStripeEventResponse } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { readSnapshot } from './admin-cockpit/read.js';

export const validStripeEventId = (value: string): boolean =>
  /^evt_[a-zA-Z0-9_]{1,196}$/.test(value);

export const getAdminStripeEvent = async (
  pool: Pool | null,
  id: string
): Promise<AdminStripeEventResponse> => {
  if (!validStripeEventId(id)) throw new Error('Invalid event identifier');
  if (!pool) return { available: false, event: null };
  return readSnapshot(pool, async (client) => {
    const presence = await client.query(
      "SELECT to_regclass('stripe_events') IS NOT NULL AS present"
    );
    if (!presence.rows[0]?.present) return { available: false, event: null };
    const result = await client.query(
      `SELECT stripe_event_id, event_type, processing_status, received_at, processed_at
       FROM stripe_events WHERE stripe_event_id = $1 LIMIT 1`,
      [id]
    );
    const row = result.rows[0];
    return {
      available: true,
      event: row
        ? {
            id: row.stripe_event_id,
            type: row.event_type,
            status: row.processing_status,
            receivedAt: new Date(row.received_at).toISOString(),
            processedAt: row.processed_at
              ? new Date(row.processed_at).toISOString()
              : null,
            error:
              row.processing_status === 'failed' ? 'processing_failed' : null
          }
        : null
    };
  });
};
