import type { AdminAttentionItemType } from '@openg7/funding-core';

export { WORK_QUEUE_PRIORITIES } from '../../../../packages/funding-core/src/index.js';

export const WORK_QUEUE_TYPES: readonly AdminAttentionItemType[] = [
  'sponsorship_needs_info',
  'sponsorship_needs_review',
  'publication_needs_preparation',
  'publication_late',
  'email_delivery_failed',
  'financial_data_warning',
  'invoice_missing',
  'stripe_event_failed',
  'stripe_event_stalled',
  'publication_ready',
  'publication_slot_upcoming'
];
export const STRIPE_STALLED_AFTER_MS = 15 * 60 * 1000;
export const DAY = 86400000;
export const PUBLICATIONS = '/admin/fundraiser/publications';

export interface QueueInvoiceCandidate {
  readonly id: string;
  readonly reference: string | null;
  readonly paid_at: string | null;
}
export interface QueueStripeEvent {
  readonly id: string;
  readonly event_type: string;
  readonly status: string;
  readonly received_at: string;
}

export const localDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));

export type SponsorshipSelection =
  | { readonly status: 'selected'; readonly sponsorshipId: string }
  | { readonly status: 'unavailable' | 'empty' };
