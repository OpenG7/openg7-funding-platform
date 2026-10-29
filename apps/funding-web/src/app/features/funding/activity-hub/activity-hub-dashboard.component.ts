import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
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
  type HubActivity,
  type HubActivityKind
} from './activity-hub-activity.js';
import type {
  HubDataScenario,
  HubMetricValue
} from './activity-hub-experience.js';
import {
  HUB_GUIDE_ENTRIES,
  type HubCategory,
  type HubEntry
} from './activity-hub-fixtures.js';
import en from './i18n/activity-hub-experience.en.json' with { type: 'json' };
import fr from './i18n/activity-hub-experience.fr-CA.json' with { type: 'json' };

/** Internal organism: the illustrated, entirely synthetic daily briefing. */
@Component({
  selector: 'openg7-activity-hub-dashboard',
  standalone: true,
  imports: [AdminIconComponent, TranslatePipe],
  templateUrl: './activity-hub-dashboard.component.html',
  styleUrl: './activity-hub-dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubDashboardComponent {
  readonly activities = input.required<readonly HubActivity[]>();
  readonly metrics = input.required<readonly HubMetricValue[]>();
  readonly scenario = input<HubDataScenario>('normal');
  readonly refreshed = input(false);
  readonly opened = output<HubEntry>();
  readonly sectionRequested = output<HubCategory>();
  readonly activityOpened = output<HubActivity>();
  readonly metricRequested = output<HubActivityKind>();
  readonly guides = HUB_GUIDE_ENTRIES;
  readonly diary = computed(() =>
    this.scenario() === 'normal' || this.scenario() === 'partial'
      ? hubActivitiesForPeriod(this.activities(), 'today')
      : []
  );
  readonly takeaways: readonly {
    id: string;
    icon: AdminIconName;
    tone: string;
    guide: number;
  }[] = [
    { id: 'media', icon: 'publications', tone: 'blue', guide: 0 },
    { id: 'context', icon: 'transparency', tone: 'gold', guide: 1 },
    { id: 'human', icon: 'assistant', tone: 'purple', guide: 2 }
  ];
  readonly metricMetadata: readonly {
    kind: HubActivityKind;
    icon: AdminIconName;
    tone: string;
  }[] = [
    {
      kind: 'ready',
      icon: 'publications',
      tone: 'blue'
    },
    {
      kind: 'media',
      icon: 'mountain',
      tone: 'green'
    },
    {
      kind: 'rules',
      icon: 'sponsors',
      tone: 'purple'
    },
    {
      kind: 'preparation',
      icon: 'assistant',
      tone: 'gold'
    }
  ];
  readonly metricCards = computed(() =>
    this.metricMetadata.map((metadata) => ({
      ...metadata,
      value:
        this.scenario() === 'loading' || this.scenario() === 'unavailable'
          ? null
          : (this.metrics().find((metric) => metric.kind === metadata.kind)
              ?.value ?? null)
    }))
  );

  constructor() {
    const i18n = inject(FundingI18nService);
    i18n.mergeTranslations('fr-CA', fr);
    i18n.mergeTranslations('en', en);
  }

  timeLabel(activity: HubActivity): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: HUB_ACTIVITY_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(activity.occurredAt));
  }

  activityTone(kind: HubActivityKind): string {
    return this.metricMetadata.find((metric) => metric.kind === kind)!.tone;
  }

  activityIcon(kind: HubActivityKind): AdminIconName {
    return this.metricMetadata.find((metric) => metric.kind === kind)!.icon;
  }

  openMetric(metric: HubMetricValue): void {
    if (metric.value !== null) this.metricRequested.emit(metric.kind);
  }
}
