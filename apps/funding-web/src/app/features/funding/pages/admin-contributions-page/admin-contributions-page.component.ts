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
  AdminContributionRecord,
  AdminContributionsResponse,
  ContributionType
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type ContributionTypeFilter = 'all' | ContributionType;
type PublicDisplayFilter = 'all' | 'public' | 'private';

@Component({
  selector: 'openg7-admin-contributions-page',
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
            <h1>Contributions</h1>
          </div>
          <nav>
            <button type="button" (click)="loadContributions()">
              Actualiser
            </button>
            <button
              type="button"
              class="secondary"
              [disabled]="state() === 'loading' || contributions().length === 0"
              (click)="exportCsv()"
            >
              Export CSV
            </button>
          </nav>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Les donnees privees restent derriere le jeton admin.</p>
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

        <p class="state" *ngIf="state() === 'loading'">
          Chargement des contributions...
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger ou exporter les contributions. Verifiez le
          jeton, la base de donnees et les migrations.
        </p>

        <ng-container *ngIf="data() as response">
          <section class="admin-summary-grid" aria-label="Resume contributions">
            <article>
              <span>Total</span>
              <strong>{{ response.summary.total_count }}</strong>
            </article>
            <article>
              <span>Payees</span>
              <strong>{{ response.summary.paid_count }}</strong>
            </article>
            <article>
              <span>Commandites</span>
              <strong>{{ response.summary.sponsorship_count }}</strong>
            </article>
            <article>
              <span>Total recu</span>
              <strong>
                {{
                  formatMoney(
                    response.summary.total_received,
                    response.summary.currency
                  )
                }}
              </strong>
            </article>
          </section>

          <section class="filters" aria-label="Filtres contributions">
            <label>
              Recherche
              <input
                type="search"
                placeholder="Nom, courriel, référence, Stripe..."
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>

            <label>
              Type
              <select [value]="typeFilter()" (change)="setTypeFilter($event)">
                <option value="all">Tous</option>
                <option value="personal_support">
                  Contribution personnelle
                </option>
                <option value="sponsorship_interest">Commandite</option>
              </select>
            </label>

            <label>
              Statut paiement
              <select
                [value]="statusFilter()"
                (change)="setStatusFilter($event)"
              >
                <option value="all">Tous</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="refunded">Refunded</option>
                <option value="disputed">Disputed</option>
                <option value="expired">Expired</option>
                <option value="failed">Failed</option>
              </select>
            </label>

            <label>
              Affichage public
              <select
                [value]="publicFilter()"
                (change)="setPublicFilter($event)"
              >
                <option value="all">Tous</option>
                <option value="public">Consentis</option>
                <option value="private">Non publics</option>
              </select>
            </label>
          </section>

          <section
            class="admin-table-panel"
            aria-labelledby="contributions-title"
          >
            <header>
              <div>
                <span>{{ filteredContributions().length }} resultat(s)</span>
                <h2 id="contributions-title">Liste admin</h2>
              </div>
              <small
                >Mis a jour {{ dateLabel(response.last_updated_at) }}</small
              >
            </header>

            <div
              class="table-scroll"
              *ngIf="filteredContributions().length > 0"
            >
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Référence</th>
                    <th>Nom</th>
                    <th>Courriel</th>
                    <th>Statut</th>
                    <th>Public</th>
                    <th>Commandite</th>
                    <th>Montant</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="
                      let contribution of filteredContributions();
                      trackBy: trackByContribution
                    "
                  >
                    <td>{{ contributionTypeLabel(contribution) }}</td>
                    <td class="reference-cell">
                      {{ contribution.public_reference || 'Non attribuée' }}
                    </td>
                    <td>{{ displayName(contribution) }}</td>
                    <td>{{ privateEmailLabel(contribution) }}</td>
                    <td>{{ contribution.payment_status }}</td>
                    <td>{{ publicDisplayLabel(contribution) }}</td>
                    <td>{{ sponsorStatusLabel(contribution) }}</td>
                    <td>
                      {{
                        formatMoney(contribution.amount, contribution.currency)
                      }}
                    </td>
                    <td>
                      {{
                        dateLabel(
                          contribution.paid_at || contribution.updated_at
                        )
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <article
              class="empty-state"
              *ngIf="filteredContributions().length === 0"
            >
              <h3>Aucune contribution trouvee</h3>
              <p>Modifiez les filtres ou rechargez la liste admin.</p>
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

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .admin-summary-grid,
      .filters,
      .admin-table-panel,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .admin-topbar nav,
      .admin-table-panel header {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .admin-summary-grid span,
      .admin-table-panel span {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .admin-table-panel h2,
      .empty-state h3 {
        margin: 0;
      }

      button,
      input,
      select {
        border-radius: 0.35rem;
        font: inherit;
      }

      button {
        background: #18233a;
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      button.secondary {
        background: #254db8;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      .admin-auth-panel,
      .filters,
      .admin-summary-grid article,
      .admin-table-panel {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
      }

      .admin-auth-panel {
        align-items: end;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
        padding: 1rem;
      }

      .admin-auth-panel p,
      .admin-table-panel small,
      .empty-state p {
        color: #526070;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-auth-panel label,
      .filters label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      input,
      select {
        border: 1px solid #cdd6e3;
        padding: 0.65rem 0.75rem;
      }

      .admin-summary-grid,
      .filters {
        display: grid;
        gap: 0.75rem;
      }

      .admin-summary-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .filters {
        grid-template-columns: minmax(14rem, 2fr) repeat(3, minmax(10rem, 1fr));
        padding: 1rem;
      }

      .admin-summary-grid article {
        padding: 1rem;
      }

      .admin-summary-grid strong {
        display: block;
        font-size: 1.65rem;
        margin-top: 0.2rem;
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
        min-width: 74rem;
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

      td {
        overflow-wrap: anywhere;
      }

      .reference-cell {
        font-family:
          ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
        font-weight: 800;
        letter-spacing: 0;
      }

      .empty-state {
        background: #f7f9fc;
        border: 1px dashed #cdd6e3;
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .state-error {
        color: #9f1d2f;
        font-weight: 800;
      }

      @media (max-width: 1020px) {
        .admin-summary-grid,
        .filters {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-auth-panel,
        .admin-summary-grid,
        .filters {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .admin-topbar nav,
        .admin-table-panel header {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminContributionsPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly data = signal<AdminContributionsResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly search = signal<string>('');
  readonly typeFilter = signal<ContributionTypeFilter>('all');
  readonly statusFilter = signal<string>('all');
  readonly publicFilter = signal<PublicDisplayFilter>('all');

  readonly contributions = computed(() => this.data()?.contributions ?? []);
  readonly filteredContributions = computed(() => {
    const search = this.search().trim().toLowerCase();
    const typeFilter = this.typeFilter();
    const statusFilter = this.statusFilter();
    const publicFilter = this.publicFilter();

    return this.contributions().filter((contribution) => {
      const searchable = [
        contribution.id,
        contribution.public_reference,
        contribution.public_name,
        contribution.email_private,
        contribution.sponsor_company_name,
        contribution.sponsor_contact_name,
        contribution.sponsor_contact_email,
        contribution.stripe_session_id,
        contribution.stripe_payment_intent_id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (typeFilter === 'all' ||
          contribution.contribution_type === typeFilter) &&
        (statusFilter === 'all' ||
          contribution.payment_status === statusFilter) &&
        (publicFilter === 'all' ||
          (publicFilter === 'public'
            ? contribution.public_display_consent
            : !contribution.public_display_consent))
      );
    });
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadContributions();
  }

  async loadContributions(): Promise<void> {
    this.state.set('loading');

    try {
      this.data.set(await this.admin.getContributions(this.adminToken()));
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      this.state.set('error');
    }
  }

  async exportCsv(): Promise<void> {
    this.state.set('loading');

    try {
      const csv = await this.admin.getContributionsCsv(this.adminToken());
      this.saveCsv(csv);
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

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
  }

  setTypeFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.typeFilter.set(
      value === 'personal_support' || value === 'sponsorship_interest'
        ? value
        : 'all'
    );
  }

  setStatusFilter(event: Event): void {
    this.statusFilter.set(this.valueFromEvent(event) || 'all');
  }

  setPublicFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.publicFilter.set(
      value === 'public' || value === 'private' ? value : 'all'
    );
  }

  trackByContribution(
    _: number,
    contribution: AdminContributionRecord
  ): string {
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

  privateEmailLabel(contribution: AdminContributionRecord): string {
    return (
      contribution.sponsor_contact_email ||
      contribution.email_private ||
      'Non fourni'
    );
  }

  publicDisplayLabel(contribution: AdminContributionRecord): string {
    if (!contribution.public_display_consent) {
      return 'Non';
    }

    return contribution.display_amount_consent ? 'Nom et montant' : 'Nom seul';
  }

  sponsorStatusLabel(contribution: AdminContributionRecord): string {
    if (contribution.contribution_type !== 'sponsorship_interest') {
      return 'Sans objet';
    }

    if (contribution.sponsor_review_status === 'approved') {
      return 'Approuvee';
    }

    if (contribution.sponsor_review_status === 'rejected') {
      return 'Refusee';
    }

    return 'En attente';
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
    return (
      (event.target as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''
    );
  }

  private saveCsv(csv: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'openg7-admin-contributions.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
