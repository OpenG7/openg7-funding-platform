import { CommonModule } from '@angular/common';
import {
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

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

interface ExpenseEdit {
  readonly projectName: string;
  readonly publicDescription: string;
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
  imports: [CommonModule, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>Depenses et allocations</h1>
          </div>
          <button type="button" (click)="loadExpenses()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Les depenses publiees alimentent la transparence publique.</p>
          </div>
          <label>
            Jeton admin
            <input
              type="password"
              autocomplete="off"
              [value]="adminToken()"
              (input)="setAdminToken($event)"
            />
          </label>
        </section>

        <p class="state" *ngIf="state() === 'loading'">Chargement des depenses...</p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger ou modifier les depenses.
        </p>

        <ng-container *ngIf="response() as data">
          <section class="summary-grid" aria-label="Resume depenses">
            <article>
              <span>Total</span>
              <strong>{{ data.summary.total_count }}</strong>
            </article>
            <article>
              <span>Publiees</span>
              <strong>{{ data.summary.published_count }}</strong>
            </article>
            <article>
              <span>Brouillons</span>
              <strong>{{ data.summary.draft_count }}</strong>
            </article>
            <article>
              <span>Montant publie</span>
              <strong>
                {{ formatMoney(data.summary.published_allocated, data.summary.currency) }}
              </strong>
            </article>
          </section>

          <section class="create-panel" aria-labelledby="create-title">
            <header>
              <div>
                <span>Nouvelle entree</span>
                <h2 id="create-title">Ajouter une depense ou allocation</h2>
              </div>
            </header>

            <div class="create-grid">
              <label>
                Projet ou fournisseur
                <input
                  type="text"
                  maxlength="160"
                  [value]="newProjectName()"
                  (input)="setNewProjectName($event)"
                />
              </label>
              <label>
                Montant CAD
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  [value]="newAmount()"
                  (input)="setNewAmount($event)"
                />
              </label>
              <label>
                Statut
                <select [value]="newStatus()" (change)="setNewStatus($event)">
                  <option *ngFor="let status of expenseStatuses" [value]="status">
                    {{ statusLabel(status) }}
                  </option>
                </select>
              </label>
              <label class="span-3">
                Description publique
                <textarea
                  rows="3"
                  maxlength="1000"
                  [value]="newDescription()"
                  (input)="setNewDescription($event)"
                ></textarea>
              </label>
            </div>

            <footer>
              <button type="button" (click)="createExpense()">Ajouter</button>
            </footer>
          </section>

          <section class="filters" aria-label="Filtres depenses">
            <label>
              Recherche
              <input
                type="search"
                placeholder="Projet, fournisseur, description..."
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>
            <label>
              Statut
              <select [value]="statusFilter()" (change)="setStatusFilter($event)">
                <option value="all">Tous</option>
                <option *ngFor="let status of expenseStatuses" [value]="status">
                  {{ statusLabel(status) }}
                </option>
              </select>
            </label>
          </section>

          <section class="expense-list" aria-label="Liste des depenses">
            <article
              class="expense-card"
              *ngFor="let expense of filteredExpenses(); trackBy: trackByExpense"
            >
              <header>
                <div>
                  <span>{{ statusLabel(expense.status) }}</span>
                  <h2>{{ expense.project_name }}</h2>
                </div>
                <strong>{{ formatMoney(expense.amount_allocated, expense.currency) }}</strong>
              </header>

              <div class="edit-grid">
                <label>
                  Projet ou fournisseur
                  <input
                    type="text"
                    maxlength="160"
                    [value]="editFor(expense.id).projectName"
                    (input)="setEditField(expense.id, 'projectName', $event)"
                  />
                </label>
                <label>
                  Montant CAD
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    [value]="editFor(expense.id).amountAllocated"
                    (input)="setEditField(expense.id, 'amountAllocated', $event)"
                  />
                </label>
                <label>
                  Statut
                  <select
                    [value]="editFor(expense.id).status"
                    (change)="setEditField(expense.id, 'status', $event)"
                  >
                    <option *ngFor="let status of expenseStatuses" [value]="status">
                      {{ statusLabel(status) }}
                    </option>
                  </select>
                </label>
                <label>
                  Date publication
                  <input
                    type="datetime-local"
                    [value]="editFor(expense.id).publishedAt"
                    (input)="setEditField(expense.id, 'publishedAt', $event)"
                  />
                </label>
                <label class="span-3">
                  Description publique
                  <textarea
                    rows="3"
                    maxlength="1000"
                    [value]="editFor(expense.id).publicDescription"
                    (input)="setEditField(expense.id, 'publicDescription', $event)"
                  ></textarea>
                </label>
              </div>

              <footer>
                <button type="button" (click)="saveExpense(expense)">Enregistrer</button>
                <button type="button" class="approve" (click)="saveExpense(expense, 'published')">
                  Publier
                </button>
                <button type="button" class="neutral" (click)="saveExpense(expense, 'private')">
                  Masquer
                </button>
                <button type="button" class="reject" (click)="saveExpense(expense, 'archived')">
                  Archiver
                </button>
              </footer>
            </article>

            <article class="empty-state" *ngIf="state() === 'ready' && filteredExpenses().length === 0">
              <h3>Aucune entree trouvee</h3>
              <p>Ajoutez une depense ou modifiez les filtres.</p>
            </article>
          </section>
        </ng-container>
      </section>
    </main>
  `,
  styles: [
    `
      .admin-shell {
        background: #f5f7fb;
        color: #172033;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        gap: 1rem;
        grid-template-columns: 15rem minmax(0, 1fr);
        min-height: 100vh;
        padding: 1.25rem;
      }

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
        color: #667085;
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
        background: #fff;
        border: 1px solid #d9e0ea;
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
        color: #526070;
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
        grid-template-columns: minmax(14rem, 2fr) minmax(8rem, 0.8fr) minmax(9rem, 1fr);
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
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      textarea {
        resize: vertical;
      }

      button {
        background: #18233a;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.55rem;
        padding: 0 0.85rem;
      }

      button.approve {
        background: #176236;
      }

      button.neutral {
        background: #254db8;
      }

      button.reject {
        background: #9f1d2f;
      }

      .expense-card footer {
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .state-error {
        color: #9f1d2f;
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
  readonly newAmount = signal<string>('');
  readonly newStatus = signal<AdminExpenseStatus>('draft');

  readonly expenses = computed(() => this.response()?.expenses ?? []);
  readonly filteredExpenses = computed(() => {
    const search = this.search().trim().toLowerCase();
    const status = this.statusFilter();

    return this.expenses().filter((expense) => {
      const searchable = [
        expense.project_name,
        expense.public_description,
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
    void this.loadExpenses();
  }

  async loadExpenses(): Promise<void> {
    this.state.set('loading');

    try {
      const response = await this.admin.getExpenses(this.adminToken());
      this.response.set(response);
      this.expenseEdits.set(
        Object.fromEntries(
          response.expenses.map((expense) => [expense.id, this.toEdit(expense)])
        )
      );
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      this.state.set('error');
    }
  }

  async createExpense(): Promise<void> {
    const amount = Number(this.newAmount());
    if (
      !this.newProjectName().trim() ||
      !this.newDescription().trim() ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      this.state.set('error');
      return;
    }

    try {
      await this.admin.createExpense(this.adminToken(), {
        projectName: this.newProjectName().trim(),
        publicDescription: this.newDescription().trim(),
        amountAllocated: amount,
        currency: 'CAD',
        status: this.newStatus()
      });
      this.newProjectName.set('');
      this.newDescription.set('');
      this.newAmount.set('');
      this.newStatus.set('draft');
      await this.loadExpenses();
    } catch {
      this.state.set('error');
    }
  }

  async saveExpense(
    expense: AdminExpenseRecord,
    forcedStatus?: AdminExpenseStatus
  ): Promise<void> {
    const edit = this.editFor(expense.id);
    const amount = Number(edit.amountAllocated);

    if (!Number.isFinite(amount) || amount <= 0) {
      this.state.set('error');
      return;
    }

    try {
      await this.admin.updateExpense(this.adminToken(), {
        expenseId: expense.id,
        projectName: edit.projectName,
        publicDescription: edit.publicDescription,
        amountAllocated: amount,
        currency: 'CAD',
        status: forcedStatus ?? edit.status,
        publishedAt: edit.publishedAt
          ? new Date(edit.publishedAt).toISOString()
          : null
      });
      await this.loadExpenses();
    } catch {
      this.state.set('error');
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
      draft: 'Brouillon',
      published: 'Publiee',
      active: 'Active',
      private: 'Privee',
      archived: 'Archivee'
    };

    return labels[status];
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
  }

  private toEdit(expense: AdminExpenseRecord): ExpenseEdit {
    return {
      projectName: expense.project_name,
      publicDescription: expense.public_description,
      amountAllocated: String(expense.amount_allocated),
      status: expense.status,
      publishedAt: this.toDateTimeLocal(expense.published_at)
    };
  }

  private emptyEdit(): ExpenseEdit {
    return {
      projectName: '',
      publicDescription: '',
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

    return date.toISOString().slice(0, 16);
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          | HTMLInputElement
          | HTMLSelectElement
          | HTMLTextAreaElement
          | null
      )?.value ?? ''
    );
  }
}
