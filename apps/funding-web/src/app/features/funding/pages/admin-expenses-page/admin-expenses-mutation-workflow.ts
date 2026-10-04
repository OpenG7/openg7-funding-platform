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

import { updatedExpenseDateTime } from './admin-expenses-read-controller.js';
import type { AdminExpensesMutationPorts } from './admin-expenses.contracts.js';

/** Freezes confirmed writes and reconciles only responses from the original scope. */
export class AdminExpensesMutationWorkflow {
  readonly busy = signal(false);
  private disposed = false;

  constructor(private readonly ports: AdminExpensesMutationPorts) {}

  async create(): Promise<void> {
    if (this.busy() || this.disposed) return;
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

    try {
      this.busy.set(true);
      if (
        isPublicAllocationStatus(draft.status) &&
        !(await this.ports.confirmation.confirm(
          this.ports.t('admin.confirmation.publish'),
          `${draft.projectName} · ${this.ports.formatMoney(amount, 'CAD')} · ${draft.publicDescription} · ${draft.expectedOutcome} · ${draft.proofUrl}`
        ))
      )
        return;
      if (!this.current(revision)) return;
      await this.ports.admin.createExpense(token, {
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
        currency: 'CAD',
        status: draft.status
      });
      if (!this.current(revision)) return;
      this.ports.resetDraftIfUnchanged(draft);
      await this.ports.read.load(true);
    } catch {
      if (!this.current(revision)) return;
      this.ports.read.state.set('error');
    } finally {
      if (!this.disposed) this.busy.set(false);
    }
  }

  async save(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    if (this.busy() || this.disposed) return;
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
        if (
          !(await this.ports.confirmation.confirm(
            this.ports.t(
              ['published', 'active'].includes(nextStatus)
                ? 'admin.confirmation.publish'
                : 'admin.confirmation.cancelPublication'
            ),
            `${edit.projectName} · ${this.ports.formatMoney(amount, 'CAD')} · ${edit.publicDescription} · ${edit.expectedOutcome} · ${edit.proofUrl}`
          ))
        )
          return;
      }
      if (!this.current(revision)) return;
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
    this.busy.set(false);
  }

  private current(revision: number): boolean {
    return !this.disposed && this.ports.read.isCurrentScope(revision);
  }
}
