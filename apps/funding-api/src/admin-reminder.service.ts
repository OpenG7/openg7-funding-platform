import type { Pool } from 'pg';

import {
  hasCompleteFiche,
  isActionableSponsorship,
  sponsorshipRef
} from './admin-assistant/attention.service.js';
import {
  queueSponsorshipReviewReminderNotification,
  type SponsorshipReviewReminderEmailItem
} from './email-notification.service.js';
import {
  listSponsorshipsForAttention,
  type SponsorshipAttentionRecord
} from './fund-contributions.repository.js';
import { loadTransactionalEmailConfig } from './services/email/index.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_REVIEW_REMINDER_ENABLED = true;
const DEFAULT_REVIEW_REMINDER_MIN_AGE_DAYS = 1;
const DEFAULT_REVIEW_REMINDER_POLL_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_REVIEW_REMINDER_MAX_ITEMS = 5;
const DEFAULT_REVIEW_REMINDER_ADMIN_URL = '/admin/fundraiser/sponsors';

export interface AdminSponsorshipReviewReminderConfig {
  readonly enabled: boolean;
  readonly minAgeDays: number;
  readonly pollIntervalMs: number;
  readonly maxItems: number;
}

export interface SponsorshipReviewReminderCandidate {
  readonly totalCount: number;
  readonly urgentCount: number;
  readonly oldestDaysWaiting: number | null;
  readonly items: readonly SponsorshipReviewReminderEmailItem[];
}

export type AdminSponsorshipReviewReminderSkippedReason =
  | 'disabled'
  | 'smtp_disabled'
  | 'database_unavailable'
  | 'recipient_not_configured'
  | 'nothing_due';

export interface AdminSponsorshipReviewReminderResult {
  readonly checked: boolean;
  readonly skippedReason: AdminSponsorshipReviewReminderSkippedReason | null;
  readonly dueCount: number;
  readonly queued: boolean;
  readonly duplicate: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
}

const parseBooleanEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parsePositiveIntegerEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeIntegerEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const emptyResult = (
  skippedReason: AdminSponsorshipReviewReminderSkippedReason,
  dueCount = 0,
  checked = false
): AdminSponsorshipReviewReminderResult => ({
  checked,
  skippedReason,
  dueCount,
  queued: false,
  duplicate: false,
  attempted: false,
  sent: false,
  messageId: null,
  error: null
});

const daysBetween = (later: Date, earlierIso: string | null): number | null => {
  if (!earlierIso) {
    return null;
  }

  const earlier = Date.parse(earlierIso);
  if (Number.isNaN(earlier)) {
    return null;
  }

  return Math.floor((later.getTime() - earlier) / MS_PER_DAY);
};

const compareReminderItems = (
  first: SponsorshipReviewReminderEmailItem,
  second: SponsorshipReviewReminderEmailItem
): number => {
  const firstDays = first.daysWaiting ?? -1;
  const secondDays = second.daysWaiting ?? -1;
  if (firstDays !== secondDays) {
    return secondDays - firstDays;
  }

  return (first.detailsSubmittedAt ?? '').localeCompare(
    second.detailsSubmittedAt ?? ''
  );
};

export const loadAdminSponsorshipReviewReminderConfig = (
  env: NodeJS.ProcessEnv = process.env
): AdminSponsorshipReviewReminderConfig => ({
  enabled: parseBooleanEnv(
    env,
    'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED',
    DEFAULT_REVIEW_REMINDER_ENABLED
  ),
  minAgeDays: parseNonNegativeIntegerEnv(
    env,
    'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS',
    DEFAULT_REVIEW_REMINDER_MIN_AGE_DAYS
  ),
  pollIntervalMs: parsePositiveIntegerEnv(
    env,
    'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS',
    DEFAULT_REVIEW_REMINDER_POLL_INTERVAL_MS
  ),
  maxItems: parsePositiveIntegerEnv(
    env,
    'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS',
    DEFAULT_REVIEW_REMINDER_MAX_ITEMS
  )
});

export const sponsorshipReviewReminderDateKey = (now: Date): string =>
  now.toISOString().slice(0, 10);

export const createSponsorshipReviewReminderIdempotencyKey = (
  now: Date
): string =>
  `admin-reminder:sponsorship-review:${sponsorshipReviewReminderDateKey(now)}`;

export const buildSponsorshipReviewReminderCandidate = (
  sponsorships: readonly SponsorshipAttentionRecord[],
  now: Date,
  config: Pick<AdminSponsorshipReviewReminderConfig, 'minAgeDays' | 'maxItems'>
): SponsorshipReviewReminderCandidate | null => {
  const dueItems = sponsorships
    .filter(
      (record) =>
        isActionableSponsorship(record) &&
        hasCompleteFiche(record) &&
        record.reviewStatus === 'pending_review'
    )
    .map((record): SponsorshipReviewReminderEmailItem => {
      const daysWaiting = daysBetween(now, record.detailsSubmittedAt);
      return {
        reference: sponsorshipRef(record),
        amount: record.amount,
        currency: record.currency,
        detailsSubmittedAt: record.detailsSubmittedAt,
        daysWaiting
      };
    })
    .filter(
      (item) =>
        item.daysWaiting !== null && item.daysWaiting >= config.minAgeDays
    )
    .sort(compareReminderItems);

  if (dueItems.length === 0) {
    return null;
  }

  const days = dueItems
    .map((item) => item.daysWaiting)
    .filter((value): value is number => value !== null);

  return {
    totalCount: dueItems.length,
    urgentCount: dueItems.filter(
      (item) => item.daysWaiting !== null && item.daysWaiting >= 7
    ).length,
    oldestDaysWaiting: days.length > 0 ? Math.max(...days) : null,
    items: dueItems.slice(0, config.maxItems)
  };
};

export const queueDueSponsorshipReviewReminder = async (
  pool: Pool | null,
  options: {
    readonly now?: Date;
    readonly config?: AdminSponsorshipReviewReminderConfig;
    readonly adminUrl?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {}
): Promise<AdminSponsorshipReviewReminderResult> => {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const config =
    options.config ?? loadAdminSponsorshipReviewReminderConfig(env);

  if (!config.enabled) {
    return emptyResult('disabled');
  }

  if (!loadTransactionalEmailConfig(env).enabled) {
    return emptyResult('smtp_disabled');
  }

  if (!env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim()) {
    return emptyResult('recipient_not_configured');
  }

  if (!pool) {
    return emptyResult('database_unavailable');
  }

  const sponsorships = await listSponsorshipsForAttention(pool);
  const candidate = buildSponsorshipReviewReminderCandidate(
    sponsorships.items,
    now,
    config
  );

  if (!candidate) {
    return emptyResult('nothing_due', 0, true);
  }

  const notification = await queueSponsorshipReviewReminderNotification(pool, {
    ...candidate,
    adminUrl: options.adminUrl ?? DEFAULT_REVIEW_REMINDER_ADMIN_URL,
    idempotencyKey: createSponsorshipReviewReminderIdempotencyKey(now)
  });

  return {
    checked: true,
    skippedReason: null,
    dueCount: candidate.totalCount,
    queued: notification.queued,
    duplicate: notification.duplicate,
    attempted: notification.attempted,
    sent: notification.sent,
    messageId: notification.messageId,
    error: notification.error
  };
};
