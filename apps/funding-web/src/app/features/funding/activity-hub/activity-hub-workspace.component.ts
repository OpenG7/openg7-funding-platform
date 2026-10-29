import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../components/admin-ui/admin-drawer.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../services/funding-i18n.service.js';

import { ActivityHubEntryComponent } from './activity-hub-entry.component.js';
import { ActivityHubDashboardComponent } from './activity-hub-dashboard.component.js';
import { ActivityHubJournalComponent } from './activity-hub-journal.component.js';
import { ActivityHubBriefingComponent } from './activity-hub-briefing.component.js';
import {
  HUB_ACTIVITIES,
  HUB_ACTIVITY_SNAPSHOT,
  HUB_ACTIVITY_TIMEZONE,
  hubActivitiesForPeriod,
  hubMetricItems,
  type HubActivity,
  type HubActivityKind
} from './activity-hub-activity.js';
import {
  HUB_DATA_SCENARIOS,
  type HubDataScenario,
  type HubMetricValue
} from './activity-hub-experience.js';
import {
  HUB_ENTRIES,
  HUB_GUIDE_ENTRIES,
  type HubCategory,
  type HubEntry,
  type HubTheme
} from './activity-hub-fixtures.js';
import en from './i18n/activity-hub.en.json' with { type: 'json' };
import fr from './i18n/activity-hub.fr-CA.json' with { type: 'json' };
import journalEn from './i18n/activity-hub-journal.en.json' with { type: 'json' };
import journalFr from './i18n/activity-hub-journal.fr-CA.json' with { type: 'json' };
import experienceEn from './i18n/activity-hub-experience.en.json' with { type: 'json' };
import experienceFr from './i18n/activity-hub-experience.fr-CA.json' with { type: 'json' };

type HubSection = 'overview' | 'all' | HubCategory | 'saved' | 'briefing';

/** Routed demo page: synthetic editorial content and visit-local reading state. */
@Component({
  selector: 'openg7-activity-hub-workspace',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    NgTemplateOutlet,
    AdminIconComponent,
    AdminDrawerComponent,
    ActivityHubEntryComponent,
    ActivityHubDashboardComponent,
    ActivityHubJournalComponent,
    ActivityHubBriefingComponent
  ],
  templateUrl: './activity-hub-workspace.component.html',
  styleUrls: [
    '../../../../styles/admin-fonts.css',
    '../components/admin-ui/admin-theme.css',
    './activity-hub-workspace.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityHubWorkspaceComponent {
  readonly embedded = input(false);
  readonly active = input(true);
  readonly serviceDeliveryRequested = output<string | null>();
  readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
  private readingOpener: HTMLElement | null = null;
  readonly section = signal<HubSection>('overview');
  readonly collapsed = signal(false);
  readonly dockedBottom = signal(false);
  readonly query = signal('');
  readonly theme = signal<HubTheme | 'all'>('all');
  readonly unreadOnly = signal(false);
  readonly refreshed = signal(false);
  readonly readIds = signal<ReadonlySet<string>>(new Set());
  readonly savedIds = signal<ReadonlySet<string>>(new Set());
  readonly selected = signal<HubEntry | null>(null);
  readonly selectedActivity = signal<HubActivity | null>(null);
  readonly guideOrigin = signal<HubActivity | null>(null);
  readonly metricKind = signal<HubActivityKind | null>(null);
  readonly scenario = signal<HubDataScenario>('normal');
  readonly scenarios = HUB_DATA_SCENARIOS;
  readonly activities = computed(() => {
    const scenario = this.scenario();
    if (
      scenario === 'empty' ||
      scenario === 'loading' ||
      scenario === 'unavailable'
    )
      return [];
    return HUB_ACTIVITIES.filter(
      (activity) =>
        (!activity.afterRefresh || this.refreshed()) &&
        (scenario !== 'partial' || activity.kind !== 'media')
    );
  });
  readonly metrics = computed<readonly HubMetricValue[]>(() => {
    const kinds = ['ready', 'media', 'rules', 'preparation'] as const;
    const week = hubActivitiesForPeriod(this.activities(), 'week');
    return kinds.map((kind) => ({
      kind,
      value: this.sourceAvailable(kind)
        ? hubMetricItems(kind, week).length
        : null
    }));
  });
  readonly lastRefresh = computed(() =>
    this.refreshed() ? HUB_ACTIVITY_SNAPSHOT : '2026-10-28T18:15:00Z'
  );
  readonly headingKey = computed(() => {
    switch (this.section()) {
      case 'overview':
        return 'activityHub.guide.discover';
      case 'journal':
        return 'activityHubExperience.journalTitle';
      case 'briefing':
        return 'activityHubExperience.briefingTitle';
      default:
        return 'activityHub.guide.archiveTitle';
    }
  });
  readonly announcement = signal('');
  readonly sections: readonly { id: HubSection; icon: AdminIconName }[] = [
    { id: 'overview', icon: 'dashboard' },
    { id: 'briefing', icon: 'bellActive' },
    { id: 'journal', icon: 'clock' },
    { id: 'inspirations', icon: 'assistant' },
    { id: 'news', icon: 'bell' },
    { id: 'resources', icon: 'publications' },
    { id: 'saved', icon: 'check' }
  ];
  readonly themes = ['community', 'product', 'practice'] as const;
  readonly entries = computed(() =>
    [...HUB_ENTRIES, ...HUB_GUIDE_ENTRIES]
      .filter((entry) => !entry.afterRefresh || this.refreshed())
      .sort((a, b) => b.date.localeCompare(a.date))
  );
  readonly unreadCount = computed(
    () => this.entries().filter((entry) => !this.readIds().has(entry.id)).length
  );
  readonly readCount = computed(
    () => this.entries().length - this.unreadCount()
  );
  readonly visibleEntries = computed(() => {
    this.i18n.trackTranslationState();
    const query = this.normalize(this.query().trim());
    return this.entries().filter((entry) => {
      const section = this.section();
      if (
        section === 'saved'
          ? !this.savedIds().has(entry.id)
          : section !== 'overview' &&
            section !== 'all' &&
            entry.category !== section
      )
        return false;
      if (this.theme() !== 'all' && entry.theme !== this.theme()) return false;
      if (this.unreadOnly() && this.readIds().has(entry.id)) return false;
      const text = [
        entry.titleKey,
        entry.summaryKey,
        entry.authorKey,
        'activityHub.themes.' + entry.theme
      ]
        .map((key) => this.i18n.t(key))
        .join(' ');
      return !query || this.normalize(text).includes(query);
    });
  });
  readonly hasFilters = computed(
    () => !!this.query().trim() || this.theme() !== 'all' || this.unreadOnly()
  );

  constructor() {
    this.i18n.mergeTranslations('fr-CA', fr);
    this.i18n.mergeTranslations('en', en);
    this.i18n.mergeTranslations('fr-CA', journalFr);
    this.i18n.mergeTranslations('en', journalEn);
    this.i18n.mergeTranslations('fr-CA', experienceFr);
    this.i18n.mergeTranslations('en', experienceEn);
    effect(() => {
      if (!this.active()) untracked(() => this.close());
    });
  }

  selectSection(section: HubSection): void {
    const fromNavigation =
      this.document.activeElement?.hasAttribute('data-og7-id');
    this.section.set(section);
    this.metricKind.set(null);
    this.resetFilters();
    if (!fromNavigation)
      afterNextRender(() => this.focusContent(), { injector: this.injector });
  }

  toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  setTheme(value: string): void {
    this.theme.set(this.themes.find((theme) => theme === value) ?? 'all');
  }

  resetFilters(): void {
    const opener = this.document.activeElement;
    this.query.set('');
    this.theme.set('all');
    this.unreadOnly.set(false);
    this.restoreFocusIfRemoved(opener);
  }

  open(entry: HubEntry): void {
    this.readingOpener = this.document.activeElement as HTMLElement | null;
    this.selectedActivity.set(null);
    this.guideOrigin.set(null);
    this.selected.set(entry);
    this.readIds.update((ids) => new Set([...ids, entry.id]));
  }

  close(): void {
    this.selected.set(null);
    this.selectedActivity.set(null);
    this.guideOrigin.set(null);
    this.restoreFocusIfRemoved(this.readingOpener);
    this.readingOpener = null;
  }

  toggleSaved(entry: HubEntry): void {
    const opener = this.document.activeElement;
    const saved = !this.savedIds().has(entry.id);
    this.savedIds.update((ids) => {
      const next = new Set(ids);
      if (saved) next.add(entry.id);
      else next.delete(entry.id);
      return next;
    });
    this.announcement.set(
      this.i18n.t(
        saved ? 'activityHub.savedNotice' : 'activityHub.unsavedNotice',
        { title: this.i18n.t(entry.titleKey) }
      )
    );
    if (!saved && this.section() === 'saved' && !this.selected())
      this.restoreFocusIfRemoved(opener);
  }

  refresh(): void {
    if (this.scenario() === 'loading' || this.scenario() === 'unavailable')
      return;
    if (this.refreshed()) return;
    this.refreshed.set(true);
    this.announcement.set(
      this.i18n.t('activityHub.refreshedNotice', {
        count: HUB_ENTRIES.filter((entry) => entry.afterRefresh).length
      })
    );
  }

  dateLabel(entry: HubEntry): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    }).format(new Date(entry.date + 'T12:00:00Z'));
  }

  openMetric(kind: HubActivityKind): void {
    if (!this.sourceAvailable(kind)) return;
    this.selectSection('journal');
    this.metricKind.set(kind);
  }

  openActivity(activity: HubActivity): void {
    this.readingOpener = this.document.activeElement as HTMLElement | null;
    this.selected.set(null);
    this.guideOrigin.set(null);
    this.selectedActivity.set(activity);
  }

  openActivityGuide(): void {
    const activity = this.selectedActivity();
    if (!activity) return;
    const guide = HUB_GUIDE_ENTRIES.find(
      (entry) => entry.id === activity.guideId
    );
    if (!guide) return;
    this.guideOrigin.set(activity);
    this.selectedActivity.set(null);
    this.selected.set(guide);
    this.readIds.update((ids) => new Set([...ids, guide.id]));
    this.focusDetail();
  }

  returnToActivity(): void {
    const activity = this.guideOrigin();
    if (!activity) return;
    this.selected.set(null);
    this.selectedActivity.set(activity);
    this.guideOrigin.set(null);
    this.focusDetail();
  }

  setScenario(value: string): void {
    const opener = this.document.activeElement;
    this.scenario.set(
      HUB_DATA_SCENARIOS.find((scenario) => scenario === value) ?? 'normal'
    );
    this.restoreFocusIfRemoved(opener);
  }

  sourceAvailable(kind: HubActivityKind): boolean {
    const scenario = this.scenario();
    return (
      scenario !== 'loading' &&
      scenario !== 'unavailable' &&
      !(scenario === 'partial' && kind === 'media')
    );
  }

  activityDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
      timeZone: HUB_ACTIVITY_TIMEZONE
    }).format(new Date(value));
  }

  private focusDetail(): void {
    afterNextRender(
      () =>
        this.element.nativeElement
          .querySelector<HTMLElement>(
            '[data-og7="activity-hub-detail"], [data-og7="activity-hub-activity-detail"]'
          )
          ?.focus(),
      { injector: this.injector }
    );
  }

  skipToContent(event: Event): void {
    event.preventDefault();
    this.focusContent();
  }

  requestServiceDelivery(
    event: MouseEvent,
    dossierId: string | null = null
  ): void {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (!this.embedded() || !this.active()) return;
    if (
      dossierId !== null &&
      !HUB_ACTIVITIES.some((activity) => activity.targetDossierId === dossierId)
    )
      return;
    this.close();
    this.serviceDeliveryRequested.emit(dossierId);
  }

  focusContent(): void {
    if (!this.active() || this.collapsed()) return;
    const content = this.content()?.nativeElement;
    if (content?.getClientRects().length) content.focus();
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private restoreFocusIfRemoved(opener: Element | null): void {
    if (!opener) return;
    afterNextRender(
      () => {
        if (!opener.isConnected) this.focusContent();
      },
      { injector: this.injector }
    );
  }
}
