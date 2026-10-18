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
  AdminDossierPreparationApproveRequest,
  AdminDossierPreparationReceipt
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminPreparationReceiptComponent } from '../admin-preparation/admin-preparation-receipt.component.js';
import {
  projectPreparationPilot,
  reconcilePreparationIssue
} from '../admin-preparation/preparation-pilot.projection.js';
import { capturePreparationFocus } from '../admin-preparation/preparation-focus.js';
import type { PreparationDetailsMode } from '../admin-preparation/preparation-pilot.models.js';
import {
  type AdminPreparationError,
  isPreparationConfigurationError,
  preparationError
} from '../admin-preparation/admin-preparation-error.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { PreparationAssistanceSummaryController } from '../admin-preparation/preparation-assistance-summary.controller.js';
import {
  PreparationReturnService,
  type PreparationReturnRequest
} from '../admin-preparation/preparation-return.service.js';

/** The open sponsorship's receipt, independent of an automatic run or publication. */
@Component({
  selector: 'openg7-admin-sponsorship-preparation',
  standalone: true,
  imports: [AdminPreparationReceiptComponent, AdminIconComponent],
  templateUrl: './admin-sponsorship-preparation.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-preparation.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSponsorshipPreparationComponent {
  readonly contributionId = input.required<string>();
  readonly refreshKey = input.required<string>();
  readonly detailsMode = input<PreparationDetailsMode>('hidden');
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly receipt = signal<AdminDossierPreparationReceipt | null>(null);
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
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
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly returnNavigation = inject(PreparationReturnService);
  private returnSequence = 0;
  private returnRequest: PreparationReturnRequest | null = null;
  private restoreFocus: (() => void) | null = null;
  private observedRevision = this.admin.dataRevision();
  private pendingRevision = -1;
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
  private dossierId = '';
  private identity = '';
  private serial = 0;
  private approvalSerial = 0;
  private disposed = false;
  private command: AdminDossierPreparationApproveRequest | null = null;

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
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      let current = true;
      onCleanup(() => (current = false));
      this.languageReady.set(false);
      this.languageError.set(false);
      const locale =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-automatic.en.json')
          : import('../../../../../assets/i18n/admin-automatic.fr-CA.json');
      void locale
        .then(({ default: translations }) => {
          if (!current || this.disposed) return;
          this.i18n.mergeTranslations(language, {
            admin: { automatic: translations }
          });
          this.languageReady.set(true);
        })
        .catch(() => {
          if (current && !this.disposed) this.languageError.set(true);
        });
    });
    effect(() => {
      const dossierId = this.contributionId();
      this.refreshKey();
      const identity = this.identityKey();
      const ready = this.languageReady();
      untracked(() => {
        if (dossierId !== this.dossierId || identity !== this.identity) {
          this.dossierId = dossierId;
          this.identity = identity;
          ++this.serial;
          ++this.approvalSerial;
          this.approving.set(false);
          this.uncertain.set(false);
          this.command = null;
          this.selectedIssueId.set(null);
          this.restoreFocus = null;
          this.pendingRevision = -1;
          this.receipt.set(null);
          this.error.set(null);
        }
        if (!this.admin.hasValidAdminSession()) {
          ++this.serial;
          this.receipt.set(null);
          this.loading.set(false);
          this.error.set('forbidden');
          return;
        }
        if (ready) void this.load();
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
    effect(() => {
      const request = this.returnNavigation.restoreRequest();
      const dossierId = this.contributionId();
      const ready = this.languageReady();
      const approving = this.approving();
      if (
        !request ||
        request.origin.kind !== 'dossier' ||
        request.origin.contributionId !== dossierId ||
        !ready ||
        approving
      )
        return;
      untracked(() => {
        if (
          this.returnSequence === request.sequence ||
          !this.returnNavigation.current(request)
        )
          return;
        this.returnSequence = request.sequence;
        this.returnRequest = request;
        this.selectedIssueId.set(request.origin.issueId);
        this.refresh();
      });
    });
  }

  private finishReturn(receipt?: AdminDossierPreparationReceipt): void {
    const request = this.returnRequest;
    if (
      !request ||
      this.disposed ||
      !this.returnNavigation.current(request) ||
      (receipt && receipt.contributionId !== request.origin.contributionId)
    )
      return;
    if (
      receipt?.contributionId === request.origin.contributionId &&
      projectPreparationPilot(receipt).issues.some(
        (issue) => issue.id === request.origin.issueId
      )
    )
      this.selectedIssueId.set(request.origin.issueId);
    afterNextRender(
      () => {
        if (
          this.disposed ||
          this.loading() ||
          (receipt && this.receipt() !== receipt)
        )
          return;
        this.returnRequest = null;
        this.returnNavigation.finish(request, this.element.nativeElement);
      },
      { injector: this.injector }
    );
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }
  refresh(): void {
    void this.assistance.load();
    void this.load();
  }

  async load(preserveError = false): Promise<void> {
    if (!this.current(this.dossierId, this.identity)) return;
    this.restoreFocus ??= capturePreparationFocus(this.element.nativeElement);
    const ticket = ++this.serial;
    const dossierId = this.dossierId;
    const identity = this.identity;
    this.loading.set(true);
    this.receipt.set(null);
    if (!preserveError) this.error.set(null);
    try {
      const receipt = await this.admin.getSponsorshipPreparation(dossierId);
      if (!this.current(dossierId, identity) || ticket !== this.serial) return;
      if (receipt.context !== 'dossier' || receipt.contributionId !== dossierId)
        throw new Error('PREPARATION_RESPONSE_MISMATCH');
      this.receive(receipt);
      this.uncertain.set(false);
    } catch (error) {
      if (!this.current(dossierId, identity) || ticket !== this.serial) return;
      this.error.set(preparationError(error, 'read'));
      this.finishReturn();
    } finally {
      if (ticket === this.serial) this.loading.set(false);
    }
  }

  async confirmAndApprove(
    receipt: AdminDossierPreparationReceipt
  ): Promise<void> {
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

  private receive(receipt: AdminDossierPreparationReceipt): void {
    this.selectedIssueId.set(
      reconcilePreparationIssue(
        projectPreparationPilot(receipt).issues,
        this.selectedIssueId()
      )
    );
    this.receipt.set(receipt);
    this.finishReturn(receipt);
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore) afterNextRender(restore, { injector: this.injector });
  }

  async approve(receipt: AdminDossierPreparationReceipt): Promise<void> {
    if (!this.canApprove() || this.receipt() !== receipt) return;
    const revisionBeforeApproval = this.admin.dataRevision();
    const ticket = ++this.approvalSerial;
    const identity = this.identity;
    const refreshKey = this.refreshKey();
    if (
      !this.command ||
      this.command.contributionId !== receipt.contributionId ||
      this.command.expectedVersion !== receipt.version
    ) {
      this.command = {
        contributionId: receipt.contributionId,
        expectedVersion: receipt.version,
        requestId: crypto.randomUUID(),
        confirmed: true
      };
    }
    this.approving.set(true);
    this.error.set(null);
    try {
      const result = await this.admin.approveSponsorshipPreparation(
        this.command
      );
      if (
        !this.current(receipt.contributionId, identity) ||
        ticket !== this.approvalSerial
      )
        return;
      if (
        result.context !== 'dossier' ||
        result.contributionId !== receipt.contributionId
      )
        throw new Error('PREPARATION_RESPONSE_MISMATCH');
      if (this.admin.dataRevision() === revisionBeforeApproval + 1)
        this.observedRevision = this.admin.dataRevision();
      // A dossier refreshed while this response was in flight may already have
      // a newer preparation. Reconcile it without repeating the approval.
      if (refreshKey !== this.refreshKey()) {
        this.command = null;
        await this.load();
        return;
      }
      // An older read must not replace the newly recorded agreement.
      ++this.serial;
      this.loading.set(false);
      this.receive(result);
      this.command = null;
    } catch (error) {
      if (
        !this.current(receipt.contributionId, identity) ||
        ticket !== this.approvalSerial
      )
        return;
      const status = (error as { status?: number })?.status;
      this.error.set(preparationError(error, 'approve'));
      this.uncertain.set(!status || status >= 500);
      if (status === 401 || status === 403) this.receipt.set(null);
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

  private current(dossierId: string, identity: string): boolean {
    return (
      !this.disposed &&
      dossierId === this.dossierId &&
      identity === this.identityKey() &&
      this.admin.hasValidAdminSession()
    );
  }
}
