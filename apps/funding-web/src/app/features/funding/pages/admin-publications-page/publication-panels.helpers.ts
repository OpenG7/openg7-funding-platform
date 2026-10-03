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

export function publicationDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : '';
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
