import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
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
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminPreparationReceiptComponent } from '../admin-preparation/admin-preparation-receipt.component.js';
import {
  projectPreparationPilot,
  reconcilePreparationIssue
} from '../admin-preparation/preparation-pilot.projection.js';
import { capturePreparationFocus } from '../admin-preparation/preparation-focus.js';
import { PreparationAssistanceSummaryController } from '../admin-preparation/preparation-assistance-summary.controller.js';
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
  readonly selectedIssueId = signal<string | null>(null);
  readonly canAssist = computed(
    () =>
      this.admin.hasValidAdminSession() &&
      (!this.admin.identity() || this.admin.identity()?.role === 'owner')
  );
  private readonly document = inject(DOCUMENT);
  readonly assistance = new PreparationAssistanceSummaryController({
    admin: this.admin,
    identity: () => this.identityKey(),
    permitted: () => this.canAssist(),
    visible: () => this.document.visibilityState !== 'hidden',
    unauthorized: () => this.admin.clearAdminSession()
  });
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
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private restoreFocus: (() => void) | null = null;
  private observedRevision = this.admin.dataRevision();
  private pendingRevision = -1;
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
      this.assistance.dispose();
    });
    effect(() => {
      const receipt = this.receipt(),
        loading = this.loading(),
        permitted = this.canAssist(),
        identity = this.identityKey(),
        revision = this.admin.dataRevision();
      untracked(() => {
        void identity;
        if (permitted && !receipt && loading) return;
        const applicable = receipt?.checks.some(
          (check) =>
            check.code === 'accepted_offer' && check.state !== 'not_required'
        );
        this.assistance.select(
          permitted && applicable ? receipt!.contributionId : '',
          String(revision)
        );
      });
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
          this.selectedIssueId.set(null);
          this.restoreFocus = null;
          this.pendingRevision = -1;
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
    effect(() => {
      const revision = this.admin.dataRevision();
      untracked(() => {
        if (revision === this.observedRevision) return;
        if (this.approving()) {
          this.pendingRevision = revision;
          return;
        }
        this.observedRevision = revision;
        if (
          (this.receipt() || this.loading()) &&
          !this.approving() &&
          this.admin.hasValidAdminSession()
        )
          void this.load();
      });
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }
  refresh(): void {
    void this.assistance.load();
    void this.load();
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
    this.selectedIssueId.set(null);
    this.restoreFocus = null;
    void this.load();
  }

  async load(preserveError = false): Promise<void> {
    this.restoreFocus ??= capturePreparationFocus(this.element.nativeElement);
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
      this.receive(receipt);
      this.uncertain.set(false);
    } catch (error) {
      if (!this.current(runId, identity) || ticket !== this.serial) return;
      this.error.set(preparationError(error, 'read'));
    } finally {
      if (ticket === this.serial) this.loading.set(false);
    }
  }

  async confirmAndApprove(receipt: AdminPreparationReceipt): Promise<void> {
    if (!this.canApprove() || this.receipt() !== receipt) return;
    const confirmed = await this.confirmation.confirm(
      this.t('pilot.confirm', {
        reference: receipt.reference,
        version: receipt.version.slice(0, 8)
      }),
      receipt.reference
    );
    if (confirmed) await this.approve(receipt);
  }

  private receive(receipt: AdminPreparationReceipt): void {
    this.selectedIssueId.set(
      reconcilePreparationIssue(
        projectPreparationPilot(receipt).issues,
        this.selectedIssueId()
      )
    );
    this.receipt.set(receipt);
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore) afterNextRender(restore, { injector: this.injector });
  }

  async approve(receipt: AdminPreparationReceipt): Promise<void> {
    if (!this.canApprove() || this.receipt() !== receipt) return;
    const revisionBeforeApproval = this.admin.dataRevision();
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
      // This response already contains the confirmed server receipt. Only
      // consume our own invalidation; concurrent mutations still trigger a read.
      if (this.admin.dataRevision() === revisionBeforeApproval + 1)
        this.observedRevision = this.admin.dataRevision();
      // A run refresh may have started a read before this approval committed.
      ++this.serial;
      this.loading.set(false);
      this.receive(result);
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
      if (ticket === this.approvalSerial) {
        this.approving.set(false);
        if (this.pendingRevision > this.observedRevision && this.receipt()) {
          this.observedRevision = this.admin.dataRevision();
          void this.load();
        }
        this.pendingRevision = -1;
      }
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
