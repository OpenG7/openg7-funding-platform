import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type { AdminContributionRecord, AdminDashboardResponse } from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-dashboard-page',
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
            <h1>Dashboard du fonds</h1>
          </div>
          <button type="button" (click)="loadDashboard()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Utilisez le jeton configure dans <code>FUNDING_ADMIN_TOKEN</code>.</p>
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

        <p class="state" *ngIf="state() === 'loading'">Chargement du dashboard...</p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger le dashboard admin. Verifiez le jeton, la base
          de donnees et les migrations.
        </p>

        <ng-container *ngIf="dashboard() as data">
          <section class="admin-metrics" aria-label="Indicateurs du fonds">
            <article>
              <span>Total recu</span>
              <strong>{{ formatMoney(data.totals.total_received, data.totals.currency) }}</strong>
            </article>
            <article>
              <span>Disponible estime</span>
              <strong>
                {{ formatMoney(data.totals.current_available_estimate, data.totals.currency) }}
              </strong>
            </article>
            <article>
              <span>Contributions</span>
              <strong>{{ data.totals.contributions_count }}</strong>
              <small>{{ data.totals.paid_contributions_count }} payees</small>
            </article>
            <article>
              <span>Commandites en attente</span>
              <strong>{{ data.sponsorship_review.pending }}</strong>
              <small>{{ data.sponsorship_review.approved }} approuvees</small>
            </article>
          </section>

          <section class="admin-panels">
            <article>
              <header>
                <span>Revue commandites</span>
                <strong>{{ data.sponsorship_review.total }}</strong>
              </header>
              <dl>
                <div>
                  <dt>En attente</dt>
                  <dd>{{ data.sponsorship_review.pending }}</dd>
                </div>
                <div>
                  <dt>Approuvees</dt>
                  <dd>{{ data.sponsorship_review.approved }}</dd>
                </div>
                <div>
                  <dt>Refusees</dt>
                  <dd>{{ data.sponsorship_review.rejected }}</dd>
                </div>
              </dl>
            </article>

            <article>
              <header>
                <span>Publications feed</span>
                <strong>{{ data.feed_publication.active }}</strong>
              </header>
              <dl>
                <div>
                  <dt>Planifiees</dt>
                  <dd>{{ data.feed_publication.planned }}</dd>
                </div>
                <div>
                  <dt>Brouillons</dt>
                  <dd>{{ data.feed_publication.drafted }}</dd>
                </div>
                <div>
                  <dt>Publiees</dt>
                  <dd>{{ data.feed_publication.published }}</dd>
                </div>
              </dl>
            </article>

            <article>
              <header>
                <span>Stripe</span>
                <strong>{{ data.stripe_events.failed }}</strong>
              </header>
              <dl>
                <div>
                  <dt>Evenements en erreur</dt>
                  <dd>{{ data.stripe_events.failed }}</dd>
                </div>
                <div>
                  <dt>En traitement</dt>
                  <dd>{{ data.stripe_events.processing }}</dd>
                </div>
                <div>
                  <dt>Derniere erreur</dt>
                  <dd>{{ dateLabel(data.stripe_events.last_failed_at) }}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section class="admin-table-panel" aria-labelledby="recent-title">
            <header>
              <div>
                <span>Activite recente</span>
                <h2 id="recent-title">Dernieres contributions</h2>
              </div>
              <small>Mis a jour {{ dateLabel(data.last_updated_at) }}</small>
            </header>

            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Nom</th>
                    <th>Statut</th>
                    <th>Montant</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let contribution of recentContributions(); trackBy: trackByContribution"
                  >
                    <td>{{ contributionTypeLabel(contribution) }}</td>
                    <td>{{ displayName(contribution) }}</td>
                    <td>{{ contribution.payment_status }}</td>
                    <td>{{ formatMoney(contribution.amount, contribution.currency) }}</td>
                    <td>{{ dateLabel(contribution.paid_at || contribution.updated_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
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

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .admin-metrics,
      .admin-panels,
      .admin-table-panel,
      .state {
        margin: 0 auto;
        max-width: 72rem;
        width: 100%;
      }

      .admin-topbar {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .admin-metrics span,
      .admin-panels span,
      .admin-table-panel span,
      dt {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .admin-table-panel h2 {
        margin: 0;
      }

      .admin-topbar button,
      .admin-auth-panel input {
        border-radius: 0.35rem;
        font: inherit;
      }

      .admin-topbar button {
        background: #18233a;
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      .admin-auth-panel {
        align-items: end;
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
        padding: 1rem;
      }

      .admin-auth-panel p,
      .admin-metrics small,
      .admin-table-panel small {
        color: #526070;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-auth-panel label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      .admin-auth-panel input {
        border: 1px solid #cdd6e3;
        padding: 0.65rem 0.75rem;
      }

      .admin-metrics,
      .admin-panels {
        display: grid;
        gap: 0.75rem;
      }

      .admin-metrics {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .admin-panels {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .admin-metrics article,
      .admin-panels article,
      .admin-table-panel {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
      }

      .admin-metrics article,
      .admin-panels article {
        padding: 1rem;
      }

      .admin-metrics strong {
        display: block;
        font-size: 1.8rem;
        margin-top: 0.2rem;
      }

      .admin-panels article {
        display: grid;
        gap: 0.85rem;
      }

      .admin-panels header,
      .admin-table-panel header {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-panels header strong {
        font-size: 1.7rem;
      }

      dl {
        display: grid;
        gap: 0.55rem;
        margin: 0;
      }

      dl div {
        align-items: center;
        display: flex;
        justify-content: space-between;
      }

      dd {
        font-weight: 900;
        margin: 0;
      }

      .admin-table-panel {
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 44rem;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid #e4e9f2;
        padding: 0.7rem 0.5rem;
        text-align: left;
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

      @media (max-width: 980px) {
        .admin-metrics,
        .admin-panels {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-auth-panel,
        .admin-metrics,
        .admin-panels {
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
export class AdminDashboardPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly dashboard = signal<AdminDashboardResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly recentContributions = computed(
    () => this.dashboard()?.recent_contributions ?? []
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.state.set('loading');

    try {
      this.dashboard.set(await this.admin.getDashboard(this.adminToken()));
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

  trackByContribution(_: number, contribution: AdminContributionRecord): string {
    return contribution.id;
  }

  contributionTypeLabel(contribution: AdminContributionRecord): string {
    return contribution.contribution_type === 'sponsorship_interest'
      ? 'Commandite'
      : 'Contribution';
  }

  displayName(contribution: AdminContributionRecord): string {
    return (
      contribution.sponsor_company_name ||
      contribution.public_name ||
      contribution.email_private ||
      'Sans nom'
    );
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
