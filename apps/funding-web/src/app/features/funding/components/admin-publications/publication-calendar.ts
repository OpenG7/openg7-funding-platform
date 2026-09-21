import type {
  PublicationBatchStatus,
  SponsorFeedChannel
} from '@openg7/funding-core';

/** Presentation contract shared by the batch and editorial calendars. */
export interface PublicationCalendarEntry {
  readonly id: string;
  readonly channel: SponsorFeedChannel;
  readonly status: PublicationBatchStatus;
  readonly startsAt: string | null;
  readonly capacityUsed: number;
  readonly capacity: number;
  readonly target?: string;
}

// A single explicit timezone keeps events comparable across channels and slots.
export const publicationCalendarTimezone = 'America/Toronto';

export function publicationDay(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: publicationCalendarTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

/** Six complete Monday-to-Sunday weeks, using UTC only for date arithmetic. */
export function publicationMonthDays(month: string): readonly string[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function sortCalendarEntries(
  entries: readonly PublicationCalendarEntry[]
): readonly PublicationCalendarEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = a.startsAt ? Date.parse(a.startsAt) : NaN;
    const bTime = b.startsAt ? Date.parse(b.startsAt) : NaN;
    if (Number.isFinite(aTime) && Number.isFinite(bTime))
      return aTime - bTime || a.id.localeCompare(b.id);
    if (Number.isFinite(aTime)) return -1;
    if (Number.isFinite(bTime)) return 1;
    return a.id.localeCompare(b.id);
  });
}
