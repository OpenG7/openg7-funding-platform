import type { AdminAttentionItem } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { loadAttentionDataset } from '../admin-assistant/attention.service.js';

import {
  STRIPE_STALLED_AFTER_MS,
  type QueueInvoiceCandidate,
  type QueueStripeEvent
} from './contracts.js';
import { buildWorkQueueItems } from './projection.js';

/** Shared deterministic projection; callers paginate after cross-domain deduplication. */
export const loadAdminWorkQueue = async (
  pool: Pool | null,
  now = new Date()
): Promise<{ items: AdminAttentionItem[]; missingSources: string[] }> => {
  if (!pool) return { items: [], missingSources: ['database'] };
  const required = [
    'fund_contributions',
    'stripe_events',
    'sponsorship_invoices',
    'sponsor_media_assets',
    'sponsor_publication_drafts',
    'sponsor_publication_batches',
    'publication_slots',
    'email_messages'
  ];
  const presence = await pool.query<{ name: string; present: boolean }>(
    "SELECT name, to_regclass('public.' || name) IS NOT NULL AS present FROM unnest($1::text[]) AS name",
    [required]
  );
  const missing = required.filter(
    (name) => !presence.rows.some((row) => row.name === name && row.present)
  );
  if (missing.length) return { items: [], missingSources: missing };
  const [dataset, invoices, events] = await Promise.all([
    loadAttentionDataset(pool, now, true),
    pool.query<QueueInvoiceCandidate>(`SELECT c.id::text AS id, c.public_reference AS reference, c.paid_at::text AS paid_at
      FROM fund_contributions c LEFT JOIN sponsorship_invoices i ON i.contribution_id = c.id
      WHERE c.contribution_type = 'sponsorship_interest' AND c.status IN ('paid', 'refunded', 'disputed')
        AND c.stripe_session_id IS NOT NULL AND i.id IS NULL`),
    pool.query<QueueStripeEvent>(
      `SELECT stripe_event_id AS id, event_type, processing_status AS status, received_at::text AS received_at
      FROM stripe_events WHERE processing_status = 'failed' OR (processing_status = 'processing' AND received_at <= $1::timestamptz)`,
      [new Date(now.getTime() - STRIPE_STALLED_AFTER_MS).toISOString()]
    )
  ]);
  return {
    items: buildWorkQueueItems(dataset, invoices.rows, events.rows),
    missingSources: []
  };
};
