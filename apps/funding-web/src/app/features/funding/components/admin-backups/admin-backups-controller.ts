import { computed, signal } from '@angular/core';
import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import type { AdminBackupsBrowser } from './admin-backups-browser.js';

export interface AdminBackupsPorts {
  readonly admin: Pick<FundingAdminService, 'databaseBackups'>;
  readonly browser: AdminBackupsBrowser;
  sessionGeneration(): number;
  confirm(message: string, target: string): Promise<boolean>;
  cancelConfirmation(): void;
  t(key: string): string;
  onAccessDenied(): void;
  focusRequest(retry: boolean): void;
  focusPanel(): void;
}

/** Owns sanitized backup reads, explicit requests and recovery of the same UUID. */
export class AdminBackupsController {
  readonly data = signal<AdminBackupsResponse | null>(null);
  readonly receipt = signal<AdminDatabaseBackup | null>(null);
  readonly pendingId = signal<string | null>(null);
  readonly uncertain = signal(false);
  readonly missing = signal(false);
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly error = signal('');
  readonly accessDenied = signal(false);
  readonly clock;
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
  readonly trackedJob = computed(
    () =>
      this.data()?.jobs.find((job) =>
        ['queued', 'running', 'unknown'].includes(job.status)
      ) ??
      this.receipt() ??
      (this.data()?.jobs[0]?.status === 'failed' ? this.data()!.jobs[0] : null)
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
  private generation;
  private reconciledGeneration: number | null = null;
  private initialized = false;
  private disposed = false;

  constructor(private readonly ports: AdminBackupsPorts) {
    this.generation = ports.sessionGeneration();
    this.clock = signal(ports.browser.now());
  }

  async initialize(): Promise<void> {
    if (this.disposed || this.initialized) return;
    this.initialized = true;
    this.generation = this.ports.sessionGeneration();
    const id = this.ports.browser.readPendingId();
    if (id) {
      this.pendingId.set(id);
      this.uncertain.set(true);
    }
    await this.refresh();
  }

  reconcileSession(): void {
    const generation = this.ports.sessionGeneration();
    if (
      !this.disposed &&
      generation !== this.generation &&
      generation !== this.reconciledGeneration
    ) {
      this.reconciledGeneration = generation;
      this.rejectAccess('expired', true);
    }
  }

  tick(): void {
    if (!this.disposed) this.clock.set(this.ports.browser.now());
  }

  async refresh(): Promise<void> {
    this.reconcileSession();
    if (
      !this.active() ||
      this.busy() ||
      this.confirming() ||
      this.accessDenied()
    )
      return;
    this.busy.set(true);
    try {
      const data = (await this.ports.admin.databaseBackups(
        this.pendingId() ?? undefined
      )) as AdminBackupsResponse;
      this.reconcileSession();
      if (!this.active()) return;
      this.data.set(data);
      this.error.set('');
      this.tick();
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
      this.reconcileSession();
      if (this.active()) this.failure(error);
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  async request(retry = false): Promise<void> {
    this.reconcileSession();
    if (
      !this.active() ||
      this.accessDenied() ||
      (retry
        ? !this.missing() ||
          !this.pendingId() ||
          this.busy() ||
          this.confirming()
        : !this.canRequest())
    )
      return;
    this.confirming.set(true);
    const accepted = await this.ports.confirm(
      this.ports.t('admin.backups.confirm'),
      this.ports.t('admin.backups.scope')
    );
    if (this.disposed) return;
    this.confirming.set(false);
    this.reconcileSession();
    if (!this.active()) return;
    if (!accepted) {
      this.ports.focusRequest(retry);
      return;
    }
    const requestId = retry
      ? this.pendingId()!
      : this.ports.browser.randomUUID();
    this.remember(requestId);
    this.uncertain.set(true);
    this.missing.set(false);
    this.error.set('');
    this.busy.set(true);
    try {
      const result = (await this.ports.admin.databaseBackups(undefined, {
        requestId,
        confirmation: 'BACKUP_DATABASE'
      })) as AdminDatabaseBackup;
      this.reconcileSession();
      if (!this.active()) return;
      this.receipt.set(result);
      this.uncertain.set(false);
      this.remember(null);
    } catch (error) {
      this.reconcileSession();
      if (this.active()) {
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
      if (!this.disposed) this.busy.set(false);
    }
    if (this.active() && !this.error()) await this.refresh();
    if (this.active()) this.ports.focusPanel();
  }

  dispose(): void {
    this.disposed = true;
    if (this.confirming()) this.ports.cancelConfirmation();
  }

  private active(): boolean {
    return !this.disposed && this.generation === this.ports.sessionGeneration();
  }

  private remember(id: string | null): void {
    this.pendingId.set(id);
    this.ports.browser.writePendingId(id);
  }

  private rejectAccess(
    error: 'expired' | 'forbidden',
    sessionChanged = false
  ): void {
    this.data.set(null);
    this.receipt.set(null);
    this.ports.onAccessDenied();
    this.accessDenied.set(true);
    if (sessionChanged) this.error.set(error);
    this.ports.cancelConfirmation();
    if (!sessionChanged) this.error.set(error);
  }

  private failure(error: unknown): void {
    if (
      error instanceof AdminDashboardRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      this.rejectAccess(error.status === 401 ? 'expired' : 'forbidden');
    } else
      this.error.set(
        error instanceof AdminDashboardRequestError && error.status === 429
          ? 'rateLimit'
          : 'unavailable'
      );
  }
}
