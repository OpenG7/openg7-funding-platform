import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  EngineRoomScope,
  EngineRoomSnapshot,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminGoldenPathComponent } from '../../components/admin-golden-path/admin-golden-path.component.js';
import { AdminOperationalQueueComponent } from '../../components/admin-operational-queue/admin-operational-queue.component.js';
import { AdminFlowMeasurementComponent } from '../../components/admin-flow-measurement/admin-flow-measurement.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import { engineFeedHealth, heartbeatState } from './engine-room-view.js';
import { EngineMotorComponent } from './engine-motor.component.js';

/** Funding admin page: read-only supervision, with mutations owned by native screens. */
@Component({
  selector: 'openg7-admin-engine-room-page',
  standalone: true,
  imports: [
    RouterLink,
    AdminGoldenPathComponent,
    AdminOperationalQueueComponent,
    AdminFlowMeasurementComponent,
    AdminLayoutComponent,
    AdminIconComponent,
    EngineMotorComponent
  ],
  templateUrl: './admin-engine-room-page.component.html',
  styleUrl: './admin-engine-room-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminEngineRoomPageComponent {
  private readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
  readonly scope = computed<EngineRoomScope>(() => ({
    ...(this.params().has('sponsorshipId')
      ? { sponsorshipId: this.params().get('sponsorshipId')! }
      : {}),
    ...(this.params().has('deliveryId')
      ? { deliveryId: this.params().get('deliveryId')! }
      : {})
  }));
  readonly contextual = computed(
    () => !!(this.scope().sponsorshipId || this.scope().deliveryId)
  );
  readonly measurementContext = computed(() =>
    JSON.stringify([
      this.scope(),
      this.admin.sessionGeneration(),
      this.admin.identity()?.id,
      this.admin.identity()?.role
    ])
  );
  readonly decisionId = computed(() => this.params().get('decisionId'));
  readonly selected = signal<'publications' | 'preflight'>('publications');
  readonly selectedFeedId = signal<PublicationFeedId | null>(null);
  readonly inspectorView = signal<'overview' | 'diagnostic'>('overview');
  readonly selectedFeed = computed(
    () =>
      this.data()?.publications.feeds.find(
        (feed) => feed.id === this.selectedFeedId()
      ) ?? null
  );
  readonly data = signal<EngineRoomSnapshot | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly clock = signal(Date.now());
  readonly stale = computed(() => {
    const data = this.data();
    return !!data && this.clock() - Date.parse(data.observedAt) > 180_000;
  });
  readonly heartbeat = computed(() =>
    heartbeatState(
      this.data()?.preflight.lastWorkerSeenAt ?? null,
      this.clock()
    )
  );
  readonly health = engineFeedHealth;
  readonly inspectionTitle = () => {
    const feed = this.selectedFeed();
    return feed
      ? this.feedName(feed)
      : this.t(
          this.selected() === 'publications'
            ? 'publicationsTitle'
            : 'preflightTitle'
        );
  };
  readonly feedName = (feed: PublicationFeed): string =>
    `${feed.id.endsWith(':facebook') ? 'Facebook' : 'LinkedIn'} · ${feed.id.split(':')[0].toUpperCase()}`;
  readonly publicationState = (): string => {
    const data = this.data()?.publications;
    if (!data?.available) return this.t('unknown');
    if (data.feeds.some((feed) => feed.mode === 'disabled' || !feed.configured))
      return this.t('configurationReview');
    if (this.attention()) return this.t('dependenciesReview');
    return this.t(data.workerEnabled ? 'enabled' : 'disabled');
  };
  readonly preflightState = (): string => {
    const data = this.data()?.preflight;
    if (!data?.available) return this.t('unknown');
    return this.t(
      data.connectorEnabled
        ? 'connectorConfigured'
        : data.localPreparationEnabled
          ? 'localPreparation'
          : 'notConnected'
    );
  };
  readonly inspectionState = (): string =>
    this.stale()
      ? this.t('staleState')
      : this.selectedFeed()
        ? this.pt(engineFeedHealth(this.selectedFeed()!))
        : this.selected() === 'publications'
          ? this.publicationState()
          : this.preflightState();
  readonly consequence = (): string => {
    if (this.stale()) return this.t('staleConsequence');
    if (this.selected() === 'preflight') return this.t('preflightAuthority');
    const data = this.data()?.publications;
    if (!data?.available) return this.t('publicationsUnavailable');
    const feed = this.selectedFeed();
    if (feed) {
      if (feed.mode === 'disabled') return this.t('moduleDisabledConsequence');
      if (!feed.configured || feed.connection !== 'ready')
        return this.t('moduleConnectionConsequence');
      if (feed.paused) return this.t('modulePausedConsequence');
    }
    if (
      data.feeds.length &&
      data.feeds.every((item) => item.mode === 'disabled')
    )
      return this.t('allDisabledConsequence');
    if (!data.workerEnabled) return this.t('workerDisabledConsequence');
    if (!feed && this.attention()) return this.t('dependenciesConsequence');
    return this.t('approvalBoundary');
  };
  motorState(
    feed?: PublicationFeed
  ): 'off' | 'unknown' | 'attention' | 'verified' {
    if (this.stale()) return 'unknown';
    if (feed)
      return feed.mode === 'disabled'
        ? 'off'
        : engineFeedHealth(feed) === 'ready'
          ? 'verified'
          : 'attention';
    const data = this.data()?.publications;
    return !data?.available
      ? 'unknown'
      : this.attention()
        ? 'attention'
        : data.workerEnabled
          ? 'unknown'
          : 'off';
  }
  selectEngine(engine: 'publications' | 'preflight'): void {
    this.selected.set(engine);
    this.selectedFeedId.set(null);
    this.inspectorView.set('overview');
  }
  selectFeed(feed: PublicationFeed): void {
    this.selected.set('publications');
    this.selectedFeedId.set(feed.id);
    this.inspectorView.set('overview');
  }
  private request = 0;
  private destroyed = false;
  readonly attention = computed(
    () =>
      this.data()?.publications.feeds.filter(
        (feed) => engineFeedHealth(feed) !== 'ready'
      ).length ?? 0
  );
  readonly t = (key: string) => this.i18n.t('admin.engineRoom.' + key);
  readonly pt = (key: string) =>
    this.i18n.t('admin.pilotage.publicationHealth.' + key);
  readonly date = (value: string | null): string => {
    if (!value || !Number.isFinite(Date.parse(value)))
      return this.t('notObserved');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  };
  constructor() {
    effect(() => {
      this.measurementContext();
      untracked(() => {
        ++this.request;
        this.data.set(null);
        this.selectedFeedId.set(null);
        this.loading.set(false);
        this.failed.set(false);
        if (this.browser && this.admin.hasValidAdminSession()) void this.load();
      });
    });
    const timer = this.browser
      ? setInterval(() => this.clock.set(Date.now()), 30_000)
      : null;
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.request;
      this.data.set(null);
      if (timer) clearInterval(timer);
    });
  }
  async load(): Promise<void> {
    if (this.destroyed) return;
    const request = ++this.request;
    this.loading.set(true);
    this.failed.set(false);
    this.data.set(null);
    try {
      const data = await this.admin.engineRoom(this.scope());
      if (this.destroyed || request !== this.request) return;
      this.data.set(data);
      if (
        this.selectedFeedId() &&
        !data.publications.feeds.some(
          (feed) => feed.id === this.selectedFeedId()
        )
      )
        this.selectedFeedId.set(null);
      this.clock.set(Date.now());
    } catch (error) {
      if (this.destroyed || request !== this.request) return;
      this.failed.set(true);
      if (error instanceof AdminDashboardRequestError && error.status === 401)
        this.admin.clearAdminSession();
    } finally {
      if (!this.destroyed && request === this.request) this.loading.set(false);
    }
  }
}
