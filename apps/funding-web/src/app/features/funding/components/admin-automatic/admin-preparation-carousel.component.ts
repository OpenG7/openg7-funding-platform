import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import type {
  AdminAutomaticRun,
  AdminPreparationReceipt,
  AdminPreparationApproveRequest
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminPreparationReceiptComponent } from '../admin-preparation/admin-preparation-receipt.component.js';
import {
  type AdminPreparationError,
  isPreparationConfigurationError,
  preparationError
} from '../admin-preparation/admin-preparation-error.js';

import { AdminAutomaticPortfolioClient } from './admin-automatic-portfolio.client.js';

/** One current server receipt; browsing and preparation approval never drive the run. */
@Component({
  selector: 'openg7-admin-preparation-carousel',
  standalone: true,
  imports: [AdminIconComponent, AdminPreparationReceiptComponent],
  templateUrl: './admin-preparation-carousel.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-preparation-carousel.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPreparationCarouselComponent {
  readonly run = input.required<AdminAutomaticRun>();
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly receipt = signal<AdminPreparationReceipt | null>(null);
  readonly position = signal(1);
  readonly loading = signal(false);
  readonly approving = signal(false);
  readonly error = signal<AdminPreparationError | null>(null);
  readonly uncertain = signal(false);
  readonly canApprove = computed(
    () =>
      this.receipt()?.canApprove === true &&
      this.receipt()?.status !== 'approved' &&
      this.admin.identity()?.role !== 'reader' &&
      !this.loading() &&
      !this.approving() &&
      !this.uncertain() &&
      !isPreparationConfigurationError(this.error())
  );
  private readonly client = new AdminAutomaticPortfolioClient(this.admin);
  private runId = '';
  private identity = '';
  private serial = 0;
  private approvalSerial = 0;
  private disposed = false;
  private command: AdminPreparationApproveRequest | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      ++this.serial;
      ++this.approvalSerial;
    });
    effect(() => {
      const run = this.run();
      const identity = this.identityKey();
      untracked(() => {
        if (run.id !== this.runId || identity !== this.identity) {
          this.runId = run.id;
          this.identity = identity;
          ++this.approvalSerial;
          this.approving.set(false);
          this.command = null;
          this.receipt.set(null);
          this.position.set(
            Math.max(1, Math.min(run.dossierCount, run.processedCount || 1))
          );
        }
        if (!this.admin.hasValidAdminSession()) {
          ++this.serial;
          this.receipt.set(null);
          this.loading.set(false);
          this.error.set('forbidden');
          return;
        }
        void this.load();
      });
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }

  portfolioText(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.' + key, params);
  }

  go(offset: number): void {
    if (this.loading() || this.approving()) return;
    const next = this.position() + offset;
    if (next < 1 || next > this.run().dossierCount) return;
    this.position.set(next);
    this.command = null;
    void this.load();
  }

  async load(preserveError = false): Promise<void> {
    const ticket = ++this.serial;
    const runId = this.runId;
    const identity = this.identity;
    const position = this.position();
    this.loading.set(true);
    this.receipt.set(null);
    if (!preserveError) this.error.set(null);
    try {
      const receipt = await this.client.preparation(runId, position);
      if (!this.current(runId, identity) || ticket !== this.serial) return;
      if (receipt.runId !== runId || receipt.position !== position)
        throw new Error('PREPARATION_RESPONSE_MISMATCH');
      this.receipt.set(receipt);
      this.uncertain.set(false);
    } catch (error) {
      if (!this.current(runId, identity) || ticket !== this.serial) return;
      this.error.set(preparationError(error, 'read'));
    } finally {
      if (ticket === this.serial) this.loading.set(false);
    }
  }

  async approve(receipt: AdminPreparationReceipt): Promise<void> {
    if (!this.canApprove() || this.receipt() !== receipt) return;
    const ticket = ++this.approvalSerial;
    const identity = this.identity;
    if (
      !this.command ||
      this.command.runId !== receipt.runId ||
      this.command.contributionId !== receipt.contributionId ||
      this.command.expectedVersion !== receipt.version
    ) {
      this.command = {
        runId: receipt.runId,
        contributionId: receipt.contributionId,
        expectedVersion: receipt.version,
        requestId: crypto.randomUUID(),
        confirmed: true
      };
    }
    this.approving.set(true);
    this.error.set(null);
    try {
      const result = await this.client.approvePreparation(this.command);
      if (
        !this.current(receipt.runId, identity) ||
        ticket !== this.approvalSerial
      )
        return;
      if (
        result.contributionId !== receipt.contributionId ||
        result.runId !== receipt.runId
      )
        throw new Error('PREPARATION_RESPONSE_MISMATCH');
      // A run refresh may have started a read before this approval committed.
      ++this.serial;
      this.loading.set(false);
      this.receipt.set(result);
      this.command = null;
    } catch (error) {
      if (
        !this.current(receipt.runId, identity) ||
        ticket !== this.approvalSerial
      )
        return;
      const failure = error as { status?: number };
      this.error.set(preparationError(error, 'approve'));
      this.uncertain.set(!failure.status || failure.status >= 500);
      if (failure.status === 401 || failure.status === 403)
        this.receipt.set(null);
      else await this.load(true);
    } finally {
      if (ticket === this.approvalSerial) this.approving.set(false);
    }
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }

  private current(runId: string, identity: string): boolean {
    return (
      !this.disposed &&
      runId === this.runId &&
      identity === this.identityKey() &&
      this.admin.hasValidAdminSession()
    );
  }
}
