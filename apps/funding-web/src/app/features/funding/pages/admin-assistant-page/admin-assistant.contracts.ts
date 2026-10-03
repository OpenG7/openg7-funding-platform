import type {
  AdminAttentionItemType,
  AdminAttentionSeverity
} from '@openg7/funding-core';

export type AssistantLoadState =
  'idle' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable';
export interface AssistantEmailGroupFilter {
  readonly template: string;
  readonly error: string;
}
export const ASSISTANT_TYPES: readonly AdminAttentionItemType[] = [
  'sponsorship_needs_info',
  'sponsorship_needs_review',
  'publication_needs_preparation',
  'publication_late',
  'publication_ready',
  'publication_slot_upcoming',
  'email_delivery_failed',
  'financial_data_warning',
  'invoice_missing',
  'stripe_event_failed',
  'stripe_event_stalled'
];
export const ASSISTANT_PRIORITIES: readonly AdminAttentionSeverity[] = [
  'urgent',
  'today',
  'this_week',
  'informational'
];
