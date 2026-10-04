import type {
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import type { SponsorshipSelection } from './admin-work-queue/contracts.js';
import { paginateWorkQueue } from './admin-work-queue/pagination.js';
import { loadAdminWorkQueue } from './admin-work-queue/repository.js';

export {
  WORK_QUEUE_TYPES,
  WORK_QUEUE_PRIORITIES,
  STRIPE_STALLED_AFTER_MS
} from './admin-work-queue/contracts.js';
export type {
  QueueInvoiceCandidate,
  QueueStripeEvent,
  SponsorshipSelection
} from './admin-work-queue/contracts.js';
export { parseWorkQueueQuery } from './admin-work-queue/query.js';
export { buildWorkQueueItems } from './admin-work-queue/projection.js';
export { paginateWorkQueue } from './admin-work-queue/pagination.js';
export { loadAdminWorkQueue } from './admin-work-queue/repository.js';

export const getAdminWorkQueue = async (
  pool: Pool | null,
  query: AdminWorkQueueQuery = {},
  now = new Date()
): Promise<AdminWorkQueueResponse> => {
  const snapshot = await loadAdminWorkQueue(pool, now);
  return paginateWorkQueue(snapshot.items, now, query, snapshot.missingSources);
};

/** Preserve explicit references; otherwise select from the complete operational queue. */
export const resolveSponsorshipSelection = async (
  pool: Pool | null,
  reference?: string,
  now = new Date()
): Promise<SponsorshipSelection> => {
  if (!pool) return { status: 'unavailable' };
  if (reference) return { status: 'selected', sponsorshipId: reference };
  const queue = await getAdminWorkQueue(pool, {}, now);
  if (!queue.available) return { status: 'unavailable' };
  return queue.firstSponsorshipId
    ? { status: 'selected', sponsorshipId: queue.firstSponsorshipId }
    : { status: 'empty' };
};
