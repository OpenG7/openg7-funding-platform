import { signal } from '@angular/core';
import type {
  AdminExpenseRecord,
  AdminExpensesResponse
} from '@openg7/funding-core';

import type {
  ExpenseEdit,
  ExpenseEditFieldChange
} from './admin-expense-presentation.types.js';
import type {
  AdminExpensesReadPorts,
  ExpensesReadState
} from './admin-expenses.contracts.js';

/** Owns server reads, draft versions and the lifetime of one allocation scope. */
export class AdminExpensesReadController {
  readonly state = signal<ExpensesReadState>('idle');
  readonly conflict = signal(false);
  readonly response = signal<AdminExpensesResponse | null>(null);
  readonly expenseEdits = signal<Record<string, ExpenseEdit>>({});
  private editBases = new Map<string, AdminExpenseRecord>();
  private exactId: string | undefined;
  private revision = 0;
  private generation = 0;
  private disposed = false;

  constructor(private readonly ports: AdminExpensesReadPorts) {}

  setScope(expenseId: string | undefined): void {
    if (this.disposed) return;
    // Revisiting the same ID cannot revive work started in a previous scope.
    ++this.revision;
    ++this.generation;
    this.exactId = expenseId;
    this.response.set(null);
    this.expenseEdits.set({});
    this.editBases.clear();
    this.conflict.set(false);
    this.state.set('idle');
  }

  scopeRevision(): number {
    return this.revision;
  }

  isCurrentScope(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  async load(preserveEdits = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const revision = this.revision;
    const token = this.ports.token();
    this.state.set('loading');

    try {
      const response = await this.ports.admin.getExpenses(token, this.exactId);
      if (!this.currentRead(generation, revision)) return;
      const edits: Record<string, ExpenseEdit> = {};
      const bases = new Map<string, AdminExpenseRecord>();
      let staleDraft = false;
      for (const expense of response.expenses) {
        const edit = this.expenseEdits()[expense.id];
        const base = this.editBases.get(expense.id);
        if (preserveEdits && edit && base && !editsMatch(edit, toEdit(base))) {
          edits[expense.id] = edit;
          // A background read cannot lend a newer version to an old draft.
          bases.set(expense.id, base);
          staleDraft ||= base.updated_at !== expense.updated_at;
        } else {
          edits[expense.id] = toEdit(expense);
          bases.set(expense.id, expense);
        }
      }
      this.editBases = bases;
      this.expenseEdits.set(edits);
      this.response.set(response);
      this.state.set('ready');
      if (!preserveEdits) this.conflict.set(false);
      else if (staleDraft) this.conflict.set(true);
      this.ports.admin.saveAdminToken(token);
    } catch {
      if (!this.currentRead(generation, revision)) return;
      this.state.set('error');
    }
  }

  setEditField(expenseId: string, change: ExpenseEditFieldChange): void {
    if (this.disposed) return;
    this.expenseEdits.update((edits) => ({
      ...edits,
      [expenseId]: {
        ...(edits[expenseId] ?? emptyEdit()),
        [change.field]: change.value
      }
    }));
  }

  editFor(expenseId: string): ExpenseEdit {
    return this.expenseEdits()[expenseId] ?? emptyEdit();
  }

  baseFor(expenseId: string): AdminExpenseRecord | undefined {
    return this.editBases.get(expenseId);
  }

  reconcileSavedEdit(
    expense: AdminExpenseRecord,
    submitted: ExpenseEdit
  ): void {
    if (this.disposed) return;
    const current = this.editFor(expense.id);
    const saved = toEdit(expense);
    const mergeField = <K extends keyof ExpenseEdit>(
      field: K
    ): ExpenseEdit[K] =>
      current[field] === submitted[field] ? saved[field] : current[field];
    const edit: ExpenseEdit = {
      projectName: mergeField('projectName'),
      publicDescription: mergeField('publicDescription'),
      expectedOutcome: mergeField('expectedOutcome'),
      progressStatus: mergeField('progressStatus'),
      proofUrl: mergeField('proofUrl'),
      proofSource: mergeField('proofSource'),
      proofPublishedAt: mergeField('proofPublishedAt'),
      amountAllocated: mergeField('amountAllocated'),
      status: mergeField('status'),
      publishedAt: mergeField('publishedAt')
    };
    this.editBases.set(expense.id, expense);
    this.expenseEdits.update((edits) => ({ ...edits, [expense.id]: edit }));
    this.response.update((response) =>
      response
        ? {
            ...response,
            expenses: response.expenses.map((row) =>
              row.id === expense.id ? expense : row
            )
          }
        : null
    );
  }

  dispose(): void {
    this.disposed = true;
    ++this.revision;
    ++this.generation;
  }

  private currentRead(generation: number, revision: number): boolean {
    return this.isCurrentScope(revision) && generation === this.generation;
  }
}

function editsMatch(left: ExpenseEdit, right: ExpenseEdit): boolean {
  return (Object.keys(left) as (keyof ExpenseEdit)[]).every(
    (field) => left[field] === right[field]
  );
}

function toEdit(expense: AdminExpenseRecord): ExpenseEdit {
  return {
    projectName: expense.project_name,
    publicDescription: expense.public_description,
    expectedOutcome: expense.expected_outcome,
    progressStatus: expense.progress_status,
    proofUrl: expense.proof_url ?? '',
    proofSource: expense.proof_source ?? '',
    proofPublishedAt: expenseDateTimeLocal(expense.proof_published_at),
    amountAllocated: String(expense.amount_allocated),
    status: expense.status,
    publishedAt: expenseDateTimeLocal(expense.published_at)
  };
}

function emptyEdit(): ExpenseEdit {
  return {
    projectName: '',
    publicDescription: '',
    expectedOutcome: '',
    progressStatus: 'planned',
    proofUrl: '',
    proofSource: '',
    proofPublishedAt: '',
    amountAllocated: '',
    status: 'draft',
    publishedAt: ''
  };
}

/** Browser-local inputs have minute precision; unchanged dates retain the API value. */
export function expenseDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function updatedExpenseDateTime(
  value: string,
  original: string | null
): string | null {
  if (value === expenseDateTimeLocal(original)) return original;
  return value ? new Date(value).toISOString() : null;
}
