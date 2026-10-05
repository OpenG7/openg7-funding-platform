import type {
  PublicationBatchStatus,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

import type { FundingI18nService } from '../../services/funding-i18n.service.js';

export function publicationValueFromEvent(event: Event): string {
  return (
    event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  ).value;
}

export function publicationDateTimeLocal(
  value: string | null,
  timezone = 'America/Toronto'
): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const part = (type: string) =>
      parts
        .find((item) => item.type === type)!
        .value.padStart(type === 'year' ? 4 : 2, '0');
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  } catch {
    return '';
  }
}

/** Reject missing/repeated civil times rather than guess an authorized instant. */
export function publicationDateTimeUtc(
  value: string,
  timezone = 'America/Toronto'
): string {
  const wallTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? Date.parse(`${value}:00Z`)
    : NaN;
  if (
    !Number.isFinite(wallTime) ||
    new Date(wallTime).toISOString().slice(0, 16) !== value
  )
    throw new RangeError('Invalid publication date.');
  const offsets = new Set<number>();
  // Sample both sides of a timezone transition, including date-line changes.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wallTime + hours * 60 * 60 * 1000;
    const local = publicationDateTimeLocal(
      new Date(sample).toISOString(),
      timezone
    );
    if (!local) throw new RangeError('Invalid publication timezone.');
    offsets.add(Date.parse(`${local}:00Z`) - sample);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallTime - offset).toISOString())
    .filter(
      (candidate) => publicationDateTimeLocal(candidate, timezone) === value
    );
  if (candidates.length !== 1)
    throw new RangeError(
      'Publication date is missing or repeated in this timezone.'
    );
  return candidates[0]!;
}

/** Keep server precision and the selected DST occurrence on text-only edits. */
export function updatedPublicationDateTime(
  value: string,
  original: string | null,
  timezone = 'America/Toronto',
  originalTimezone = timezone
): string | null {
  if (!value) return null;
  if (
    timezone === originalTimezone &&
    value === publicationDateTimeLocal(original, timezone)
  )
    return original;
  return publicationDateTimeUtc(value, timezone);
}

export function publicationChannelLabel(
  i18n: FundingI18nService,
  channel: SponsorFeedChannel
): string {
  return channel === 'linkedin'
    ? 'LinkedIn'
    : i18n.t('admin.messages.facebook');
}

export function publicationFeedTargetName(target: SponsorFeedTarget): string {
  return target === 'openg20' ? 'OpenG20' : 'OpenG7';
}

export function publicationBatchStatusLabel(
  i18n: FundingI18nService,
  status: PublicationBatchStatus | null
): string {
  if (!status) return i18n.t('admin.cockpit.health.unknown');
  const keys: Record<PublicationBatchStatus, string> = {
    open: 'admin.dossier.values.open',
    scheduled: 'admin.messages.planifie',
    published: 'admin.messages.publie',
    cancelled: 'admin.messages.annule'
  };
  return i18n.t(keys[status]);
}

export function publicationDateLabel(
  i18n: FundingI18nService,
  value: string | null,
  timezone = 'America/Toronto'
): string {
  if (!value) return i18n.t('admin.dashboard.notAvailable');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    return i18n.t('admin.dashboard.notAvailable');
  try {
    return new Intl.DateTimeFormat(i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone
    }).format(date);
  } catch {
    return value;
  }
}
