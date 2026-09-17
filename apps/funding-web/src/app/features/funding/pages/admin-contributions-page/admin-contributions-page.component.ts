import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  AdminContributionRecord,
  AdminContributionsResponse,
  ContributionType
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type ContributionTypeFilter = 'all' | ContributionType;
type PublicDisplayFilter = 'all' | 'public' | 'private';

@Component({
  selector: 'openg7-admin-contributions-page',
  standalone: true,
  imports: [TranslatePipe, CommonModule, AdminLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.contributions' | translate }}</h1>
          </div>
          <nav>
            <button type="button" (click)="loadContributions()">
              {{ 'admin.legacy.actualiser' | translate }}
            </button>
            <button
              type="button"
              class="secondary"
              [disabled]="state() === 'loading' || contributions().length === 0"
              (click)="exportCsv()"
            >
              {{ 'admin.legacy.export_csv' | translate }}
            </button>
          </nav>
        </header>

        <p class="state" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_des_contributions' | translate }}
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            'admin.legacy.impossible_de_charger_ou_exporter_les_contributions_verifiez_le_j'
              | translate
          }}
        </p>

        <ng-container *ngIf="data() as response">
          <section
            class="detail-panel"
            *ngIf="selectedContribution() as selected"
            aria-live="polite"
            aria-labelledby="selected-contribution-title"
          >
            <h3 id="selected-contribution-title">
              {{ 'admin.legacy.detail_de_la_contribution' | translate }}
            </h3>
            <dl>
              <div>
                <dt>{{ 'admin.legacy.reference' | translate }}</dt>
                <dd>
                  {{
                    selected.public_reference ||
                      ('admin.legacy.non_attribuee' | translate)
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.nom' | translate }}</dt>
                <dd>{{ displayName(selected) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.type' | translate }}</dt>
                <dd>{{ contributionTypeLabel(selected) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.statut' | translate }}</dt>
                <dd>{{ selected.payment_status }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.montant' | translate }}</dt>
                <dd>{{ formatMoney(selected.amount, selected.currency) }}</dd>
              </div>
              <div>
                <dt>{{ 'admin.legacy.date' | translate }}</dt>
                <dd>
                  {{ dateLabel(selected.paid_at || selected.updated_at) }}
                </dd>
              </div>
            </dl>
          </section>

          <section
            class="admin-summary-grid"
            [attr.aria-label]="'admin.legacy.resume_contributions' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.total' | translate }}</span>
              <strong>{{ response.summary.total_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.payees' | translate }}</span>
              <strong>{{ response.summary.paid_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.commandites' | translate }}</span>
              <strong>{{ response.summary.sponsorship_count }}</strong>
            </article>
            <article>
              <span>{{ 'admin.legacy.total_recu' | translate }}</span>
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

          <section
            class="filters"
            [attr.aria-label]="'admin.legacy.filtres_contributions' | translate"
          >
            <label>
              {{ 'admin.legacy.recherche' | translate
              }}<input
                type="search"
                [attr.placeholder]="
                  'admin.legacy.nom_courriel_reference_stripe' | translate
                "
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>

            <label>
              {{ 'admin.legacy.type' | translate
              }}<select [value]="typeFilter()" (change)="setTypeFilter($event)">
                <option value="all">
                  {{ 'admin.legacy.tous' | translate }}
                </option>
                <option value="personal_support">
                  {{ 'admin.legacy.contribution_personnelle' | translate }}
                </option>
                <option value="sponsorship_interest">
                  {{ 'admin.legacy.commandite' | translate }}
                </option>
              </select>
            </label>

            <label>
              {{ 'admin.legacy.statut_paiement' | translate
              }}<select
                [value]="statusFilter()"
                (change)="setStatusFilter($event)"
              >
                <option value="all">
                  {{ 'admin.legacy.tous' | translate }}
                </option>
                <option value="pending">
                  {{ 'admin.legacy.pending' | translate }}
                </option>
                <option value="paid">
                  {{ 'admin.legacy.paid' | translate }}
                </option>
                <option value="refunded">
                  {{ 'admin.legacy.refunded' | translate }}
                </option>
                <option value="disputed">
                  {{ 'admin.legacy.disputed' | translate }}
                </option>
                <option value="expired">
                  {{ 'admin.legacy.expired' | translate }}
                </option>
                <option value="failed">
                  {{ 'admin.legacy.failed' | translate }}
                </option>
              </select>
            </label>

            <label>
              {{ 'admin.legacy.affichage_public' | translate
              }}<select
                [value]="publicFilter()"
                (change)="setPublicFilter($event)"
              >
                <option value="all">
                  {{ 'admin.legacy.tous' | translate }}
                </option>
                <option value="public">
                  {{ 'admin.legacy.consentis' | translate }}
                </option>
                <option value="private">
                  {{ 'admin.legacy.non_publics' | translate }}
                </option>
              </select>
            </label>
          </section>

          <section
            class="admin-table-panel"
            aria-labelledby="contributions-title"
          >
            <header>
              <div>
                <span>{{
                  'admin.legacy.p0_resultat_s'
                    | translate: { p0: filteredContributions().length }
                }}</span>
                <h2 id="contributions-title">
                  {{ 'admin.legacy.liste_admin' | translate }}
                </h2>
              </div>
              <small>{{
                'admin.legacy.mis_a_jour_p0'
                  | translate: { p0: dateLabel(response.last_updated_at) }
              }}</small>
            </header>

            <div
              class="table-scroll"
              *ngIf="filteredContributions().length > 0"
            >
              <table>
                <thead>
                  <tr>
                    <th>{{ 'admin.legacy.type' | translate }}</th>
                    <th>{{ 'admin.legacy.reference' | translate }}</th>
                    <th>{{ 'admin.legacy.nom' | translate }}</th>
                    <th>{{ 'admin.legacy.courriel' | translate }}</th>
                    <th>{{ 'admin.legacy.statut' | translate }}</th>
                    <th>{{ 'admin.legacy.public' | translate }}</th>
                    <th>{{ 'admin.legacy.commandite' | translate }}</th>
                    <th>{{ 'admin.legacy.montant' | translate }}</th>
                    <th>{{ 'admin.legacy.date' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="
                      let contribution of filteredContributions();
                      trackBy: trackByContribution
                    "
                    [class.selected-row]="
                      selectedContributionId() === contribution.id
                    "
                    tabindex="0"
                    (click)="selectContribution(contribution.id)"
                    (keydown.enter)="selectContribution(contribution.id)"
                    (keydown.space)="selectContribution(contribution.id)"
                  >
                    <td>{{ contributionTypeLabel(contribution) }}</td>
                    <td class="reference-cell">
                      {{
                        contribution.public_reference ||
                          ('admin.legacy.non_attribuee' | translate)
                      }}
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
              <h3>
                {{ 'admin.legacy.aucune_contribution_trouvee' | translate }}
              </h3>
              <p>
                {{
                  'admin.legacy.modifiez_les_filtres_ou_rechargez_la_liste_admin'
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
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border: 0;
        color: var(--admin-text);
        cursor: pointer;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      button.secondary {
        background: var(--admin-panel-raised);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      .admin-auth-panel,
      .filters,
      .admin-summary-grid article,
      .admin-table-panel {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-muted);
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
        border: 1px solid var(--admin-border);
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

      td {
        overflow-wrap: anywhere;
      }

      .reference-cell {
        font-family:
          ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
        font-weight: 800;
        letter-spacing: 0;
      }

      .detail-panel {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .detail-panel h3 {
        margin: 0 0 0.75rem;
      }

      .detail-panel dl {
        display: grid;
        gap: 0.65rem;
        margin: 0;
      }

      .detail-panel div {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
      }

      .detail-panel dt {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .detail-panel dd {
        margin: 0;
        font-weight: 800;
      }

      .selected-row {
        background: var(--admin-panel-raised);
      }

      .empty-state {
        background: var(--admin-panel-raised);
        border: 1px dashed var(--admin-border);
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .state-error {
        color: var(--admin-danger);
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
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;

  readonly adminToken = signal<string>('');
  readonly data = signal<AdminContributionsResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly search = signal<string>('');
  readonly selectedContributionId = signal<string | null>(null);
  readonly typeFilter = signal<ContributionTypeFilter>('all');
  readonly statusFilter = signal<string>('all');
  readonly publicFilter = signal<PublicDisplayFilter>('all');

  readonly contributions = computed(() => this.data()?.contributions ?? []);
  readonly selectedContribution = computed(() => {
    const selectedId = this.selectedContributionId();
    if (!selectedId) {
      return null;
    }

    return this.contributions().find((item) => item.id === selectedId) ?? null;
  });
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

    this.destroy.onDestroy(() => this.loadGeneration++);
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        const contributionId = params.get('contributionId')?.trim() || null;
        this.selectedContributionId.set(contributionId);
        this.search.set('');
        this.typeFilter.set('all');
        this.statusFilter.set('all');
        this.publicFilter.set('all');
        this.data.set(null);
        void this.loadContributions();
      });
  }

  async loadContributions(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.state.set('loading');

    try {
      const response = await this.admin.getContributions(
        this.adminToken(),
        this.route.snapshot.queryParamMap.get('contributionId') ?? undefined
      );
      if (generation !== this.loadGeneration) return;
      this.data.set(response);
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.loadGeneration) return;
      this.state.set('error');
    }
  }

  async exportCsv(): Promise<void> {
    if (this.state() === 'loading') return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.exportPrivate')
      ))
    )
      return;
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

  selectContribution(contributionId: string): void {
    this.selectedContributionId.set(contributionId);
    const url = new URL(window.location.href);
    url.searchParams.set('contributionId', contributionId);
    window.history.replaceState({}, '', url);
  }

  trackByContribution(
    _: number,
    contribution: AdminContributionRecord
  ): string {
    return contribution.id;
  }

  contributionTypeLabel(contribution: AdminContributionRecord): string {
    return contribution.contribution_type === 'sponsorship_interest'
      ? this.i18n.t('admin.legacy.commandite')
      : this.i18n.t('admin.dashboard.contribution');
  }

  displayName(contribution: AdminContributionRecord): string {
    return (
      contribution.sponsor_company_name ||
      contribution.public_name ||
      contribution.email_private ||
      this.i18n.t('admin.dashboard.unnamed')
    );
  }

  privateEmailLabel(contribution: AdminContributionRecord): string {
    return (
      contribution.sponsor_contact_email ||
      contribution.email_private ||
      this.i18n.t('admin.legacy.non_fourni')
    );
  }

  publicDisplayLabel(contribution: AdminContributionRecord): string {
    if (!contribution.public_display_consent) {
      return this.i18n.t('admin.dossier.no');
    }

    return contribution.display_amount_consent
      ? this.i18n.t('admin.messages.nom_et_montant')
      : this.i18n.t('admin.messages.nom_seul');
  }

  sponsorStatusLabel(contribution: AdminContributionRecord): string {
    if (contribution.contribution_type !== 'sponsorship_interest') {
      return this.i18n.t('admin.messages.sans_objet');
    }

    if (contribution.sponsor_review_status === 'approved') {
      return this.i18n.t('admin.messages.approuvee');
    }

    if (contribution.sponsor_review_status === 'rejected') {
      return this.i18n.t('admin.messages.refusee');
    }

    return this.i18n.t('admin.legacy.en_attente');
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
