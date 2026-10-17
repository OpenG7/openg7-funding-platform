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
  AdminDossierPreparationApproveRequest,
  AdminDossierPreparationReceipt
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminPreparationReceiptComponent } from '../admin-preparation/admin-preparation-receipt.component.js';
import {
  type AdminPreparationError,
  isPreparationConfigurationError,
  preparationError
} from '../admin-preparation/admin-preparation-error.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

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
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly receipt = signal<AdminDossierPreparationReceipt | null>(null);
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
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
  }

  t(key: string): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key);
  }

  async load(preserveError = false): Promise<void> {
    if (!this.current(this.dossierId, this.identity)) return;
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
      this.receipt.set(receipt);
      this.uncertain.set(false);
    } catch (error) {
      if (!this.current(dossierId, identity) || ticket !== this.serial) return;
      this.error.set(preparationError(error, 'read'));
    } finally {
      if (ticket === this.serial) this.loading.set(false);
    }
  }

  async approve(receipt: AdminDossierPreparationReceipt): Promise<void> {
    if (!this.canApprove() || this.receipt() !== receipt) return;
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
      this.receipt.set(result);
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
      if (ticket === this.approvalSerial) this.approving.set(false);
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
