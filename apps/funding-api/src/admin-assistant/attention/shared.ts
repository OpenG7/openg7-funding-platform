import type { AdminAttentionSeverity } from '@openg7/funding-core';

export const ADMIN_URLS = {
  publications: '/admin/fundraiser/publications',
  emailQueue: '/admin/fundraiser/email-queue',
  transparency: '/admin/fundraiser/transparency'
} as const;

export const SEVERITY_RANK: Record<AdminAttentionSeverity, number> = {
  urgent: 0,
  today: 1,
  this_week: 2,
  informational: 3
};

/** Default cap on the number of items materialised in a response. Counts are
 * always computed over the full detected set BEFORE this cap is applied. */
export const DEFAULT_MAX_ATTENTION_ITEMS = 100;

export const severityForAge = (
  ageDays: number | null,
  urgentAfter: number,
  todayAfter: number
): AdminAttentionSeverity => {
  if (ageDays === null) {
    return 'this_week';
  }
  if (ageDays >= urgentAfter) {
    return 'urgent';
  }
  if (ageDays >= todayAfter) {
    return 'today';
  }
  return 'this_week';
};
