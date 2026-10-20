import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import type {
  AdminExpenseRecord,
  AdminExpenseStatus
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { adminFinancialCapabilities } from '../../services/admin-financial-capabilities.js';
import { adminDocumentDeliveryBrowser } from '../../services/admin-document-delivery-browser.js';

import { AdminExpensesReadController } from './admin-expenses-read-controller.js';
import { AdminExpensesMutationWorkflow } from './admin-expenses-mutation-workflow.js';
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
    AdminIconComponent,
    TranslatePipe,
    RouterLink,
    AdminExpenseCreateComponent,
    AdminExpenseFiltersComponent,
    AdminExpenseCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div class="heading-copy">
            <h1>{{ 'admin.legacy.depenses_et_allocations' | translate }}</h1>
          </div>
          <button type="button" class="admin-button" (click)="loadExpenses()">
            <openg7-admin-icon name="refresh" />
            {{ 'admin.legacy.actualiser' | translate }}
          </button>
        </header>

        @if (!canManageExpenses()) {
          <p class="state" data-og7="financial-read-only" role="status">
            {{ 'admin.financialSafety.readOnly' | translate }}
          </p>
        }

        <p class="state" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_des_depenses' | translate }}
        </p>

        @if (state() === 'error' && response()) {
          <p class="state" data-og7="financial-stale" role="status">
            {{ 'admin.financialSafety.stale' | translate }}
          </p>
        }
        @if (createUncertain()) {
          <p
            class="state state-error"
            data-og7="expense-create-uncertain"
            role="alert"
          >
            {{ 'admin.financialSafety.createUncertain' | translate }}
          </p>
        }
        @if (canManageExpenses()) {
          @if (createUncertain() && canVerifyCreation()) {
            <p class="state">
              <button
                type="button"
                class="admin-button admin-button--secondary"
                data-og7="expense-create-receipt-check"
                [disabled]="receiptCheckBusy() || mutationBusy()"
                (click)="verifyExpenseCreation()"
              >
                {{
                  (receiptCheckBusy()
                    ? 'admin.financialSafety.expenseReceipt.checking'
                    : 'admin.financialSafety.expenseReceipt.check'
                  ) | translate
                }}
              </button>
            </p>
          }
          @if (creationReceiptMessage()) {
            <p
              class="state"
              data-og7="expense-create-receipt-message"
              role="status"
            >
              {{ creationReceiptMessage() }}
            </p>
          }
          @if (createdExpenseId(); as expenseId) {
            <p class="state">
              <a
                class="admin-button admin-button--secondary"
                data-og7="expense-create-receipt-open"
                routerLink="/admin/fundraiser/expenses"
                [queryParams]="{ expenseId }"
                >{{
                  'admin.financialSafety.expenseReceipt.open' | translate
                }}</a
              >
            </p>
          }
        }
        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            readError() ||
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

          <div
            class="expense-workspace"
            [class.is-read-only]="!canManageExpenses()"
          >
            <div class="expense-register">
              <header class="register-heading">
                <h2>{{ 'admin.legacy.liste_des_depenses' | translate }}</h2>
              </header>
              <openg7-admin-expense-filters
                [search]="search()"
                [status]="statusFilter()"
                (searchChange)="search.set($event)"
                (statusChange)="statusFilter.set($event)"
              />
              <section
                class="expense-list"
                [attr.aria-label]="
                  'admin.legacy.liste_des_depenses' | translate
                "
              >
                <openg7-admin-expense-card
                  *ngFor="
                    let expense of filteredExpenses();
                    trackBy: trackByExpense
                  "
                  [expense]="expense"
                  [edit]="editFor(expense.id)"
                  [busy]="mutationBusy() || state() !== 'ready'"
                  [canManage]="canManageExpenses()"
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
                  <h3>
                    {{ 'admin.legacy.aucune_entree_trouvee' | translate }}
                  </h3>
                  <p>
                    {{
                      (canManageExpenses()
                        ? 'admin.legacy.ajoutez_une_depense_ou_modifiez_les_filtres'
                        : 'admin.financialSafety.readOnly'
                      ) | translate
                    }}
                  </p>
                </article>
              </section>
            </div>
            @if (canManageExpenses()) {
              <openg7-admin-expense-create
                [draft]="newExpenseDraft()"
                [busy]="
                  mutationBusy() || createUncertain() || state() !== 'ready'
                "
                [readOnly]="createUncertain()"
                (draftChange)="setNewField($event)"
                (createRequested)="createExpense()"
              />
            }
          </div>
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-expenses-page.component.css'
  ]
})
export class AdminExpensesPageComponent implements OnInit {
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private sessionExpired = false;
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  readonly adminToken = signal<string>('');
  readonly canManageExpenses = computed(
    () =>
      adminFinancialCapabilities(this.admin.identity(), this.adminToken())
        .canManageExpenses
  );
  private readonly read = new AdminExpensesReadController({
    admin: this.admin,
    token: () => this.adminToken(),
    accessRevision: () => this.admin.sessionGeneration(),
    onAccessDenied: (status) => this.accessDenied(status)
  });
  private readonly mutation = new AdminExpensesMutationWorkflow({
    admin: this.admin,
    confirmation: this.confirmation,
    read: this.read,
    token: () => this.adminToken(),
    canManage: () =>
      adminFinancialCapabilities(
        this.admin.identity(),
        this.admin.getSavedAdminToken()
      ).canManageExpenses,
    storage: () => adminDocumentDeliveryBrowser()?.storage() ?? null,
    newRequestId: () =>
      adminDocumentDeliveryBrowser()?.crypto.randomUUID() ?? null,
    draft: () => this.newExpenseDraft(),
    resetDraftIfUnchanged: (draft) => this.resetDraftIfUnchanged(draft),
    t: (key) => this.i18n.t(key),
    formatMoney: (amount, currency) => this.formatMoney(amount, currency),
    onAccessDenied: (status) => this.accessDenied(status)
  });
  readonly conflict = this.read.conflict;
  readonly mutationBusy = computed(
    () => this.mutation.busy() && !this.mutation.confirming()
  );
  readonly createUncertain = this.mutation.createUncertain;
  readonly receiptCheckBusy = this.mutation.receiptCheckBusy;
  readonly canVerifyCreation = this.mutation.canVerifyCreation;
  readonly creationReceiptMessage = this.mutation.creationReceiptMessage;
  readonly createdExpenseId = this.mutation.createdExpenseId;
  readonly response = this.read.response;
  readonly expenseEdits = this.read.expenseEdits;
  readonly state = this.read.state;
  readonly readError = this.read.readError;
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

  constructor() {
    let generation = this.admin.sessionGeneration();
    effect(() => {
      const next = this.admin.sessionGeneration();
      if (generation === next) return;
      generation = next;
      untracked(() => this.expireSession());
    });
  }

  private clearPrivate(): void {
    this.mutation.resetReceiptView();
    this.read.setScope(undefined);
    this.resetDraftIfUnchanged(this.newExpenseDraft());
    this.search.set('');
    this.confirmation.answer(false);
    this.inspection.close();
  }

  private accessDenied(status: 401 | 403): void {
    this.clearPrivate();
    this.read.state.set('error');
    this.read.readError.set(
      status === 401 ? 'admin.access.sessionExpired' : 'admin.privacy.forbidden'
    );
    if (status === 401) this.expireSession(true);
  }

  private expireSession(clearSession = false): void {
    this.clearPrivate();
    this.adminToken.set('');
    if (this.sessionExpired) return;
    this.sessionExpired = true;
    if (clearSession) this.admin.clearAdminSession();
    void this.router.navigate(['/admin/login'], {
      queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
    });
  }

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => {
      this.read.dispose();
      this.mutation.dispose();
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.mutation.resetReceiptView();
        this.read.setScope(params.get('expenseId') ?? undefined);
        this.search.set('');
        this.statusFilter.set('all');
        void this.loadExpenses();
      });
  }

  loadExpenses(preserveEdits = false): Promise<void> {
    return this.read.load(preserveEdits);
  }

  createExpense(): Promise<void> {
    return this.mutation.create();
  }

  verifyExpenseCreation(): Promise<void> {
    return this.mutation.verifyCreationReceipt();
  }

  saveExpense(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    return this.mutation.save(expense, forcedStatus);
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setNewField(change: NewExpenseFieldChange): void {
    if (!this.canManageExpenses() || this.createUncertain()) return;
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
    if (!this.canManageExpenses()) return;
    this.read.setEditField(expenseId, change);
  }

  editFor(expenseId: string): ExpenseEdit {
    return this.read.editFor(expenseId);
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

  private resetDraftIfUnchanged(draft: NewExpenseDraft): void {
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
