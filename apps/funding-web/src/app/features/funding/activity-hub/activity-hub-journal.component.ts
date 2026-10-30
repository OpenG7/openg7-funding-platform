import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  AdminIconComponent,
  type AdminIconName
} from '../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../services/funding-i18n.service.js';

import {
  HUB_ACTIVITY_TIMEZONE,
  hubActivitiesForPeriod,
  hubMetricItems,
  type HubActivity,
  type HubActivityKind,
  type HubActivityOrigin,
  type HubActivityPeriod
} from './activity-hub-activity.js';
import type { HubDataScenario } from './activity-hub-experience.js';
import en from './i18n/activity-hub-journal.en.json' with { type: 'json' };
import fr from './i18n/activity-hub-journal.fr-CA.json' with { type: 'json' };

/** Internal organism: local activity filters and unique-entity metric drilldown. */
@Component({
  selector: 'openg7-activity-hub-journal',
  standalone: true,
  imports: [AdminIconComponent, TranslatePipe],
  templateUrl: './activity-hub-journal.component.html',
  styleUrl: './activity-hub-journal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubJournalComponent {
  readonly activities = input.required<readonly HubActivity[]>();
  readonly scenario = input<HubDataScenario>('normal');
  readonly initialKind = input<HubActivityKind | 'all'>('all');
  readonly initialPeriod = input<HubActivityPeriod>('week');
  readonly metricKind = input<HubActivityKind | null>(null);
  readonly activityOpened = output<HubActivity>();
  readonly resetRequested = output<void>();
  readonly i18n = inject(FundingI18nService);
  readonly kind = signal<HubActivityKind | 'all'>('all');
  readonly period = signal<HubActivityPeriod>('week');
  readonly origin = signal<HubActivityOrigin | 'all'>('all');
  readonly query = signal('');
  readonly attentionOnly = signal(false);
  readonly kinds = ['ready', 'media', 'rules', 'preparation'] as const;
  readonly periods = ['today', 'week', 'all'] as const;
  readonly origins = ['human', 'automatic'] as const;
  readonly effectiveKind = computed(() => this.metricKind() ?? this.kind());
  readonly sourceUnavailable = computed(
    () =>
      this.scenario() === 'loading' ||
      this.scenario() === 'unavailable' ||
      (this.scenario() === 'partial' && this.effectiveKind() === 'media')
  );
  readonly partialSelection = computed(
    () => this.scenario() === 'partial' && this.effectiveKind() === 'all'
  );
  readonly resultLabelKey = computed(() => {
    if (this.sourceUnavailable())
      return this.scenario() === 'loading'
        ? 'activityHubJournal.sourceLoading'
        : 'activityHubJournal.sourceUnavailable';
    if (this.partialSelection())
      return this.metricKind()
        ? 'activityHubJournal.availableEntityResults'
        : 'activityHubJournal.availableResults';
    return this.metricKind()
      ? 'activityHubJournal.entityResults'
      : 'activityHubJournal.results';
  });
  readonly visibleActivities = computed(() => {
    this.i18n.trackTranslationState();
    if (this.sourceUnavailable() || this.scenario() === 'empty') return [];
    const availableActivities =
      this.scenario() === 'partial'
        ? this.activities().filter((activity) => activity.kind !== 'media')
        : this.activities();
    const periodActivities = hubActivitiesForPeriod(
      availableActivities,
      this.period()
    );
    const metricKind = this.metricKind();
    const candidates = metricKind
      ? hubMetricItems(metricKind, periodActivities)
      : periodActivities;
    const query = this.normalize(this.query());
    return candidates.filter((activity) => {
      if (
        this.effectiveKind() !== 'all' &&
        activity.kind !== this.effectiveKind()
      )
        return false;
      if (this.origin() !== 'all' && activity.origin !== this.origin())
        return false;
      if (this.attentionOnly() && !activity.attention) return false;
      const text = [
        this.i18n.t(activity.titleKey),
        this.i18n.t(activity.summaryKey),
        this.i18n.t(activity.actorKey),
        activity.entityId
      ].join(' ');
      return !query || this.normalize(text).includes(query);
    });
  });

  constructor() {
    this.i18n.mergeTranslations('fr-CA', fr);
    this.i18n.mergeTranslations('en', en);
    effect(() => {
      this.metricKind();
      this.kind.set(this.initialKind());
      this.period.set(this.initialPeriod());
      this.origin.set('all');
      this.query.set('');
      this.attentionOnly.set(false);
    });
  }

  setKind(value: string): void {
    this.kind.set(this.kinds.find((kind) => kind === value) ?? 'all');
  }

  setPeriod(value: string): void {
    this.period.set(this.periods.find((period) => period === value) ?? 'week');
  }

  setOrigin(value: string): void {
    this.origin.set(this.origins.find((origin) => origin === value) ?? 'all');
  }

  reset(): void {
    this.kind.set(this.initialKind());
    this.period.set(this.initialPeriod());
    this.origin.set('all');
    this.query.set('');
    this.attentionOnly.set(false);
    this.resetRequested.emit();
  }

  icon(kind: HubActivityKind): AdminIconName {
    return {
      ready: 'publications',
      media: 'mountain',
      rules: 'settings',
      preparation: 'assistant'
    }[kind] as AdminIconName;
  }

  dateLabel(activity: HubActivity): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: HUB_ACTIVITY_TIMEZONE
    }).format(new Date(activity.occurredAt));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
