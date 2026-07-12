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
  AdminTransparencyResponse
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-transparency-page',
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
            <h1>Transparence</h1>
          </div>
          <button type="button" (click)="loadTransparency()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Vue privee des donnees qui alimentent la transparence publique.</p>
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

        <p class="state" *ngIf="state() === 'loading'">Chargement de la transparence...</p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger la transparence admin.
        </p>

        <ng-container *ngIf="transparency() as data">
          <section class="summary-grid" aria-label="Resume transparence">
            <article>
              <span>Total recu</span>
              <strong>
                {{ formatMoney(data.public_summary.total_received, data.public_summary.currency) }}
              </strong>
            </article>
            <article>
              <span>Net estime</span>
              <strong>
                {{ formatMoney(data.public_summary.total_net, data.public_summary.currency) }}
              </strong>
            </article>
            <article>
              <span>Disponible estime</span>
              <strong>
                {{
                  formatMoney(
                    data.public_summary.current_available_estimate,
                    data.public_summary.currency
                  )
                }}
              </strong>
            </article>
            <article>
              <span>Alloue publie</span>
              <strong>
                {{
                  formatMoney(
                    data.expenses_summary.published_allocated,
                    data.expenses_summary.currency
                  )
                }}
              </strong>
            </article>
          </section>

          <section class="status-grid" aria-label="Statuts depenses">
            <article>
              <span>Depenses</span>
              <strong>{{ data.expenses_summary.total_count }}</strong>
            </article>
            <article>
              <span>Publiees</span>
              <strong>{{ data.expenses_summary.published_count }}</strong>
            </article>
            <article>
              <span>Brouillons</span>
              <strong>{{ data.expenses_summary.draft_count }}</strong>
            </article>
            <article>
              <span>Privees</span>
              <strong>{{ data.expenses_summary.private_count }}</strong>
            </article>
          </section>

          <section class="admin-panel" aria-labelledby="snapshot-title">
            <header>
              <div>
                <span>{{ data.public_summary.data_source }}</span>
                <h2 id="snapshot-title">Snapshot public courant</h2>
              </div>
              <small>Mis a jour {{ dateLabel(data.last_updated_at) }}</small>
            </header>

            <dl>
              <div>
                <dt>Contributions</dt>
                <dd>{{ data.public_summary.contributions_count }}</dd>
              </div>
              <div>
                <dt>Frais</dt>
                <dd>{{ formatMoney(data.public_summary.total_fees, data.public_summary.currency) }}</dd>
              </div>
              <div>
                <dt>Remboursements</dt>
                <dd>
                  {{ formatMoney(data.public_summary.total_refunded, data.public_summary.currency) }}
                </dd>
              </div>
              <div>
                <dt>Payouts</dt>
                <dd>{{ formatMoney(data.public_summary.total_payouts, data.public_summary.currency) }}</dd>
              </div>
            </dl>
          </section>

          <section class="admin-panel" aria-labelledby="expenses-title">
            <header>
              <div>
                <span>{{ publishedExpenses().length }} entree(s) publiques</span>
                <h2 id="expenses-title">Depenses visibles publiquement</h2>
              </div>
            </header>

            <div class="table-scroll" *ngIf="publishedExpenses().length > 0">
              <table>
                <thead>
                  <tr>
                    <th>Projet</th>
                    <th>Description</th>
                    <th>Montant</th>
                    <th>Publication</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let expense of publishedExpenses(); trackBy: trackByExpense">
                    <td>{{ expense.project_name }}</td>
                    <td>{{ expense.public_description }}</td>
                    <td>{{ formatMoney(expense.amount_allocated, expense.currency) }}</td>
                    <td>{{ dateLabel(expense.published_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <article class="empty-state" *ngIf="publishedExpenses().length === 0">
              <h3>Aucune depense publique</h3>
              <p>Publiez une depense depuis la page Depenses.</p>
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
      .admin-panel {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .summary-grid,
      .status-grid,
      .admin-panel,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .admin-panel header {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .summary-grid span,
      .status-grid span,
      .admin-panel span,
      dt {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .admin-panel h2,
      .empty-state h3 {
        margin: 0;
      }

      .admin-auth-panel,
      .summary-grid article,
      .status-grid article,
      .admin-panel,
      .empty-state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
      }

      .admin-auth-panel,
      .admin-panel,
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
      .empty-state p,
      .admin-panel small {
        color: #526070;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .summary-grid,
      .status-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .summary-grid article,
      .status-grid article {
        padding: 1rem;
      }

      .summary-grid strong,
      .status-grid strong {
        display: block;
        font-size: 1.55rem;
        margin-top: 0.2rem;
      }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      input {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      button {
        background: #18233a;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      dl {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin: 0;
      }

      dd {
        font-size: 1.2rem;
        font-weight: 900;
        margin: 0.2rem 0 0;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 58rem;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid #e4e9f2;
        padding: 0.7rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: #667085;
        font-size: 0.78rem;
        text-transform: uppercase;
      }

      .state-error {
        color: #9f1d2f;
        font-weight: 800;
      }

      @media (max-width: 900px) {
        .admin-shell,
        .admin-auth-panel,
        .summary-grid,
        .status-grid,
        dl {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .admin-panel header {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminTransparencyPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly transparency = signal<AdminTransparencyResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly publishedExpenses = computed(
    () =>
      this.transparency()?.expenses.filter((expense) =>
        ['published', 'active'].includes(expense.status)
      ) ?? []
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadTransparency();
  }

  async loadTransparency(): Promise<void> {
    this.state.set('loading');

    try {
      this.transparency.set(await this.admin.getTransparency(this.adminToken()));
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      this.state.set('error');
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  trackByExpense(_: number, expense: AdminExpenseRecord): string {
    return expense.id;
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
