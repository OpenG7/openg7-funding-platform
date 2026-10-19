import { signal } from '@angular/core';
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

const pendingCreationKey = 'openg7-admin-expense-create-uncertain';

/** Freezes confirmed writes and reconciles only responses from the original scope. */
export class AdminExpensesMutationWorkflow {
  readonly busy = signal(false);
  readonly confirming = signal(false);
  readonly createUncertain = signal(false);
  private disposed = false;

  constructor(private readonly ports: AdminExpensesMutationPorts) {
    this.createUncertain.set(this.hasPendingCreation());
  }

  async create(): Promise<void> {
    if (this.busy() || this.disposed) return;
    if (this.hasPendingCreation()) this.createUncertain.set(true);
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
      const payload = {
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
      // Store only an opaque tab-scoped marker before the request. A page
      // change cannot turn an unanswered create into permission to create again.
      this.markCreationPending(true);
      submitted = true;
      await this.ports.admin.createExpense(token, payload);
      submitted = false;
      this.markCreationPending(false);
      if (!this.current(revision)) return;
      this.ports.resetDraftIfUnchanged(draft);
      await this.ports.read.load(true);
    } catch (error) {
      const definitive =
        error instanceof AdminDashboardRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408;
      if (submitted && definitive) this.markCreationPending(false);
      if (!this.current(revision)) return;
      if (this.handleAccessError(error)) return;
      // No creation receipt or request ID exists in this API contract. A lost
      // response or server failure cannot prove that the allocation was absent.
      if (submitted && !definitive) this.createUncertain.set(true);
      this.ports.read.state.set('error');
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
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
    this.confirming.set(false);
    this.busy.set(false);
  }

  private hasPendingCreation(): boolean {
    try {
      return this.ports.storage?.()?.getItem(pendingCreationKey) === '1';
    } catch {
      return false;
    }
  }

  private markCreationPending(pending: boolean): void {
    try {
      const storage = this.ports.storage?.();
      if (pending) storage?.setItem(pendingCreationKey, '1');
      else storage?.removeItem(pendingCreationKey);
    } catch {
      // The current instance still refuses a second creation after uncertainty.
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
