import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../services/funding-i18n.service.js';

import { HUB_GUIDE_ENTRIES, type HubEntry } from './activity-hub-fixtures.js';
import en from './i18n/activity-hub-briefing.en.json' with { type: 'json' };
import fr from './i18n/activity-hub-briefing.fr-CA.json' with { type: 'json' };

type HubVisitOption = 'previous-day' | 'morning' | 'current';

/** Internal reading organism: deterministic briefing from visit-local state. */
@Component({
  selector: 'openg7-activity-hub-briefing',
  standalone: true,
  imports: [AdminIconComponent, TranslatePipe],
  templateUrl: './activity-hub-briefing.component.html',
  styleUrl: './activity-hub-briefing.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubBriefingComponent {
  readonly entries = input.required<readonly HubEntry[]>();
  readonly readIds = input.required<ReadonlySet<string>>();
  readonly savedIds = input.required<ReadonlySet<string>>();
  readonly opened = output<HubEntry>();
  readonly sectionRequested = output<'saved' | 'all'>();

  readonly snapshot = '2026-10-28T18:30:00Z';
  readonly lastVisit = signal<HubVisitOption>('morning');
  readonly visits: readonly {
    id: HubVisitOption;
    date: string;
    labelKey: string;
  }[] = [
    {
      id: 'previous-day',
      date: '2026-10-26',
      labelKey: 'activityHubBriefing.visits.previousDay'
    },
    {
      id: 'morning',
      date: '2026-10-27',
      labelKey: 'activityHubBriefing.visits.morning'
    },
    {
      id: 'current',
      date: '2026-10-28',
      labelKey: 'activityHubBriefing.visits.current'
    }
  ];
  readonly baseline = computed(
    () => this.visits.find((visit) => visit.id === this.lastVisit())!.date
  );
  private readonly sortedEntries = computed(() =>
    [...this.entries()].sort((a, b) => b.date.localeCompare(a.date))
  );
  readonly newUnreadEntries = computed(() =>
    this.sortedEntries().filter(
      (entry) =>
        entry.date > this.baseline() &&
        entry.date <= this.snapshot.slice(0, 10) &&
        !this.readIds().has(entry.id)
    )
  );
  readonly newPreview = computed(() => this.newUnreadEntries().slice(0, 3));
  private readonly savedEntries = computed(() =>
    this.sortedEntries().filter((entry) => this.savedIds().has(entry.id))
  );
  readonly savedUnreadEntries = computed(() =>
    this.savedEntries().filter((entry) => !this.readIds().has(entry.id))
  );
  readonly savedPreview = computed(() => this.savedUnreadEntries().slice(0, 2));
  readonly hasSavedEntries = computed(() => this.savedEntries().length > 0);
  readonly guides = computed(() => {
    const available = new Map(this.entries().map((entry) => [entry.id, entry]));
    return HUB_GUIDE_ENTRIES.map((guide) => available.get(guide.id)).filter(
      (entry): entry is HubEntry => entry !== undefined
    );
  });
  readonly readCount = computed(
    () => this.entries().filter((entry) => this.readIds().has(entry.id)).length
  );
  readonly remainingCount = computed(
    () => this.entries().length - this.readCount()
  );

  constructor() {
    const i18n = inject(FundingI18nService);
    i18n.mergeTranslations('fr-CA', fr);
    i18n.mergeTranslations('en', en);
  }

  selectVisit(value: string): void {
    const visit = this.visits.find((option) => option.id === value);
    if (visit) this.lastVisit.set(visit.id);
  }
}
