import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminExpenseStatus
} from '@openg7/funding-core';
import {
  allocationAmountMinor,
  allocationRequiresConfirmation,
  isPublicAllocationStatus,
  PUBLIC_ALLOCATION_CREATE_CONFIRMATION
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminExpenseCardComponent } from './admin-expense-card.component.js';
import { AdminExpenseCreateComponent } from './admin-expense-create.component.js';
import { AdminExpenseFiltersComponent } from './admin-expense-filters.component.js';
import type {
  ExpenseEdit,
  ExpenseEditFieldChange,
  NewExpenseDraft,
  NewExpenseFieldChange
} from './admin-expense-presentation.types.js';

@Component({
  selector: 'openg7-admin-expenses-page',
  standalone: true,
  imports: [
    CommonModule,
    AdminLayoutComponent,
    TranslatePipe,
    AdminExpenseCreateComponent,
    AdminExpenseFiltersComponent,
    AdminExpenseCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.depenses_et_allocations' | translate }}</h1>
          </div>
          <button type="button" (click)="loadExpenses()">
            {{ 'admin.legacy.actualiser' | translate }}
          </button>
        </header>

        <p class="state" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_des_depenses' | translate }}
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            'admin.legacy.impossible_de_charger_ou_modifier_les_depenses'
              | translate
          }}
        </p>

        <p
          class="state state-error"
          role="alert"
          data-og7="allocation-conflict"
          *ngIf="conflict()"
        >
          {{ 'admin.expenses.conflict' | translate }}
        </p>
        <ng-container *ngIf="response() as data">
          <section
            class="summary-grid"
            [attr.aria-label]="'admin.legacy.resume_depenses' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.total' | translate }}</span>
              <strong>{{ data.summary.total_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.publiees' | translate }}</span>
              <strong>{{ data.summary.published_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.brouillons' | translate }}</span>
              <strong>{{ data.summary.draft_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.montant_publie' | translate }}</span>
              <strong>
                {{
                  formatMoney(
                    data.summary.published_allocated,
                    data.summary.currency
                  )
                }}
              </strong>
            </article>
          </section>

          <openg7-admin-expense-create
            [draft]="newExpenseDraft()"
            [busy]="mutationBusy()"
            (draftChange)="setNewField($event)"
            (createRequested)="createExpense()"
          />

          <openg7-admin-expense-filters
            [search]="search()"
            [status]="statusFilter()"
            (searchChange)="search.set($event)"
            (statusChange)="statusFilter.set($event)"
          />

          <section
            class="expense-list"
            [attr.aria-label]="'admin.legacy.liste_des_depenses' | translate"
          >
            <openg7-admin-expense-card
              *ngFor="
                let expense of filteredExpenses();
                trackBy: trackByExpense
              "
              [expense]="expense"
              [edit]="editFor(expense.id)"
              [busy]="mutationBusy()"
              [amountLabel]="
                formatMoney(expense.amount_allocated, expense.currency)
              "
              (editChange)="setEditField(expense.id, $event)"
              (saveRequested)="saveExpense(expense, $event)"
              (proofRequested)="inspection.proof(expense)"
            />

            <article
              class="empty-state"
              *ngIf="state() === 'ready' && filteredExpenses().length === 0"
            >
              <h3>{{ 'admin.legacy.aucune_entree_trouvee' | translate }}</h3>
              <p>
                {{
                  'admin.legacy.ajoutez_une_depense_ou_modifiez_les_filtres'
                    | translate
                }}
              </p>
            </article>
          </section>
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      .admin-content,
      .expense-list {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .summary-grid,
      .expense-list,
      .state,
      openg7-admin-expense-create,
      openg7-admin-expense-filters {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .summary-grid span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: var(--admin-label-weight);
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .empty-state h3 {
        margin: 0;
      }

      .summary-grid article,
      .empty-state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .empty-state p {
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .summary-grid strong {
        display: block;
        font-size: 1.65rem;
        margin-top: 0.2rem;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        font-weight: var(--admin-control-weight);
        min-height: 2.55rem;
        padding: 0 0.85rem;
      }

      .state-error {
        color: var(--admin-danger);
        font-weight: var(--admin-label-weight);
      }

      @media (max-width: 900px) {
        .summary-grid {
          grid-template-columns: 1fr;
        }

        .admin-topbar {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminExpensesPageComponent implements OnInit {
  private readonly confirmation = inject(AdminConfirmationService);
  readonly conflict = signal(false);
  readonly mutationBusy = signal(false);
  readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private requestGeneration = 0;
  private editBases = new Map<string, AdminExpenseRecord>();
  private exactId: string | undefined;
  private readonly route = inject(ActivatedRoute);

  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly response = signal<AdminExpensesResponse | null>(null);
  readonly expenseEdits = signal<Record<string, ExpenseEdit>>({});
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly search = signal<string>('');
  readonly statusFilter = signal<'all' | AdminExpenseStatus>('all');
  readonly newProjectName = signal<string>('');
  readonly newDescription = signal<string>('');
  readonly newExpectedOutcome = signal<string>('');
  readonly newAmount = signal<string>('');
  readonly newStatus = signal<AdminExpenseStatus>('draft');
  readonly newProgressStatus = signal<'planned' | 'in_progress' | 'delivered'>(
    'planned'
  );
  readonly newProofUrl = signal<string>('');
  readonly newProofSource = signal<string>('');
  readonly newProofPublishedAt = signal<string>('');

  readonly expenses = computed(() => this.response()?.expenses ?? []);
  readonly filteredExpenses = computed(() => {
    const search = this.search().trim().toLowerCase();
    const status = this.statusFilter();

    return this.expenses().filter((expense) => {
      const searchable = [
        expense.project_name,
        expense.public_description,
        expense.expected_outcome,
        expense.progress_status,
        expense.status
      ]
        .join(' ')
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (status === 'all' || expense.status === status)
      );
    });
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => {
      this.requestGeneration++;
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.exactId = params.get('expenseId') ?? undefined;
        this.response.set(null);
        this.search.set('');
        this.statusFilter.set('all');
        void this.loadExpenses();
      });
  }

  async loadExpenses(preserveEdits = false): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const generation = ++this.requestGeneration;
    this.state.set('loading');

    try {
      const response = await this.admin.getExpenses(
        this.adminToken(),
        this.exactId
      );
      if (generation !== this.requestGeneration) return;
      const edits: Record<string, ExpenseEdit> = {};
      const bases = new Map<string, AdminExpenseRecord>();
      let staleDraft = false;
      for (const expense of response.expenses) {
        const edit = this.expenseEdits()[expense.id];
        const base = this.editBases.get(expense.id);
        if (
          preserveEdits &&
          edit &&
          base &&
          !this.editsMatch(edit, this.toEdit(base))
        ) {
          edits[expense.id] = edit;
          // A background read must not advance the version of an unsaved draft.
          bases.set(expense.id, base);
          staleDraft ||= base.updated_at !== expense.updated_at;
        } else {
          edits[expense.id] = this.toEdit(expense);
          bases.set(expense.id, expense);
        }
      }
      this.editBases = bases;
      this.expenseEdits.set(edits);
      this.response.set(response);
      this.state.set('ready');
      if (!preserveEdits) this.conflict.set(false);
      else if (staleDraft) this.conflict.set(true);
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.requestGeneration) return;
      this.state.set('error');
    }
  }

  async createExpense(): Promise<void> {
    if (this.mutationBusy() || this.destroyRef.destroyed) return;
    const draft = this.newExpenseDraft();
    const token = this.adminToken();
    const scope = this.exactId;
    const amount = Number(draft.amountAllocated);
    if (
      !draft.projectName.trim() ||
      !draft.publicDescription.trim() ||
      !draft.expectedOutcome.trim() ||
      allocationAmountMinor(amount) === null
    ) {
      this.state.set('error');
      return;
    }

    try {
      this.mutationBusy.set(true);
      if (
        isPublicAllocationStatus(draft.status) &&
        !(await this.confirmation.confirm(
          this.i18n.t('admin.confirmation.publish'),
          `${draft.projectName} · ${this.formatMoney(amount, 'CAD')} · ${draft.publicDescription} · ${draft.expectedOutcome} · ${draft.proofUrl}`
        ))
      )
        return;
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      await this.admin.createExpense(token, {
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
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      const current = this.newExpenseDraft();
      if (
        (Object.keys(draft) as (keyof NewExpenseDraft)[]).every(
          (field) => current[field] === draft[field]
        )
      ) {
        this.newProjectName.set('');
        this.newDescription.set('');
        this.newExpectedOutcome.set('');
        this.newAmount.set('');
        this.newStatus.set('draft');
        this.newProgressStatus.set('planned');
        this.newProofUrl.set('');
        this.newProofSource.set('');
        this.newProofPublishedAt.set('');
      }
      await this.loadExpenses(true);
    } catch {
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      this.state.set('error');
    } finally {
      this.mutationBusy.set(false);
    }
  }

  async saveExpense(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    if (this.mutationBusy() || this.destroyRef.destroyed) return;
    const edit = this.editFor(expense.id);
    const base = this.editBases.get(expense.id) ?? expense;
    const token = this.adminToken();
    const scope = this.exactId;
    const amount = Number(edit.amountAllocated);

    if (allocationAmountMinor(amount) === null) {
      this.state.set('error');
      return;
    }

    try {
      this.mutationBusy.set(true);
      const nextStatus = forcedStatus ?? edit.status;
      if (allocationRequiresConfirmation(base.status, nextStatus)) {
        if (
          !(await this.confirmation.confirm(
            this.i18n.t(
              ['published', 'active'].includes(nextStatus)
                ? 'admin.confirmation.publish'
                : 'admin.confirmation.cancelPublication'
            ),
            `${edit.projectName} · ${this.formatMoney(amount, 'CAD')} · ${edit.publicDescription} · ${edit.expectedOutcome} · ${edit.proofUrl}`
          ))
        )
          return;
      }
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      const result = await this.admin.updateExpense(token, {
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
        proofPublishedAt: this.updatedDateTime(
          edit.proofPublishedAt,
          base.proof_published_at
        ),
        amountAllocated: amount,
        currency: 'CAD',
        status: forcedStatus ?? edit.status,
        publishedAt: this.updatedDateTime(edit.publishedAt, base.published_at)
      });
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      if (result.updated && result.expense?.id === expense.id) {
        this.reconcileSavedEdit(result.expense, edit);
      }
      await this.loadExpenses(true);
    } catch (error) {
      if (this.destroyRef.destroyed || scope !== this.exactId) return;
      if (error instanceof Error && error.message === 'version_conflict') {
        this.conflict.set(true);
        return;
      }
      this.state.set('error');
    } finally {
      this.mutationBusy.set(false);
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setNewField(change: NewExpenseFieldChange): void {
    switch (change.field) {
      case 'projectName':
        this.newProjectName.set(change.value);
        break;
      case 'publicDescription':
        this.newDescription.set(change.value);
        break;
      case 'expectedOutcome':
        this.newExpectedOutcome.set(change.value);
        break;
      case 'progressStatus':
        this.newProgressStatus.set(change.value);
        break;
      case 'proofUrl':
        this.newProofUrl.set(change.value);
        break;
      case 'proofSource':
        this.newProofSource.set(change.value);
        break;
      case 'proofPublishedAt':
        this.newProofPublishedAt.set(change.value);
        break;
      case 'amountAllocated':
        this.newAmount.set(change.value);
        break;
      case 'status':
        this.newStatus.set(change.value);
        break;
    }
  }

  setEditField(expenseId: string, change: ExpenseEditFieldChange): void {
    this.expenseEdits.update((edits) => ({
      ...edits,
      [expenseId]: {
        ...(edits[expenseId] ?? this.emptyEdit()),
        [change.field]: change.value
      }
    }));
  }

  editFor(expenseId: string): ExpenseEdit {
    return this.expenseEdits()[expenseId] ?? this.emptyEdit();
  }

  trackByExpense(_: number, expense: AdminExpenseRecord): string {
    return expense.id;
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
  }

  private editsMatch(left: ExpenseEdit, right: ExpenseEdit): boolean {
    return (Object.keys(left) as (keyof ExpenseEdit)[]).every(
      (field) => left[field] === right[field]
    );
  }

  private reconcileSavedEdit(
    expense: AdminExpenseRecord,
    submitted: ExpenseEdit
  ): void {
    const current = this.editFor(expense.id);
    const saved = this.toEdit(expense);
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

  newExpenseDraft(): NewExpenseDraft {
    return {
      projectName: this.newProjectName(),
      publicDescription: this.newDescription(),
      expectedOutcome: this.newExpectedOutcome(),
      progressStatus: this.newProgressStatus(),
      proofUrl: this.newProofUrl(),
      proofSource: this.newProofSource(),
      proofPublishedAt: this.newProofPublishedAt(),
      amountAllocated: this.newAmount(),
      status: this.newStatus()
    };
  }

  private toEdit(expense: AdminExpenseRecord): ExpenseEdit {
    return {
      projectName: expense.project_name,
      publicDescription: expense.public_description,
      expectedOutcome: expense.expected_outcome,
      progressStatus: expense.progress_status,
      proofUrl: expense.proof_url ?? '',
      proofSource: expense.proof_source ?? '',
      proofPublishedAt: this.toDateTimeLocal(expense.proof_published_at),
      amountAllocated: String(expense.amount_allocated),
      status: expense.status,
      publishedAt: this.toDateTimeLocal(expense.published_at)
    };
  }

  private emptyEdit(): ExpenseEdit {
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

  private toDateTimeLocal(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '';
    }

    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  private updatedDateTime(
    value: string,
    original: string | null
  ): string | null {
    if (value === this.toDateTimeLocal(original)) return original;
    return value ? new Date(value).toISOString() : null;
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
