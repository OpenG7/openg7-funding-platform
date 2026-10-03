import type { AdminExpenseStatus } from '@openg7/funding-core';

/** Page-owned allocation fields; presentation components only emit field changes. */
export interface ExpenseEdit {
  readonly projectName: string;
  readonly publicDescription: string;
  readonly expectedOutcome: string;
  readonly progressStatus: 'planned' | 'in_progress' | 'delivered';
  readonly proofUrl: string;
  readonly proofSource: string;
  readonly proofPublishedAt: string;
  readonly amountAllocated: string;
  readonly status: AdminExpenseStatus;
  readonly publishedAt: string;
}

export type NewExpenseDraft = Omit<ExpenseEdit, 'publishedAt'>;

type FieldChange<T> = {
  [K in keyof T]: { readonly field: K; readonly value: T[K] };
}[keyof T];

export type ExpenseEditFieldChange = FieldChange<ExpenseEdit>;
export type NewExpenseFieldChange = FieldChange<NewExpenseDraft>;
export type ExpenseStatusFilter = 'all' | AdminExpenseStatus;
export type ExpenseTextField = Exclude<
  keyof ExpenseEdit,
  'status' | 'progressStatus'
>;

export const expenseStatuses: readonly AdminExpenseStatus[] = [
  'draft',
  'published',
  'active',
  'private',
  'archived'
];

export const expenseStatusTranslationKeys: Readonly<
  Record<AdminExpenseStatus, string>
> = {
  draft: 'admin.legacy.brouillon',
  published: 'admin.legacy.publiee',
  active: 'admin.messages.active',
  private: 'admin.messages.privee',
  archived: 'admin.messages.archivee'
};
