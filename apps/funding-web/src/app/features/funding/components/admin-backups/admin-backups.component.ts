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
import type { AdminDatabaseBackup } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { createAdminBackupsBrowser } from './admin-backups-browser.js';
import { AdminBackupsController } from './admin-backups-controller.js';

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
  readonly expanded = signal(false);
  readonly drawer = signal<'activation' | 'recovery' | 'proof' | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly guideSteps = ['destination', 'key', 'verify'] as const;
  readonly recoverySteps = ['isolate', 'choose', 'restore'] as const;
  private readonly controller = new AdminBackupsController({
    admin: {
      databaseBackups: (requestId, payload) =>
        this.admin.databaseBackups(requestId, payload)
    },
    browser: createAdminBackupsBrowser(),
    sessionGeneration: () => this.admin.sessionGeneration(),
    confirm: (message, target) => this.confirmation.confirm(message, target),
    cancelConfirmation: () => this.confirmation.answer(false),
    t: (key) => this.i18n.t(key),
    onAccessDenied: () => {
      this.drawer.set(null);
      this.selectedId.set(null);
    },
    focusRequest: (retry) =>
      afterNextRender(
        () =>
          (retry
            ? this.retryButton()
            : this.requestButton()
          )?.nativeElement.focus(),
        { injector: this.injector }
      ),
    focusPanel: () =>
      afterNextRender(() => this.panel()?.nativeElement.focus(), {
        injector: this.injector
      })
  });
  readonly data = this.controller.data;
  readonly receipt = this.controller.receipt;
  readonly pendingId = this.controller.pendingId;
  readonly uncertain = this.controller.uncertain;
  readonly missing = this.controller.missing;
  readonly busy = this.controller.busy;
  readonly confirming = this.controller.confirming;
  readonly error = this.controller.error;
  readonly accessDenied = this.controller.accessDenied;
  readonly clock = this.controller.clock;
  readonly fresh = this.controller.fresh;
  readonly serviceState = this.controller.serviceState;
  readonly lastSuccess = this.controller.lastSuccess;
  readonly trackedJob = this.controller.trackedJob;
  readonly canRequest = this.controller.canRequest;
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

  constructor() {
    effect(() => this.controller.reconcileSession());
    this.destroy.onDestroy(() => this.controller.dispose());
    afterNextRender(() => {
      void this.controller.initialize();
      const timer = this.zone.runOutsideAngular(() =>
        setInterval(() => {
          this.controller.tick();
          if (!document.hidden && !this.accessDenied()) void this.refresh();
        }, 15000)
      );
      this.destroy.onDestroy(() => clearInterval(timer));
    });
  }
  refresh(): Promise<void> {
    return this.controller.refresh();
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
  request(retry = false): Promise<void> {
    return this.controller.request(retry);
  }
}
