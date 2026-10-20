import { computed, signal } from '@angular/core';
import type {
  AdminExpenseRecord,
  AdminExpenseStatus
} from '@openg7/funding-core';
import {
  allocationAmountMinor,
  allocationRequiresConfirmation,
  isPublicAllocationStatus,
  PUBLIC_ALLOCATION_CREATE_CONFIRMATION
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import { updatedExpenseDateTime } from './admin-expenses-read-controller.js';
import type { AdminExpensesMutationPorts } from './admin-expenses.contracts.js';
import type { NewExpenseDraft } from './admin-expense-presentation.types.js';

const pendingCreationKey = 'openg7-admin-expense-create-uncertain';
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validExpenseId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d{0,18}$/.test(value) &&
  (value.length < 19 || value <= '9223372036854775807');

/** Freezes confirmed writes and reconciles only responses from the original scope. */
export class AdminExpensesMutationWorkflow {
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly createUncertain = signal(false);
  readonly receiptCheckBusy = signal(false);
  readonly creationReceiptMessage = signal('');
  readonly createdExpenseId = signal<string | null>(null);
  private readonly pendingCreation = signal<string | null>(null);
  readonly canVerifyCreation = computed(() =>
    requestIdPattern.test(this.pendingCreation() ?? '')
  );
  private disposed = false;
  private receiptRevision = 0;
  private submittedDraft: NewExpenseDraft | null = null;

  constructor(private readonly ports: AdminExpensesMutationPorts) {
    this.pendingCreation.set(this.readPendingCreation());
    this.createUncertain.set(Boolean(this.pendingCreation()));
  }

  async create(): Promise<void> {
    if (this.busy() || this.receiptCheckBusy() || this.disposed) return;
    this.pendingCreation.set(
      this.pendingCreation() ?? this.readPendingCreation()
    );
    if (this.pendingCreation()) this.createUncertain.set(true);
    if (this.createUncertain() || this.ports.read.state() !== 'ready') return;
    const revision = this.ports.read.scopeRevision();
    if (!this.current(revision)) return;
    const draft = { ...this.ports.draft() };
    const token = this.ports.token();
    const amount = Number(draft.amountAllocated);
    if (
      !draft.projectName.trim() ||
      !draft.publicDescription.trim() ||
      !draft.expectedOutcome.trim() ||
      allocationAmountMinor(amount) === null
    ) {
      this.ports.read.state.set('error');
      return;
    }

    let submitted = false;
    let requestId: string | null = null;
    try {
      this.busy.set(true);
      if (isPublicAllocationStatus(draft.status)) {
        let confirmed: boolean;
        this.confirming.set(true);
        try {
          confirmed = await this.ports.confirmation.confirm(
            this.ports.t('admin.confirmation.publish'),
            `${draft.projectName} · ${this.ports.formatMoney(amount, 'CAD')} · ${draft.publicDescription} · ${draft.expectedOutcome} · ${draft.proofUrl}`
          );
        } finally {
          if (!this.disposed) this.confirming.set(false);
        }
        if (!confirmed) return;
      }
      if (!this.current(revision) || this.ports.read.state() !== 'ready')
        return;
      requestId = this.ports.newRequestId();
      if (!requestId || !requestIdPattern.test(requestId))
        throw new Error('Expense creation request ID is unavailable.');
      const payload = {
        requestId,
        confirmation: isPublicAllocationStatus(draft.status)
          ? PUBLIC_ALLOCATION_CREATE_CONFIRMATION
          : undefined,
        projectName: draft.projectName.trim(),
        publicDescription: draft.publicDescription.trim(),
        expectedOutcome: draft.expectedOutcome.trim(),
        progressStatus: draft.progressStatus,
        proofUrl: draft.proofUrl.trim() || null,
        proofSource: draft.proofSource.trim() || null,
        proofPublishedAt: draft.proofPublishedAt
          ? new Date(draft.proofPublishedAt).toISOString()
          : null,
        amountAllocated: amount,
        currency: 'CAD' as const,
        status: draft.status
      };
      // Store only the opaque tab-scoped UUID before the request. A page
      // change cannot turn an unanswered create into permission to create again.
      this.resetReceiptView();
      this.submittedDraft = draft;
      this.markCreationPending(requestId);
      submitted = true;
      const result = await this.ports.admin.createExpense(token, payload);
      if (result?.updated !== true || !validExpenseId(result.expense?.id))
        throw new Error('Expense creation was not confirmed.');
      submitted = false;
      this.completeCreation(requestId);
      if (!this.current(revision)) return;
      this.ports.resetDraftIfUnchanged(draft);
      await this.ports.read.load(true);
    } catch (error) {
      const definitive =
        error instanceof AdminDashboardRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.code !== 'request_conflict';
      if (submitted && definitive && requestId)
        this.completeCreation(requestId);
      if (!this.current(revision)) return;
      if (this.handleAccessError(error)) return;
      // Only the exact command receipt can resolve an unknown outcome.
      if (submitted && !definitive) this.createUncertain.set(true);
      this.ports.read.state.set('error');
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  async verifyCreationReceipt(): Promise<void> {
    const revision = this.ports.read.scopeRevision();
    const requestId = this.pendingCreation();
    if (
      !this.current(revision) ||
      this.busy() ||
      this.receiptCheckBusy() ||
      !requestId ||
      !requestIdPattern.test(requestId)
    )
      return;
    const check = ++this.receiptRevision;
    const active = () =>
      this.current(revision) && check === this.receiptRevision;
    this.receiptCheckBusy.set(true);
    this.creationReceiptMessage.set('');
    try {
      const receipt = await this.ports.admin.getExpenseCreateReceipt(
        this.ports.token(),
        requestId
      );
      if (!active() || this.pendingCreation() !== requestId) return;
      if (receipt.requestId !== requestId.toLowerCase())
        throw new Error('Expense receipt does not match this request.');
      if (receipt.found === false) {
        this.creationReceiptMessage.set(
          this.ports.t('admin.financialSafety.expenseReceipt.notFound')
        );
        return;
      }
      if (
        receipt.found !== true ||
        !validExpenseId(receipt.expenseId) ||
        typeof receipt.acceptedAt !== 'string' ||
        !Number.isFinite(Date.parse(receipt.acceptedAt)) ||
        new Date(receipt.acceptedAt).toISOString() !== receipt.acceptedAt
      )
        throw new Error('Expense creation receipt is incomplete.');
      this.createdExpenseId.set(receipt.expenseId);
      this.completeCreation(requestId);
      this.createUncertain.set(Boolean(this.pendingCreation()));
      if (this.submittedDraft)
        this.ports.resetDraftIfUnchanged(this.submittedDraft);
      this.submittedDraft = null;
      const message = this.ports.t(
        'admin.financialSafety.expenseReceipt.found'
      );
      this.creationReceiptMessage.set(message);
      await this.ports.read.load(true);
      if (active() && this.ports.read.state() !== 'ready')
        this.creationReceiptMessage.set(
          `${message} ${this.ports.t('admin.financialSafety.stale')}`
        );
    } catch (error) {
      if (!active() || this.handleAccessError(error)) return;
      this.creationReceiptMessage.set(
        this.ports.t('admin.financialSafety.expenseReceipt.unavailable')
      );
    } finally {
      if (active()) this.receiptCheckBusy.set(false);
    }
  }

  resetReceiptView(): void {
    ++this.receiptRevision;
    this.receiptCheckBusy.set(false);
    this.creationReceiptMessage.set('');
    this.createdExpenseId.set(null);
  }

  async save(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    if (this.busy() || this.disposed || this.ports.read.state() !== 'ready')
      return;
    const revision = this.ports.read.scopeRevision();
    if (!this.current(revision)) return;
    const edit = { ...this.ports.read.editFor(expense.id) };
    const base = this.ports.read.baseFor(expense.id) ?? expense;
    const token = this.ports.token();
    const amount = Number(edit.amountAllocated);
    if (allocationAmountMinor(amount) === null) {
      this.ports.read.state.set('error');
      return;
    }

    try {
      this.busy.set(true);
      const nextStatus = forcedStatus ?? edit.status;
      if (allocationRequiresConfirmation(base.status, nextStatus)) {
        let confirmed: boolean;
        this.confirming.set(true);
        try {
          confirmed = await this.ports.confirmation.confirm(
            this.ports.t(
              ['published', 'active'].includes(nextStatus)
                ? 'admin.confirmation.publish'
                : 'admin.confirmation.cancelPublication'
            ),
            `${edit.projectName} · ${this.ports.formatMoney(amount, 'CAD')} · ${edit.publicDescription} · ${edit.expectedOutcome} · ${edit.proofUrl}`
          );
        } finally {
          if (!this.disposed) this.confirming.set(false);
        }
        if (!confirmed) return;
      }
      if (!this.current(revision) || this.ports.read.state() !== 'ready')
        return;
      const result = await this.ports.admin.updateExpense(token, {
        expenseId: expense.id,
        expectedVersion: base.updated_at,
        confirmation: allocationRequiresConfirmation(base.status, nextStatus)
          ? expense.id
          : undefined,
        projectName: edit.projectName,
        publicDescription: edit.publicDescription,
        expectedOutcome: edit.expectedOutcome,
        progressStatus: edit.progressStatus,
        proofUrl: edit.proofUrl.trim() || null,
        proofSource: edit.proofSource.trim() || null,
        proofPublishedAt: updatedExpenseDateTime(
          edit.proofPublishedAt,
          base.proof_published_at
        ),
        amountAllocated: amount,
        currency: 'CAD',
        status: nextStatus,
        publishedAt: updatedExpenseDateTime(edit.publishedAt, base.published_at)
      });
      if (!this.current(revision)) return;
      if (result.updated && result.expense?.id === expense.id) {
        this.ports.read.reconcileSavedEdit(result.expense, edit);
      }
      await this.ports.read.load(true);
    } catch (error) {
      if (!this.current(revision)) return;
      if (this.handleAccessError(error)) return;
      if (error instanceof Error && error.message === 'version_conflict') {
        this.ports.read.conflict.set(true);
        return;
      }
      this.ports.read.state.set('error');
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.resetReceiptView();
    this.confirming.set(false);
    this.busy.set(false);
  }

  private readPendingCreation(): string | null {
    try {
      return this.ports.storage?.()?.getItem(pendingCreationKey) || null;
    } catch {
      return null;
    }
  }

  private markCreationPending(requestId: string): void {
    this.pendingCreation.set(requestId);
    try {
      this.ports.storage?.()?.setItem(pendingCreationKey, requestId);
    } catch {
      // The current instance still refuses a second creation after uncertainty.
    }
  }

  private completeCreation(requestId: string): void {
    if (this.pendingCreation() === requestId) this.pendingCreation.set(null);
    try {
      const storage = this.ports.storage?.();
      const stored = storage?.getItem(pendingCreationKey);
      if (stored === requestId) storage?.removeItem(pendingCreationKey);
      else if (stored) this.pendingCreation.set(stored);
    } catch {
      // A retained UUID can be checked again; it never permits an implicit replay.
    }
  }

  private handleAccessError(error: unknown): boolean {
    if (
      !(error instanceof AdminDashboardRequestError) ||
      (error.status !== 401 && error.status !== 403)
    )
      return false;
    this.ports.onAccessDenied?.(error.status);
    return true;
  }

  private current(revision: number): boolean {
    return (
      !this.disposed &&
      this.ports.canManage() &&
      this.ports.read.isCurrentScope(revision)
    );
  }
}
