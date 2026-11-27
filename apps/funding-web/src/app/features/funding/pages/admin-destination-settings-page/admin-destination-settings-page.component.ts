import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeedSettings
} from '@openg7/funding-core';

import {
  publicationFeedSettingsSnapshot,
  samePublicationFeedSettings
} from '../../../../../../../../packages/funding-core/src/index.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminPublicationAutomationCommandWorkflow } from '../../components/admin-publications/admin-publication-automation-command-workflow.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { EngineMotorComponent } from '../admin-engine-room-page/engine-motor.component.js';
import { PublicationAutomationReadController } from '../admin-publication-automation-page/publication-automation-read-controller.js';

type DestinationWriteContext = ReturnType<
  PublicationAutomationReadController['captureCommandContext']
> & { identity: string };

type DestinationSettingsCommand = Extract<
  PublicationAutomationCommand,
  { action: 'settings' }
> & { expectedSettings: PublicationFeedSettings };

/** Routed destination maintenance. Commands retain the existing server authorization boundary. */
@Component({
  selector: 'openg7-admin-destination-settings-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TranslatePipe,
    AdminLayoutComponent,
    EngineMotorComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-destination-settings-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-destination-settings-page.component.css'
  ]
})
export class AdminDestinationSettingsPageComponent {
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap
  });
  readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
  readonly id = computed(() => this.params().get('feedId'));
  readonly context = computed(() => ({
    sponsorshipId: this.query().get('sponsorshipId'),
    deliveryId: this.query().get('deliveryId'),
    decisionId: this.query().get('decisionId'),
    feedId: this.id()
  }));
  readonly busy = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly sessionLost = signal(false);
  readonly loginReturnUrl = () => this.router.url;
  readonly writePending = signal<DestinationSettingsCommand | null>(null);
  readonly writeConflict = signal(false);
  readonly retryAllowed = signal(false);
  private readonly settingsReference = signal<PublicationFeedSettings | null>(
    null
  );
  readonly tab = computed(() => {
    const tab = this.query().get('tab') ?? '';
    return this.tabs.includes(tab) ? tab : 'configuration';
  });
  readonly readAt = signal<string | null>(null);
  private readonly clock = signal(0);
  readonly stale = computed(() => {
    const readAt = this.readAt();
    return !!readAt && this.clock() - Date.parse(readAt) > 180_000;
  });
  readonly tabs = [
    'configuration',
    'access',
    'rules',
    'executions',
    'diagnostics'
  ];
  readonly days = [1, 2, 3, 4, 5, 6, 0];
  readonly canWrite = computed(
    () =>
      this.admin.hasValidAdminSession() &&
      ['owner', 'operator'].includes(this.admin.identity()?.role ?? 'owner')
  );
  readonly form = new FormGroup({
    autoPrepare: new FormControl(false, { nonNullable: true }),
    weekdays: new FormControl<number[]>([], {
      nonNullable: true,
      validators: [Validators.required]
    }),
    localTime: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
      ]
    }),
    timezone: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        (control) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: control.value });
            return null;
          } catch {
            return { timezone: true };
          }
        }
      ]
    }),
    capacity: new FormControl(1, {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(1),
        Validators.max(10),
        Validators.pattern(/^\d+$/)
      ]
    }),
    horizonDays: new FormControl(1, {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(1),
        Validators.max(28),
        Validators.pattern(/^\d+$/)
      ]
    })
  });
  private readonly reader = new PublicationAutomationReadController({
    api: {
      read: async () =>
        (await this.admin.publicationAutomation()) as PublicationAutomationState
    },
    clearError: () => this.error.set(''),
    showError: (error) => {
      if (!this.handleExpiredSession(error))
        this.error.set('admin.destinationSettings.readError');
    },
    busy: () => this.busy(),
    workerChanging: () => false,
    selected: () => false,
    composing: () => false,
    settings: () => true
  });
  readonly feed = computed(
    () =>
      this.reader.state()?.feeds.find((feed) => feed.id === this.id()) ?? null
  );
  readonly executions = computed(
    () =>
      this.reader
        .state()
        ?.deliveries.filter((delivery) => delivery.feedId === this.id()) ?? []
  );
  readonly reliability = computed(() => this.reader.state()?.reliability);
  readonly incidents = computed(() => {
    const ids = new Set(this.executions().map((delivery) => delivery.id));
    return (
      this.reliability()?.incidents.filter(
        (incident) => incident.deliveryId && ids.has(incident.deliveryId)
      ) ?? []
    );
  });
  operationsParams(
    tab: string,
    deliveryId?: string
  ): Record<string, string | null> {
    return {
      feedId: this.id(),
      tab,
      ...(deliveryId ? { deliveryId } : {}),
      returnFeedId: this.id(),
      returnTab: this.tab(),
      returnSponsorshipId: this.context().sponsorshipId,
      returnDeliveryId: this.context().deliveryId,
      returnDecisionId: this.context().decisionId
    };
  }
  selectTab(tab: string): void {
    if (this.tabs.includes(tab))
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
  }
  readonly name = computed(() => {
    const feed = this.feed();
    return feed
      ? `${feed.id.endsWith('facebook') ? 'Facebook' : 'LinkedIn'} · ${feed.id.split(':')[0].toUpperCase()}`
      : this.id();
  });
  private readonly workflow = new AdminPublicationAutomationCommandWorkflow({
    api: {
      execute: async (command) =>
        (await this.admin.publicationAutomation(command)) as { id?: string },
      read: async () =>
        (await this.admin.publicationAutomation()) as PublicationAutomationState
    },
    state: { busy: this.busy, error: this.error, notice: this.notice },
    capture: () => this.reader.captureCommandContext(),
    isCurrent: (context) => this.reader.isCurrent(context),
    applyState: (next) => {
      this.reader.applyConfirmedState(next);
      this.markRead();
    },
    showError: (error) => {
      if (!this.handleExpiredSession(error))
        this.error.set('admin.destinationSettings.commandError');
    },
    confirmed: (command) => {
      if (command.action === 'settings') this.reset();
    }
  });
  private loadGeneration = 0;
  constructor() {
    const destroy = inject(DestroyRef);
    this.form.valueChanges
      .pipe(takeUntilDestroyed(destroy))
      .subscribe(() => this.notice.set(''));
    destroy.onDestroy(() => this.reader.dispose());
    effect(() => {
      const writable = this.canWrite();
      const busy = this.busy();
      const pending = this.writePending();
      untracked(() =>
        writable && !busy && !pending
          ? this.form.enable({ emitEvent: false })
          : this.form.disable({ emitEvent: false })
      );
    });
    afterNextRender(() => {
      effect(
        () => {
          this.id();
          this.admin.sessionGeneration();
          this.admin.identity();
          const valid = this.admin.hasValidAdminSession();
          untracked(() => {
            ++this.loadGeneration;
            this.reader.beginContext({});
            this.readAt.set(null);
            this.writePending.set(null);
            this.writeConflict.set(false);
            this.retryAllowed.set(false);
            this.settingsReference.set(null);
            this.form.reset();
            this.notice.set('');
            this.error.set('');
            if (valid) {
              this.sessionLost.set(false);
              void this.load(true);
            } else this.loading.set(false);
          });
        },
        { injector: this.injector }
      );
      const timer = setInterval(() => this.clock.set(Date.now()), 30_000);
      destroy.onDestroy(() => clearInterval(timer));
    });
  }
  private readonly injector = inject(Injector);
  async load(contextChanged = false): Promise<void> {
    if (
      !contextChanged &&
      (this.busy() || this.form.dirty || this.writePending())
    )
      return;
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    const loaded = await this.reader.load();
    if (loaded) {
      this.reset();
      this.markRead();
    } else if (generation === this.loadGeneration) this.readAt.set(null);
    if (!this.reader.isDisposed() && generation === this.loadGeneration)
      this.loading.set(false);
  }
  private markRead(): void {
    this.readAt.set(new Date().toISOString());
    this.clock.set(Date.now());
  }
  reset(): void {
    const feed = this.feed();
    if (!feed) return;
    if (this.writePending()) return;
    this.settingsReference.set(publicationFeedSettingsSnapshot(feed));
    this.writeConflict.set(false);
    this.form.reset({
      autoPrepare: feed.autoPrepare,
      weekdays: [...feed.weekdays],
      localTime: feed.localTime,
      timezone: feed.timezone,
      capacity: feed.capacity,
      horizonDays: feed.horizonDays
    });
  }
  toggleDay(day: number): void {
    const control = this.form.controls.weekdays;
    control.setValue(
      control.value.includes(day)
        ? control.value.filter((value) => value !== day)
        : [...control.value, day]
    );
    control.markAsDirty();
  }
  save(): void {
    const feed = this.feed();
    const expectedSettings = this.settingsReference();
    this.form.markAllAsTouched();
    if (
      !feed ||
      !expectedSettings ||
      this.form.invalid ||
      !this.canWrite() ||
      this.busy() ||
      this.writePending() ||
      this.writeConflict()
    )
      return;
    const settings: PublicationFeedSettings = {
      id: feed.id,
      paused: expectedSettings.paused,
      ...this.form.getRawValue()
    };
    void this.submitSettings({
      action: 'settings',
      settings,
      expectedSettings
    });
  }
  check(): void {
    const feed = this.feed();
    if (feed && !this.writePending())
      void this.run({ action: 'check', feedId: feed.id });
  }
  async togglePause(): Promise<void> {
    const feed = this.feed();
    if (
      !feed ||
      this.form.dirty ||
      this.writePending() ||
      this.writeConflict() ||
      !feed.configured ||
      feed.mode === 'disabled' ||
      !this.canWrite() ||
      this.busy()
    )
      return;
    if (
      !(await this.confirmation.confirm(
        this.t('pauseConfirm'),
        this.t(feed.paused ? 'resume' : 'pause')
      ))
    )
      return;
    if (this.feed() !== feed || !this.canWrite()) return;
    const {
      id,
      autoPrepare,
      weekdays,
      localTime,
      timezone,
      capacity,
      horizonDays
    } = feed;
    await this.submitSettings({
      action: 'settings',
      expectedSettings: publicationFeedSettingsSnapshot(feed),
      settings: {
        id,
        autoPrepare,
        weekdays: [...weekdays],
        localTime,
        timezone,
        capacity,
        horizonDays,
        paused: !feed.paused
      }
    });
  }
  private writeIdentity(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id}:${identity?.sessionId}:${identity?.role}`;
  }
  private handleExpiredSession(error: unknown): boolean {
    if (!(error instanceof AdminDashboardRequestError) || error.status !== 401)
      return false;
    this.sessionLost.set(true);
    this.writePending.set(null);
    this.retryAllowed.set(false);
    this.notice.set('');
    this.admin.clearAdminSession();
    return true;
  }
  private captureWriteContext(): DestinationWriteContext {
    return {
      ...this.reader.captureCommandContext(),
      identity: this.writeIdentity()
    };
  }
  private isWriteCurrent(context: DestinationWriteContext): boolean {
    return (
      this.admin.hasValidAdminSession() &&
      this.canWrite() &&
      context.identity === this.writeIdentity() &&
      this.reader.isCurrent(context)
    );
  }
  private async submitSettings(
    command: DestinationSettingsCommand
  ): Promise<boolean> {
    if (
      !this.canWrite() ||
      this.busy() ||
      this.loading() ||
      this.reader.isDisposed()
    )
      return false;
    const context = this.captureWriteContext();
    this.busy.set(true);
    this.writePending.set(command);
    this.retryAllowed.set(false);
    this.error.set('');
    this.notice.set('');
    let uncertain = false;
    let rejected = '';
    try {
      try {
        await this.admin.publicationAutomation(command);
      } catch (error) {
        if (this.handleExpiredSession(error)) return false;
        uncertain = true;
        const code = error instanceof Error ? error.message : '';
        if (
          [
            'SETTINGS_CONFLICT',
            'INVALID_SETTINGS',
            'INVALID_TIMEZONE',
            'FEED_NOT_FOUND'
          ].includes(code)
        )
          rejected = code;
      }
      if (!this.isWriteCurrent(context)) return false;
      if (rejected) {
        this.writePending.set(null);
        this.writeConflict.set(rejected === 'SETTINGS_CONFLICT');
        this.error.set(
          rejected === 'SETTINGS_CONFLICT'
            ? 'admin.destinationSettings.conflict'
            : 'admin.destinationSettings.commandError'
        );
        // Preserve both the draft and its original precondition on a conflict.
        try {
          const next =
            (await this.admin.publicationAutomation()) as PublicationAutomationState;
          if (this.isWriteCurrent(context)) {
            this.reader.applyConfirmedState(next);
            this.markRead();
          }
        } catch (error) {
          this.handleExpiredSession(error);
          /* The rejection remains authoritative even when its reread fails. */
        }
        return false;
      }
      return await this.settleSettings(command, context, uncertain);
    } finally {
      this.busy.set(false);
    }
  }
  private async settleSettings(
    command: DestinationSettingsCommand,
    context: DestinationWriteContext,
    uncertain: boolean
  ): Promise<boolean> {
    try {
      const next =
        (await this.admin.publicationAutomation()) as PublicationAutomationState;
      if (!this.isWriteCurrent(context)) return false;
      this.reader.applyConfirmedState(next);
      this.markRead();
      const saved = next.feeds.find((feed) => feed.id === command.settings.id);
      if (saved && samePublicationFeedSettings(saved, command.settings)) {
        this.writePending.set(null);
        this.retryAllowed.set(false);
        this.reset();
        this.error.set('');
        this.notice.set(
          uncertain
            ? 'admin.destinationSettings.settingsObserved'
            : 'admin.publicationAutomation.saved'
        );
        return true;
      }
      if (
        saved &&
        samePublicationFeedSettings(saved, command.expectedSettings)
      ) {
        this.retryAllowed.set(true);
        this.error.set('admin.destinationSettings.uncertain');
      } else {
        this.writePending.set(null);
        this.writeConflict.set(true);
        this.error.set('admin.destinationSettings.conflict');
      }
    } catch (error) {
      if (this.handleExpiredSession(error)) return false;
      if (this.isWriteCurrent(context))
        this.error.set('admin.destinationSettings.uncertain');
    }
    return false;
  }
  async reconcileSettings(): Promise<void> {
    const command = this.writePending();
    if (!command || this.busy()) return;
    const context = this.captureWriteContext();
    this.busy.set(true);
    this.retryAllowed.set(false);
    try {
      await this.settleSettings(command, context, true);
    } finally {
      this.busy.set(false);
    }
  }
  retrySettings(): void {
    const command = this.writePending();
    if (command && this.retryAllowed()) void this.submitSettings(command);
  }
  async reloadSettings(): Promise<void> {
    if (this.busy() || this.writePending()) return;
    if (
      this.form.dirty &&
      !(await this.confirmation.confirm(this.t('discard'), this.t('title')))
    )
      return;
    await this.load(true);
  }
  private run(command: PublicationAutomationCommand): Promise<boolean> {
    if (!this.canWrite() || this.loading() || this.reader.isDisposed())
      return Promise.resolve(false);
    return this.workflow.run(command);
  }
  async canLeave(): Promise<boolean> {
    if (!this.admin.hasValidAdminSession()) return true;
    if (this.busy()) return false;
    return (
      (!this.form.dirty && !this.writePending()) ||
      (await this.confirmation.confirm(this.t('discard'), this.t('title')))
    );
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty || this.busy() || this.writePending()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  readonly t = (key: string) => this.i18n.t('admin.destinationSettings.' + key);
  date(value: string | null): string {
    return value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(value))
      : this.t('unknown');
  }
}
