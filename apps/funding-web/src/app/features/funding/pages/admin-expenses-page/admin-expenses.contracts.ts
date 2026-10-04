import type { WritableSignal } from '@angular/core';
import type { AdminExpenseRecord } from '@openg7/funding-core';

import type { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';

import type {
  ExpenseEdit,
  NewExpenseDraft
} from './admin-expense-presentation.types.js';

export type ExpensesReadState = 'idle' | 'loading' | 'ready' | 'error';

export interface AdminExpensesReadPorts {
  readonly admin: Pick<FundingAdminService, 'getExpenses' | 'saveAdminToken'>;
  token(): string;
}

/** The mutation workflow can reconcile drafts without depending on the page. */
export interface AdminExpensesMutationReadPort {
  readonly state: WritableSignal<ExpensesReadState>;
  readonly conflict: WritableSignal<boolean>;
  scopeRevision(): number;
  isCurrentScope(revision: number): boolean;
  editFor(expenseId: string): ExpenseEdit;
  baseFor(expenseId: string): AdminExpenseRecord | undefined;
  reconcileSavedEdit(expense: AdminExpenseRecord, submitted: ExpenseEdit): void;
  load(preserveEdits?: boolean): Promise<void>;
}

export interface AdminExpensesMutationPorts {
  readonly admin: Pick<FundingAdminService, 'createExpense' | 'updateExpense'>;
  readonly confirmation: Pick<AdminConfirmationService, 'confirm'>;
  readonly read: AdminExpensesMutationReadPort;
  token(): string;
  draft(): NewExpenseDraft;
  resetDraftIfUnchanged(submitted: NewExpenseDraft): void;
  t(key: string): string;
  formatMoney(amount: number, currency: string): string;
}
