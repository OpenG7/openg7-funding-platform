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
import { DatePipe } from '@angular/common';
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

/** Setup organism: only sanitized metadata and explicit requests pass through the API. */
@Component({
  selector: 'openg7-admin-backups',
  standalone: true,
  imports: [TranslatePipe, DatePipe, RouterLink],
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
  readonly canRequest = computed(
    () =>
      !this.busy() &&
      !this.confirming() &&
      !this.uncertain() &&
      !this.error() &&
      !this.accessDenied() &&
      this.data()?.workerState === 'ready' &&
      this.clock() - Date.parse(this.data()!.checkedAt) < 60000 &&
      !this.data()?.jobs.some((job) =>
        ['queued', 'running', 'unknown'].includes(job.status)
      )
  );

  constructor() {
    effect(() => {
      if (this.admin.sessionGeneration() !== this.generation) {
        this.data.set(null);
        this.receipt.set(null);
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
