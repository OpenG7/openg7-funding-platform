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

interface ExpenseEdit {
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

const expenseStatuses: readonly AdminExpenseStatus[] = [
  'draft',
  'published',
  'active',
  'private',
  'archived'
];

@Component({
  selector: 'openg7-admin-expenses-page',
  standalone: true,
  imports: [CommonModule, AdminLayoutComponent, TranslatePipe],
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

          <section
            class="create-panel"
            data-og7="allocation-create"
            aria-labelledby="create-title"
          >
            <header>
              <div>
                <span>{{ 'admin.legacy.nouvelle_entree' | translate }}</span>
                <h2 id="create-title">
                  {{
                    'admin.legacy.ajouter_une_depense_ou_allocation' | translate
                  }}
                </h2>
              </div>
            </header>

            <div class="create-grid">
              <label>
                {{ 'admin.legacy.projet_ou_fournisseur' | translate
                }}<input
                  type="text"
                  maxlength="160"
                  [value]="newProjectName()"
                  (input)="setNewProjectName($event)"
                />
              </label>
              <label>
                {{ 'admin.legacy.montant_cad' | translate
                }}<input
                  type="number"
                  min="0"
                  step="0.01"
                  [value]="newAmount()"
                  (input)="setNewAmount($event)"
                />
              </label>
              <label>
                {{ 'admin.legacy.statut' | translate
                }}<select [value]="newStatus()" (change)="setNewStatus($event)">
                  <option
                    *ngFor="let status of expenseStatuses"
                    [value]="status"
                  >
                    {{ statusLabel(status) }}
                  </option>
                </select>
              </label>
              <label class="span-3">
                {{ 'admin.legacy.description_publique' | translate
                }}<textarea
                  rows="3"
                  maxlength="1000"
                  [value]="newDescription()"
                  (input)="setNewDescription($event)"
                ></textarea>
              </label>
              <label class="span-3">
                {{ 'admin.legacy.resultat_attendu' | translate
                }}<textarea
                  rows="2"
                  maxlength="1000"
                  [value]="newExpectedOutcome()"
                  (input)="setNewExpectedOutcome($event)"
                ></textarea>
              </label>
              <label>
                {{ 'admin.legacy.avancement' | translate
                }}<select
                  [value]="newProgressStatus()"
                  (change)="setNewProgressStatus($event)"
                >
                  <option value="planned">
                    {{ 'admin.legacy.prevu' | translate }}
                  </option>
                  <option value="in_progress">
                    {{ 'admin.legacy.en_cours_134' | translate }}
                  </option>
                  <option value="delivered">
                    {{ 'admin.legacy.livre' | translate }}
                  </option>
                </select>
              </label>
              <label>
                {{ 'admin.legacy.preuve_publique' | translate
                }}<input
                  type="url"
                  [value]="newProofUrl()"
                  (input)="setNewProofUrl($event)"
                />
              </label>
              <label>
                {{ 'admin.legacy.source_de_la_preuve' | translate
                }}<input
                  type="text"
                  maxlength="500"
                  [value]="newProofSource()"
                  (input)="setNewProofSource($event)"
                />
              </label>
              <label>
                {{ 'admin.legacy.date_de_la_preuve' | translate
                }}<input
                  type="datetime-local"
                  [value]="newProofPublishedAt()"
                  (input)="setNewProofPublishedAt($event)"
                />
              </label>
            </div>

            <footer>
              <button
                type="button"
                [disabled]="mutationBusy()"
                (click)="createExpense()"
              >
                {{ 'admin.legacy.ajouter' | translate }}
              </button>
            </footer>
          </section>

          <section
            class="filters"
            [attr.aria-label]="'admin.legacy.filtres_depenses' | translate"
          >
            <label>
              {{ 'admin.legacy.recherche' | translate
              }}<input
                type="search"
                [attr.placeholder]="
                  'admin.legacy.projet_fournisseur_description' | translate
                "
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>
            <label>
              {{ 'admin.legacy.statut' | translate
              }}<select
                [value]="statusFilter()"
                (change)="setStatusFilter($event)"
              >
                <option value="all">
                  {{ 'admin.legacy.tous' | translate }}
                </option>
                <option *ngFor="let status of expenseStatuses" [value]="status">
                  {{ statusLabel(status) }}
                </option>
              </select>
            </label>
          </section>

          <section
            class="expense-list"
            [attr.aria-label]="'admin.legacy.liste_des_depenses' | translate"
          >
            <article
              class="expense-card"
              data-og7="allocation-card"
              [attr.data-og7-id]="expense.id"
              *ngFor="
                let expense of filteredExpenses();
                trackBy: trackByExpense
              "
            >
              <header>
                <div>
                  <span>{{ statusLabel(expense.status) }}</span>
                  <h2>{{ expense.project_name }}</h2>
                </div>
                <strong>{{
                  formatMoney(expense.amount_allocated, expense.currency)
                }}</strong>
                <button type="button" (click)="inspection.proof(expense)">
                  {{ 'admin.inspector.kinds.proof' | translate }}
                </button>
              </header>

              <div class="edit-grid">
                <label>
                  {{ 'admin.legacy.projet_ou_fournisseur' | translate
                  }}<input
                    type="text"
                    maxlength="160"
                    [value]="editFor(expense.id).projectName"
                    (input)="setEditField(expense.id, 'projectName', $event)"
                  />
                </label>
                <label>
                  {{ 'admin.legacy.montant_cad' | translate
                  }}<input
                    type="number"
                    min="0"
                    step="0.01"
                    [value]="editFor(expense.id).amountAllocated"
                    (input)="
                      setEditField(expense.id, 'amountAllocated', $event)
                    "
                  />
                </label>
                <label>
                  {{ 'admin.legacy.statut' | translate
                  }}<select
                    [value]="editFor(expense.id).status"
                    (change)="setEditField(expense.id, 'status', $event)"
                  >
                    <option
                      *ngFor="let status of expenseStatuses"
                      [value]="status"
                    >
                      {{ statusLabel(status) }}
                    </option>
                  </select>
                </label>
                <label>
                  {{ 'admin.legacy.date_publication' | translate
                  }}<input
                    type="datetime-local"
                    [value]="editFor(expense.id).publishedAt"
                    (input)="setEditField(expense.id, 'publishedAt', $event)"
                  />
                </label>
                <label class="span-3">
                  {{ 'admin.legacy.description_publique' | translate
                  }}<textarea
                    rows="3"
                    maxlength="1000"
                    [value]="editFor(expense.id).publicDescription"
                    (input)="
                      setEditField(expense.id, 'publicDescription', $event)
                    "
                  ></textarea>
                </label>
                <label class="span-3">
                  {{ 'admin.legacy.resultat_attendu' | translate
                  }}<textarea
                    rows="2"
                    maxlength="1000"
                    [value]="editFor(expense.id).expectedOutcome"
                    (input)="
                      setEditField(expense.id, 'expectedOutcome', $event)
                    "
                  ></textarea>
                </label>
                <label>
                  {{ 'admin.legacy.avancement' | translate
                  }}<select
                    [value]="editFor(expense.id).progressStatus"
                    (change)="
                      setEditField(expense.id, 'progressStatus', $event)
                    "
                  >
                    <option value="planned">
                      {{ 'admin.legacy.prevu' | translate }}
                    </option>
                    <option value="in_progress">
                      {{ 'admin.legacy.en_cours_134' | translate }}
                    </option>
                    <option value="delivered">
                      {{ 'admin.legacy.livre' | translate }}
                    </option>
                  </select>
                </label>
                <label>
                  {{ 'admin.legacy.preuve_publique' | translate
                  }}<input
                    type="url"
                    [value]="editFor(expense.id).proofUrl"
                    (input)="setEditField(expense.id, 'proofUrl', $event)"
                  />
                </label>
                <label>
                  {{ 'admin.legacy.source_de_la_preuve' | translate
                  }}<input
                    type="text"
                    maxlength="500"
                    [value]="editFor(expense.id).proofSource"
                    (input)="setEditField(expense.id, 'proofSource', $event)"
                  />
                </label>
                <label>
                  {{ 'admin.legacy.date_de_la_preuve' | translate
                  }}<input
                    type="datetime-local"
                    [value]="editFor(expense.id).proofPublishedAt"
                    (input)="
                      setEditField(expense.id, 'proofPublishedAt', $event)
                    "
                  />
                </label>
              </div>

              <footer>
                <button
                  type="button"
                  [disabled]="mutationBusy()"
                  (click)="saveExpense(expense)"
                >
                  {{ 'admin.legacy.enregistrer' | translate }}
                </button>
                <button
                  type="button"
                  class="approve"
                  [disabled]="mutationBusy()"
                  (click)="saveExpense(expense, 'published')"
                >
                  {{ 'admin.legacy.publier' | translate }}
                </button>
                <button
                  type="button"
                  class="neutral"
                  [disabled]="mutationBusy()"
                  (click)="saveExpense(expense, 'private')"
                >
                  {{ 'admin.legacy.masquer' | translate }}
                </button>
                <button
                  type="button"
                  class="reject"
                  [disabled]="mutationBusy()"
                  (click)="saveExpense(expense, 'archived')"
                >
                  {{ 'admin.legacy.archiver' | translate }}
                </button>
              </footer>
            </article>

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
      .create-panel,
      .expense-list,
      .expense-card {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .summary-grid,
      .create-panel,
      .filters,
      .expense-list,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .create-panel header,
      .expense-card header,
      .expense-card footer,
      .create-panel footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .summary-grid span,
      .create-panel span,
      .expense-card span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .create-panel h2,
      .expense-card h2,
      .empty-state h3 {
        margin: 0;
      }

      .admin-auth-panel,
      .summary-grid article,
      .create-panel,
      .filters,
      .expense-card,
      .empty-state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
      }

      .admin-auth-panel,
      .create-panel,
      .filters,
      .expense-card,
      .empty-state {
        padding: 1rem;
      }

      .admin-auth-panel {
        align-items: end;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
      }

      .admin-auth-panel p,
      .empty-state p {
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .summary-grid,
      .filters,
      .create-grid,
      .edit-grid {
        display: grid;
        gap: 0.75rem;
      }

      .summary-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .summary-grid article {
        padding: 1rem;
      }

      .summary-grid strong {
        display: block;
        font-size: 1.65rem;
        margin-top: 0.2rem;
      }

      .filters {
        grid-template-columns: minmax(14rem, 2fr) minmax(10rem, 1fr);
      }

      .create-grid,
      .edit-grid {
        grid-template-columns: minmax(14rem, 2fr) minmax(8rem, 0.8fr) minmax(
            9rem,
            1fr
          );
      }

      .span-3 {
        grid-column: 1 / -1;
      }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      input,
      select,
      textarea {
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      textarea {
        resize: vertical;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.55rem;
        padding: 0 0.85rem;
      }

      button.approve {
        background: #193d32;
      }

      button.neutral {
        background: var(--admin-panel-raised);
      }

      button.reject {
        background: #422532;
      }

      .expense-card footer {
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .state-error {
        color: var(--admin-danger);
        font-weight: 800;
      }

      @media (max-width: 900px) {
        .admin-shell,
        .admin-auth-panel,
        .summary-grid,
        .filters,
        .create-grid,
        .edit-grid {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .create-panel header,
        .expense-card header {
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
  private exactId: string | undefined;
  private readonly route = inject(ActivatedRoute);

  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);

  readonly expenseStatuses = expenseStatuses;
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

  async loadExpenses(): Promise<void> {
    const generation = ++this.requestGeneration;
    this.state.set('loading');

    try {
      const response = await this.admin.getExpenses(
        this.adminToken(),
        this.exactId
      );
      if (generation !== this.requestGeneration) return;
      this.response.set(response);
      this.expenseEdits.set(
        Object.fromEntries(
          response.expenses.map((expense) => [expense.id, this.toEdit(expense)])
        )
      );
      this.state.set('ready');
      this.conflict.set(false);
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.requestGeneration) return;
      this.state.set('error');
    }
  }

  async createExpense(): Promise<void> {
    if (this.mutationBusy()) return;
    const amount = Number(this.newAmount());
    if (
      !this.newProjectName().trim() ||
      !this.newDescription().trim() ||
      !this.newExpectedOutcome().trim() ||
      allocationAmountMinor(amount) === null
    ) {
      this.state.set('error');
      return;
    }

    try {
      if (
        isPublicAllocationStatus(this.newStatus()) &&
        !(await this.confirmation.confirm(
          this.i18n.t('admin.confirmation.publish'),
          `${this.newProjectName()} · ${this.formatMoney(amount, 'CAD')} · ${this.newDescription()} · ${this.newExpectedOutcome()} · ${this.newProofUrl()}`
        ))
      )
        return;
      this.mutationBusy.set(true);
      await this.admin.createExpense(this.adminToken(), {
        confirmation: isPublicAllocationStatus(this.newStatus())
          ? PUBLIC_ALLOCATION_CREATE_CONFIRMATION
          : undefined,
        projectName: this.newProjectName().trim(),
        publicDescription: this.newDescription().trim(),
        expectedOutcome: this.newExpectedOutcome().trim(),
        progressStatus: this.newProgressStatus(),
        proofUrl: this.newProofUrl().trim() || null,
        proofSource: this.newProofSource().trim() || null,
        proofPublishedAt: this.newProofPublishedAt()
          ? new Date(this.newProofPublishedAt()).toISOString()
          : null,
        amountAllocated: amount,
        currency: 'CAD',
        status: this.newStatus()
      });
      this.newProjectName.set('');
      this.newDescription.set('');
      this.newExpectedOutcome.set('');
      this.newAmount.set('');
      this.newStatus.set('draft');
      this.newProgressStatus.set('planned');
      this.newProofUrl.set('');
      this.newProofSource.set('');
      this.newProofPublishedAt.set('');
      await this.loadExpenses();
    } catch {
      this.state.set('error');
    } finally {
      this.mutationBusy.set(false);
    }
  }

  async saveExpense(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    if (this.mutationBusy()) return;
    const edit = this.editFor(expense.id);
    const amount = Number(edit.amountAllocated);

    if (allocationAmountMinor(amount) === null) {
      this.state.set('error');
      return;
    }

    try {
      const nextStatus = forcedStatus ?? edit.status;
      if (allocationRequiresConfirmation(expense.status, nextStatus)) {
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
      this.mutationBusy.set(true);
      await this.admin.updateExpense(this.adminToken(), {
        expenseId: expense.id,
        expectedVersion: expense.updated_at,
        confirmation: allocationRequiresConfirmation(expense.status, nextStatus)
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
          expense.proof_published_at
        ),
        amountAllocated: amount,
        currency: 'CAD',
        status: forcedStatus ?? edit.status,
        publishedAt: this.updatedDateTime(
          edit.publishedAt,
          expense.published_at
        )
      });
      await this.loadExpenses();
    } catch (error) {
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

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
  }

  setStatusFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.statusFilter.set(
      expenseStatuses.includes(value as AdminExpenseStatus)
        ? (value as AdminExpenseStatus)
        : 'all'
    );
  }

  setNewProjectName(event: Event): void {
    this.newProjectName.set(this.valueFromEvent(event));
  }

  setNewDescription(event: Event): void {
    this.newDescription.set(this.valueFromEvent(event));
  }

  setNewExpectedOutcome(event: Event): void {
    this.newExpectedOutcome.set(this.valueFromEvent(event));
  }

  setNewProgressStatus(event: Event): void {
    const value = this.valueFromEvent(event);
    this.newProgressStatus.set(
      value === 'in_progress' || value === 'delivered' ? value : 'planned'
    );
  }

  setNewProofUrl(event: Event): void {
    this.newProofUrl.set(this.valueFromEvent(event));
  }

  setNewProofSource(event: Event): void {
    this.newProofSource.set(this.valueFromEvent(event));
  }

  setNewProofPublishedAt(event: Event): void {
    this.newProofPublishedAt.set(this.valueFromEvent(event));
  }

  setNewAmount(event: Event): void {
    this.newAmount.set(this.valueFromEvent(event));
  }

  setNewStatus(event: Event): void {
    const value = this.valueFromEvent(event);
    this.newStatus.set(
      expenseStatuses.includes(value as AdminExpenseStatus)
        ? (value as AdminExpenseStatus)
        : 'draft'
    );
  }

  setEditField(
    expenseId: string,
    field: keyof ExpenseEdit,
    event: Event
  ): void {
    const value = this.valueFromEvent(event);
    this.expenseEdits.update((edits) => ({
      ...edits,
      [expenseId]: {
        ...(edits[expenseId] ?? this.emptyEdit()),
        [field]:
          field === 'status' &&
          expenseStatuses.includes(value as AdminExpenseStatus)
            ? (value as AdminExpenseStatus)
            : value
      }
    }));
  }

  editFor(expenseId: string): ExpenseEdit {
    return this.expenseEdits()[expenseId] ?? this.emptyEdit();
  }

  trackByExpense(_: number, expense: AdminExpenseRecord): string {
    return expense.id;
  }

  statusLabel(status: AdminExpenseStatus): string {
    const labels: Record<AdminExpenseStatus, string> = {
      draft: this.i18n.t('admin.legacy.brouillon'),
      published: this.i18n.t('admin.legacy.publiee'),
      active: this.i18n.t('admin.messages.active'),
      private: this.i18n.t('admin.messages.privee'),
      archived: this.i18n.t('admin.messages.archivee')
    };

    return labels[status];
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
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
