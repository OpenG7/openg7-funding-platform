import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';

import {
  FundingAdminService,
  AdminDashboardRequestError
} from '../../services/funding-admin.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Setup organism: only sanitized metadata and explicit requests pass through the API. */
@Component({
  selector: 'openg7-admin-backups',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminDrawerComponent,
    AdminIconComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-backups.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-backups.component.css'
  ]
})
export class AdminBackupsComponent {
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  private readonly destroy = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly requestButton =
    viewChild<ElementRef<HTMLButtonElement>>('requestButton');
  private readonly retryButton =
    viewChild<ElementRef<HTMLButtonElement>>('retryButton');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly storageKey = 'openg7-backup-request';
  private generation = this.admin.sessionGeneration();
  readonly data = signal<AdminBackupsResponse | null>(null);
  readonly receipt = signal<AdminDatabaseBackup | null>(null);
  readonly pendingId = signal<string | null>(null);
  readonly uncertain = signal(false);
  readonly missing = signal(false);
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly error = signal('');
  readonly accessDenied = signal(false);
  readonly clock = signal(Date.now());
  readonly expanded = signal(false);
  readonly drawer = signal<'activation' | 'recovery' | 'proof' | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly guideSteps = ['destination', 'key', 'verify'] as const;
  readonly recoverySteps = ['isolate', 'choose', 'restore'] as const;
  readonly fresh = computed(() => {
    const checked = Date.parse(this.data()?.checkedAt ?? '');
    const age = this.clock() - checked;
    return !this.error() && Number.isFinite(age) && age >= -5000 && age < 60000;
  });
  readonly serviceState = computed(() => {
    if (this.error()) return 'unavailable';
    if (!this.data()) return 'loading';
    return this.fresh() ? this.data()!.workerState : 'stale';
  });
  readonly lastSuccess = computed(
    () => this.data()?.jobs.find((job) => job.status === 'succeeded') ?? null
  );
  readonly visibleJobs = computed(() =>
    this.expanded()
      ? (this.data()?.jobs ?? [])
      : (this.data()?.jobs ?? []).slice(0, 5)
  );
  readonly selectedJob = computed(
    () =>
      this.data()?.jobs.find((job) => job.requestId === this.selectedId()) ??
      null
  );
  readonly trackedJob = computed(
    () =>
      this.data()?.jobs.find((job) =>
        ['queued', 'running', 'unknown'].includes(job.status)
      ) ??
      this.receipt() ??
      (this.data()?.jobs[0]?.status === 'failed' ? this.data()!.jobs[0] : null)
  );
  readonly drawerTitle = computed(() =>
    this.i18n.t(
      'admin.backups.' +
        (this.drawer() === 'activation'
          ? 'activationTitle'
          : this.drawer() === 'recovery'
            ? 'recoveryTitle'
            : 'proof')
    )
  );
  readonly canRequest = computed(
    () =>
      !this.busy() &&
      !this.confirming() &&
      !this.uncertain() &&
      !this.error() &&
      !this.accessDenied() &&
      this.data()?.workerState === 'ready' &&
      this.fresh() &&
      !this.data()?.jobs.some((job) =>
        ['queued', 'running', 'unknown'].includes(job.status)
      )
  );

  constructor() {
    effect(() => {
      if (this.admin.sessionGeneration() !== this.generation) {
        this.data.set(null);
        this.receipt.set(null);
        this.drawer.set(null);
        this.selectedId.set(null);
        this.accessDenied.set(true);
        this.error.set('expired');
        this.confirmation.answer(false);
      }
    });
    afterNextRender(() => {
      this.generation = this.admin.sessionGeneration();
      try {
        const id = sessionStorage.getItem(this.storageKey);
        if (id && /^[a-f0-9-]{36}$/i.test(id)) {
          this.pendingId.set(id);
          this.uncertain.set(true);
        }
      } catch {
        /* The server still deduplicates requests when storage is unavailable. */
      }
      void this.refresh();
      const timer = this.zone.runOutsideAngular(() =>
        setInterval(() => {
          this.clock.set(Date.now());
          if (!document.hidden && !this.accessDenied()) void this.refresh();
        }, 15000)
      );
      this.destroy.onDestroy(() => clearInterval(timer));
    });
  }
  private active() {
    return (
      !this.destroy.destroyed &&
      this.generation === this.admin.sessionGeneration()
    );
  }
  private remember(id: string | null) {
    this.pendingId.set(id);
    try {
      if (id) sessionStorage.setItem(this.storageKey, id);
      else sessionStorage.removeItem(this.storageKey);
    } catch {
      /* Optional browser recovery. */
    }
  }
  private failure(error: unknown) {
    if (
      error instanceof AdminDashboardRequestError &&
      [401, 403].includes(error.status)
    ) {
      this.data.set(null);
      this.receipt.set(null);
      this.drawer.set(null);
      this.selectedId.set(null);
      this.accessDenied.set(true);
      this.confirmation.answer(false);
      this.error.set(error.status === 401 ? 'expired' : 'forbidden');
    } else
      this.error.set(
        error instanceof AdminDashboardRequestError && error.status === 429
          ? 'rateLimit'
          : 'unavailable'
      );
  }
  async refresh() {
    if (this.busy() || this.confirming() || this.accessDenied()) return;
    this.busy.set(true);
    try {
      const data = (await this.admin.databaseBackups(
        this.pendingId() ?? undefined
      )) as AdminBackupsResponse;
      if (!this.active()) return;
      this.data.set(data);
      this.error.set('');
      this.clock.set(Date.now());
      if (this.pendingId()) {
        if (data.request) {
          this.receipt.set(data.request);
          this.uncertain.set(false);
          this.missing.set(false);
          this.remember(null);
        } else {
          this.uncertain.set(true);
          this.missing.set(true);
        }
      } else if (this.receipt()) {
        this.receipt.set(
          data.jobs.find(
            (job) => job.requestId === this.receipt()?.requestId
          ) ?? this.receipt()
        );
      }
    } catch (error) {
      if (!this.destroy.destroyed) this.failure(error);
    } finally {
      this.busy.set(false);
    }
  }
  inspect(job: AdminDatabaseBackup) {
    this.selectedId.set(job.requestId);
    this.drawer.set('proof');
  }
  dateLabel(iso: string | null): string {
    if (!iso || !Number.isFinite(Date.parse(iso)))
      return this.i18n.t('admin.backups.noValue');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(iso));
  }
  relativeLabel(iso: string | null): string {
    if (!iso || !Number.isFinite(Date.parse(iso)))
      return this.i18n.t('admin.backups.noValue');
    const minutes = Math.trunc((Date.parse(iso) - this.clock()) / 60000);
    const unit =
      Math.abs(minutes) < 60
        ? 'minute'
        : Math.abs(minutes) < 1440
          ? 'hour'
          : 'day';
    const value =
      unit === 'minute'
        ? minutes
        : Math.trunc(minutes / (unit === 'hour' ? 60 : 1440));
    return new Intl.RelativeTimeFormat(this.i18n.currentLanguage(), {
      numeric: 'auto'
    }).format(value, unit);
  }
  sizeLabel(bytes: number | null): string {
    if (bytes === null) return this.i18n.t('admin.backups.noValue');
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
    const index = Math.min(
      3,
      Math.max(0, Math.floor(Math.log10(Math.max(1, bytes)) / 3))
    );
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'unit',
      unit: units[index],
      unitDisplay: 'short',
      maximumFractionDigits: 1
    }).format(bytes / 1000 ** index);
  }
  async request(retry = false) {
    if (
      retry
        ? !this.missing() ||
          !this.pendingId() ||
          this.busy() ||
          this.confirming() ||
          this.accessDenied()
        : !this.canRequest()
    )
      return;
    this.confirming.set(true);
    const accepted = await this.confirmation.confirm(
      this.i18n.t('admin.backups.confirm'),
      this.i18n.t('admin.backups.scope')
    );
    this.confirming.set(false);
    if (!this.active()) return;
    if (!accepted) {
      afterNextRender(
        () =>
          (retry
            ? this.retryButton()
            : this.requestButton()
          )?.nativeElement.focus(),
        { injector: this.injector }
      );
      return;
    }
    const requestId = retry ? this.pendingId()! : crypto.randomUUID();
    this.remember(requestId);
    this.uncertain.set(true);
    this.missing.set(false);
    this.error.set('');
    this.busy.set(true);
    try {
      const result = (await this.admin.databaseBackups(undefined, {
        requestId,
        confirmation: 'BACKUP_DATABASE'
      })) as AdminDatabaseBackup;
      if (!this.active()) return;
      this.receipt.set(result);
      this.uncertain.set(false);
      this.remember(null);
    } catch (error) {
      if (!this.destroy.destroyed) {
        this.failure(error);
        if (
          error instanceof AdminDashboardRequestError &&
          [400, 409, 429].includes(error.status)
        ) {
          this.uncertain.set(false);
          this.remember(null);
        }
      }
    } finally {
      this.busy.set(false);
    }
    if (this.active() && !this.error()) await this.refresh();
    if (this.active())
      afterNextRender(() => this.panel()?.nativeElement.focus(), {
        injector: this.injector
      });
  }
}
