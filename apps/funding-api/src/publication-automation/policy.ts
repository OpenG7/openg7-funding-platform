import { createHash } from 'node:crypto';

import type {
  PublicationFeedId,
  PublicationFeedSettings
} from '@openg7/funding-core';

import {
  loadSocialPublicationConfig,
  type SocialPublicationConfig
} from '../social-publication.service.js';

export const feedIds: PublicationFeedId[] = [
  'openg7:facebook',
  'openg7:linkedin',
  'openg20:facebook',
  'openg20:linkedin'
];
export class PublicationAutomationError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409
  ) {
    super(code);
  }
}
export function assert(
  condition: unknown,
  code: string,
  status = 409
): asserts condition {
  if (!condition) throw new PublicationAutomationError(code, status);
}
export const isFeed = (id: unknown): id is PublicationFeedId =>
  feedIds.includes(id as PublicationFeedId);
export const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const digest = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');
export function validateSettings(s: PublicationFeedSettings): void {
  assert(
    s &&
      isFeed(s.id) &&
      typeof s.paused === 'boolean' &&
      typeof s.autoPrepare === 'boolean' &&
      typeof s.timezone === 'string' &&
      s.timezone.length > 0,
    'INVALID_SETTINGS',
    400
  );
  assert(
    Array.isArray(s.weekdays) &&
      s.weekdays.length > 0 &&
      s.weekdays.length <= 7 &&
      s.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    'INVALID_SETTINGS',
    400
  );
  assert(
    /^([01]\d|2[0-3]):[0-5]\d$/.test(s.localTime) &&
      Number.isInteger(s.capacity) &&
      s.capacity >= 1 &&
      s.capacity <= 10 &&
      Number.isInteger(s.horizonDays) &&
      s.horizonDays >= 1 &&
      s.horizonDays <= 28,
    'INVALID_SETTINGS',
    400
  );
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone }).format();
  } catch {
    throw new PublicationAutomationError('INVALID_TIMEZONE', 400);
  }
}
export function validateContent(
  message: unknown,
  scheduledAt: unknown
): asserts message is string {
  assert(
    typeof message === 'string' &&
      message.trim().length > 0 &&
      message.length <= 2900,
    'INVALID_MESSAGE',
    400
  );
  assert(
    typeof scheduledAt === 'string' &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) &&
      Number.isFinite(Date.parse(scheduledAt)),
    'INVALID_DATE',
    400
  );
}
export function feedConfig(
  id: PublicationFeedId,
  env: NodeJS.ProcessEnv = process.env
): {
  config: SocialPublicationConfig;
  accountId: string;
  expiresAt: string | null;
  fingerprint: string;
} {
  const [target, channel] = id.split(':');
  const prefix = `SOCIAL_PUBLICATION_${target!.toUpperCase()}_${channel!.toUpperCase()}`;
  const legacy = target === 'openg7';
  const config = loadSocialPublicationConfig({
    ...env,
    SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID:
      channel === 'facebook'
        ? env[`${prefix}_ACCOUNT_ID`] ||
          (legacy ? env.SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID : '')
        : '',
    SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN:
      channel === 'facebook'
        ? env[`${prefix}_ACCESS_TOKEN`] ||
          (legacy ? env.SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN : '')
        : '',
    SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID:
      channel === 'linkedin'
        ? env[`${prefix}_ACCOUNT_ID`] ||
          (legacy ? env.SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID : '')
        : '',
    SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN:
      channel === 'linkedin'
        ? env[`${prefix}_ACCESS_TOKEN`] ||
          (legacy ? env.SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN : '')
        : ''
  });
  const accountId =
    config.mode === 'mock'
      ? `mock-${id}`
      : channel === 'facebook'
        ? config.facebook.pageId
        : config.linkedin.organizationId.replace(/^urn:li:organization:/, '');
  const expiresAt = env[`${prefix}_EXPIRES_AT`]?.trim() || null;
  const token =
    channel === 'facebook'
      ? config.facebook.pageAccessToken
      : config.linkedin.accessToken;
  return {
    config,
    accountId,
    expiresAt,
    fingerprint: digest(`${config.mode}:${accountId}:${token}`)
  };
}

// Convert wall-clock recurrences using the selected IANA zone, including DST.
// Missing spring-forward times are skipped; repeated fall-back times occur once.
export function recurrenceTimes(
  settings: PublicationFeedSettings,
  now: Date
): string[] {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = (d: Date) =>
    Object.fromEntries(format.formatToParts(d).map((p) => [p.type, p.value]));
  const today = parts(now);
  const midnight = Date.UTC(
    Number(today.year),
    Number(today.month) - 1,
    Number(today.day)
  );
  const [h, m] = settings.localTime.split(':').map(Number);
  const results: string[] = [];
  for (let day = 0; day < settings.horizonDays; day++) {
    const local = new Date(midnight + day * 86400000);
    if (!settings.weekdays.includes(local.getUTCDay())) continue;
    const wall = local.getTime() + h! * 3600000 + m! * 60000;
    let candidate = wall;
    for (let pass = 0; pass < 3; pass++) {
      const p = parts(new Date(candidate));
      candidate +=
        wall -
        Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour),
          Number(p.minute)
        );
    }
    const p = parts(new Date(candidate));
    if (
      p.hour === settings.localTime.slice(0, 2) &&
      p.minute === settings.localTime.slice(3) &&
      Number(p.day) === local.getUTCDate() &&
      candidate > now.getTime()
    )
      results.push(new Date(candidate).toISOString());
  }
  return results;
}
