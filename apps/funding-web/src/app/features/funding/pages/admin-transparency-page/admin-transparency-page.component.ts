import { TranslatePipe } from '@ngx-translate/core';
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

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-transparency-page',
  standalone: true,
  imports: [TranslatePipe, CommonModule, AdminLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.transparence' | translate }}</h1>
          </div>
          <button type="button" (click)="loadTransparency()">
            {{ 'admin.legacy.actualiser' | translate }}
          </button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">
              {{ 'admin.legacy.acces_admin' | translate }}
            </h2>
            <p>
              {{
                'admin.legacy.vue_privee_des_donnees_qui_alimentent_la_transparence_publique'
                  | translate
              }}
            </p>
          </div>
        </section>

        <p class="state" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_de_la_transparence' | translate }}
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            'admin.legacy.impossible_de_charger_la_transparence_admin'
              | translate
          }}
        </p>

        <ng-container *ngIf="transparency() as data">
          <section
            class="summary-grid"
            [attr.aria-label]="'admin.legacy.resume_transparence' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.total_recu' | translate }}</span>
              <strong>
                {{
                  formatMoney(
                    data.public_summary.total_received,
                    data.public_summary.currency
                  )
                }}
              </strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.net_estime' | translate }}</span>
              <strong>
                {{
                  formatMoney(
                    data.public_summary.total_net,
                    data.public_summary.currency
                  )
                }}
              </strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.disponible_estime' | translate }}</span>
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
              <span>{{ 'admin.legacy.alloue_publie' | translate }}</span>
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

          <section
            class="status-grid"
            [attr.aria-label]="'admin.legacy.statuts_depenses' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.depenses' | translate }}</span>
              <strong>{{ data.expenses_summary.total_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.publiees' | translate }}</span>
              <strong>{{ data.expenses_summary.published_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.brouillons' | translate }}</span>
              <strong>{{ data.expenses_summary.draft_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.privees' | translate }}</span>
              <strong>{{ data.expenses_summary.private_count }}</strong>
            </article>
          </section>

          <section class="admin-panel" aria-labelledby="snapshot-title">
            <header>
              <div>
                <span>{{ data.public_summary.data_source }}</span>
                <h2 id="snapshot-title">
                  {{ 'admin.legacy.snapshot_public_courant' | translate }}
                </h2>
              </div>
              <small>{{
                'admin.legacy.mis_a_jour_p0'
                  | translate: { p0: dateLabel(data.last_updated_at) }
              }}</small>
            </header>

            <dl>
              <div>
                <dt>{{ 'admin.legacy.contributions' | translate }}</dt>
                <dd>{{ data.public_summary.contributions_count }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.frais' | translate }}</dt>
                <dd>
                  {{
                    formatMoney(
                      data.public_summary.total_fees,
                      data.public_summary.currency
                    )
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.remboursements' | translate }}</dt>
                <dd>
                  {{
                    formatMoney(
                      data.public_summary.total_refunded,
                      data.public_summary.currency
                    )
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.payouts' | translate }}</dt>
                <dd>
                  {{
                    formatMoney(
                      data.public_summary.total_payouts,
                      data.public_summary.currency
                    )
                  }}
                </dd>
              </div>
            </dl>
          </section>

          <section class="admin-panel" aria-labelledby="expenses-title">
            <header>
              <div>
                <span>{{
                  'admin.legacy.p0_entree_s_publiques'
                    | translate: { p0: publishedExpenses().length }
                }}</span>
                <h2 id="expenses-title">
                  {{
                    'admin.legacy.depenses_visibles_publiquement' | translate
                  }}
                </h2>
              </div>
            </header>

            <div class="table-scroll" *ngIf="publishedExpenses().length > 0">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'admin.legacy.projet' | translate }}</th>
                    <th>{{ 'admin.legacy.description' | translate }}</th>
                    <th>{{ 'admin.legacy.montant' | translate }}</th>
                    <th>{{ 'admin.legacy.publication' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="
                      let expense of publishedExpenses();
                      trackBy: trackByExpense
                    "
                  >
                    <td>{{ expense.project_name }}</td>
                    <td>{{ expense.public_description }}</td>
                    <td>
                      {{
                        formatMoney(expense.amount_allocated, expense.currency)
                      }}
                    </td>
                    <td>{{ dateLabel(expense.published_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <article
              class="empty-state"
              *ngIf="publishedExpenses().length === 0"
            >
              <h3>{{ 'admin.legacy.aucune_depense_publique' | translate }}</h3>
              <p>
                {{
                  'admin.legacy.publiez_une_depense_depuis_la_page_depenses'
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
        color: var(--admin-muted);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-muted);
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
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
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
        border-bottom: 1px solid var(--admin-border);
        padding: 0.7rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--admin-muted);
        font-size: 0.78rem;
        text-transform: uppercase;
      }

      .state-error {
        color: var(--admin-danger);
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
  readonly i18n = inject(FundingI18nService);
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
      this.transparency.set(
        await this.admin.getTransparency(this.adminToken())
      );
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
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
