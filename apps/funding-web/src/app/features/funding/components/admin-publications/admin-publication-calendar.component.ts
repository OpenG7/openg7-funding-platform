import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorFeedChannel } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import {
  publicationCalendarTimezone,
  publicationDay,
  publicationMonthDays,
  shiftCalendarMonth,
  sortCalendarEntries,
  type PublicationCalendarEntry
} from './publication-calendar.js';

/** Funding presentation organism: browse dates and select an item; no mutations. */
@Component({
  selector: 'openg7-admin-publication-calendar',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-calendar.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-publication-calendar.component.css'
  ]
})
export class AdminPublicationCalendarComponent {
  readonly entries = input.required<readonly PublicationCalendarEntry[]>();
  readonly selectedId = input<string | null>(null);
  readonly state = input.required<'idle' | 'loading' | 'ready' | 'error'>();
  readonly openEntry = output<string>();
  readonly retry = output<void>();
  readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  readonly timezone = publicationCalendarTimezone;
  readonly today = signal<string | null>(null);
  readonly month = signal<string | null>(null);
  readonly selectedDay = signal<string | null>(null);
  readonly channel = signal<'all' | SponsorFeedChannel>('all');
  readonly channels = ['all', 'facebook', 'linkedin'] as const;
  private lastSelection: string | null = null;

  readonly sorted = computed(() => sortCalendarEntries(this.entries()));
  readonly filtered = computed(() =>
    this.sorted().filter(
      (entry) => this.channel() === 'all' || entry.channel === this.channel()
    )
  );
  readonly undated = computed(() =>
    this.filtered().filter((entry) => !publicationDay(entry.startsAt))
  );
  readonly byDay = computed(() => {
    const grouped = new Map<string, PublicationCalendarEntry[]>();
    for (const entry of this.filtered()) {
      const key = publicationDay(entry.startsAt);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return grouped;
  });
  readonly days = computed(() =>
    this.month()
      ? publicationMonthDays(this.month()!).map((key) => ({
          key,
          day: Number(key.slice(-2)),
          entries: this.byDay().get(key) ?? []
        }))
      : []
  );
  readonly dayEntries = computed(
    () => this.byDay().get(this.selectedDay() ?? '') ?? []
  );
  readonly monthCount = computed(
    () =>
      this.filtered().filter((entry) =>
        publicationDay(entry.startsAt)?.startsWith(this.month() ?? 'none')
      ).length
  );
  readonly weekdays = computed(() =>
    Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
        weekday: 'short',
        timeZone: 'UTC'
      }).format(new Date(Date.UTC(2024, 0, 1 + index)))
    )
  );
  readonly monthLabel = computed(() =>
    this.month()
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        }).format(new Date(this.month() + '-01T12:00:00Z'))
      : ''
  );

  constructor() {
    afterNextRender(() =>
      this.today.set(publicationDay(new Date().toISOString()))
    );
    effect(() => {
      const today = this.today();
      if (!today || this.state() !== 'ready') return;
      const selected = this.entries().find(
        (entry) => entry.id === this.selectedId()
      );
      const selectionKey = selected
        ? `${selected.id}:${selected.startsAt}`
        : null;
      const selectionChanged = selected && selectionKey !== this.lastSelection;
      if (!this.month() || selectionChanged) {
        const dated = this.sorted().filter((entry) =>
          publicationDay(entry.startsAt)
        );
        const upcoming = dated.find(
          (entry) => publicationDay(entry.startsAt)! >= today
        );
        const key =
          publicationDay(selected?.startsAt ?? null) ??
          publicationDay(
            upcoming?.startsAt ?? dated.at(-1)?.startsAt ?? null
          ) ??
          today;
        this.goToDay(key);
      }
      this.lastSelection = selectionKey;
    });
  }

  moveMonth(offset: number): void {
    if (this.month())
      this.goToDay(shiftCalendarMonth(this.month()!, offset) + '-01');
  }

  goToDay(key: string): void {
    this.month.set(key.slice(0, 7));
    this.selectedDay.set(key);
  }

  changeMonth(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (
      /^\d{4}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + '-01T12:00:00Z'))
    )
      this.goToDay(value + '-01');
  }

  selectDay(key: string, focusAgenda = false): void {
    this.goToDay(key);
    if (focusAgenda)
      afterNextRender(
        () => this.document.getElementById('publication-day-agenda')?.focus(),
        { injector: this.injector }
      );
  }

  navigateDay(event: KeyboardEvent, key: string): void {
    const offset = (
      { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<
        string,
        number
      >
    )[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const date = new Date(key + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    const next = date.toISOString().slice(0, 10);
    this.goToDay(next);
    afterNextRender(
      () => this.document.getElementById('publication-day-' + next)?.focus(),
      { injector: this.injector }
    );
  }

  dateLabel(key: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'full',
      timeZone: 'UTC'
    }).format(new Date(key + 'T12:00:00Z'));
  }

  timeLabel(value: string | null): string {
    return value && publicationDay(value)
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: this.timezone
        }).format(new Date(value))
      : '';
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return channel === 'facebook' ? 'Facebook' : 'LinkedIn';
  }

  entryLabel(entry: PublicationCalendarEntry): string {
    return [
      this.timeLabel(entry.startsAt),
      entry.label || this.channelLabel(entry.channel),
      entry.target,
      entry.detail || `${entry.capacityUsed}/${entry.capacity}`,
      entry.statusLabel ||
        this.i18n.t('admin.publicationCalendar.status.' + entry.status)
    ]
      .filter(Boolean)
      .join(' · ');
  }
}
