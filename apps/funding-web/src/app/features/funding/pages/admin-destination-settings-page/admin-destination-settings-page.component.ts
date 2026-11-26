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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeedSettings
} from '@openg7/funding-core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminPublicationAutomationCommandWorkflow } from '../../components/admin-publications/admin-publication-automation-command-workflow.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { EngineMotorComponent } from '../admin-engine-room-page/engine-motor.component.js';
import { PublicationAutomationReadController } from '../admin-publication-automation-page/publication-automation-read-controller.js';

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
  readonly tab = signal('configuration');
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
    showError: () => this.error.set('admin.destinationSettings.readError'),
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
    applyState: (next) => this.reader.applyConfirmedState(next),
    showError: () => this.error.set('admin.destinationSettings.commandError'),
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
      untracked(() =>
        writable && !busy
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
            this.form.reset();
            this.notice.set('');
            this.error.set('');
            if (valid) void this.load();
            else this.loading.set(false);
          });
        },
        { injector: this.injector }
      );
    });
  }
  private readonly injector = inject(Injector);
  async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    const loaded = await this.reader.load();
    if (loaded) this.reset();
    if (!this.reader.isDisposed() && generation === this.loadGeneration)
      this.loading.set(false);
  }
  reset(): void {
    const feed = this.feed();
    if (!feed) return;
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
    this.form.markAllAsTouched();
    if (!feed || this.form.invalid || !this.canWrite() || this.busy()) return;
    const settings: PublicationFeedSettings = {
      id: feed.id,
      paused: feed.paused,
      ...this.form.getRawValue()
    };
    void this.run({ action: 'settings', settings });
  }
  check(): void {
    const feed = this.feed();
    if (feed) void this.run({ action: 'check', feedId: feed.id });
  }
  async togglePause(): Promise<void> {
    const feed = this.feed();
    if (
      !feed ||
      this.form.dirty ||
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
    await this.run({
      action: 'settings',
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
  private run(command: PublicationAutomationCommand): Promise<boolean> {
    if (!this.canWrite() || this.loading() || this.reader.isDisposed())
      return Promise.resolve(false);
    return this.workflow.run(command);
  }
  async canLeave(): Promise<boolean> {
    if (!this.admin.hasValidAdminSession()) return true;
    if (this.busy()) return false;
    return (
      !this.form.dirty ||
      (await this.confirmation.confirm(this.t('discard'), this.t('title')))
    );
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty || this.busy()) {
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
