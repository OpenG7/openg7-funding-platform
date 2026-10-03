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
  AdminContributionsResponse
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminStripeBackfillComponent } from '../../components/admin-stripe-backfill/admin-stripe-backfill.component.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';

import { AdminContributionsSummaryComponent } from './admin-contributions-summary.component.js';
import { AdminContributionsFiltersComponent } from './admin-contributions-filters.component.js';
import { AdminContributionsListComponent } from './admin-contributions-list.component.js';
import { AdminContributionsDetailComponent } from './admin-contributions-detail.component.js';
import { AdminContributionsExportComponent } from './admin-contributions-export.component.js';
import type {
  ContributionRowView,
  ContributionTypeFilter,
  PublicDisplayFilter
} from './admin-contributions-view.js';

type ContributionExportPhase = 'idle' | 'confirmation' | 'request';

@Component({
  selector: 'openg7-admin-contributions-page',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    AdminLayoutComponent,
    AdminStripeBackfillComponent,
    AdminContributionsSummaryComponent,
    AdminContributionsFiltersComponent,
    AdminContributionsListComponent,
    AdminContributionsDetailComponent,
    AdminContributionsExportComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-contributions-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-contributions-page.component.css'
  ]
})
export class AdminContributionsPageComponent implements OnInit {
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;
  private exportScopeGeneration = 0;

  readonly adminToken = signal<string>('');
  readonly data = signal<AdminContributionsResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private readonly exportPhase = signal<ContributionExportPhase>('idle');
  readonly exporting = computed(() => this.exportPhase() === 'request');
  readonly exportError = signal('');
  readonly canExport = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
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

  readonly contributionRows = computed(() =>
    this.filteredContributions().map((contribution) =>
      this.rowView(contribution)
    )
  );
  readonly selectedContributionView = computed(() => {
    const selected = this.selectedContribution();
    return selected ? this.rowView(selected) : null;
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
    this.exportError.set('');

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
    if (
      this.state() !== 'ready' ||
      this.exportPhase() !== 'idle' ||
      !this.canExport() ||
      !this.filteredContributions().length
    )
      return;
    const contributions = this.filteredContributions().map((row) => ({
      id: row.id,
      expectedVersion: row.updated_at
    }));
    const generation = this.loadGeneration;
    const scopeGeneration = this.exportScopeGeneration;
    const scopeIsCurrent = () =>
      generation === this.loadGeneration &&
      scopeGeneration === this.exportScopeGeneration &&
      this.canExport();
    this.exportPhase.set('confirmation');
    this.exportError.set('');
    try {
      if (
        !(await this.confirmation.confirm(
          this.i18n.t(
            contributions.length === 1
              ? 'admin.contributionsExport.confirmOne'
              : 'admin.contributionsExport.confirm',
            {
              count: contributions.length
            }
          )
        )) ||
        !scopeIsCurrent()
      )
        return;
      this.exportPhase.set('request');
      const csv = await this.admin.getContributionsCsv(this.adminToken(), {
        confirmation: 'export_private_contributions',
        contributions
      });
      if (!scopeIsCurrent()) return;
      this.saveCsv(csv);
    } catch (error) {
      if (!scopeIsCurrent()) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.exportError.set(
        `admin.contributionsExport.${status === 409 ? 'changed' : status === 403 ? 'forbidden' : status === 401 ? 'sessionExpired' : 'failed'}`
      );
    } finally {
      this.exportPhase.set('idle');
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setSearch(value: string): void {
    if (value !== this.search()) this.exportScopeGeneration++;
    this.search.set(value);
  }

  setTypeFilter(value: ContributionTypeFilter): void {
    if (value !== this.typeFilter()) this.exportScopeGeneration++;
    this.typeFilter.set(value);
  }

  setStatusFilter(value: string): void {
    if (value !== this.statusFilter()) this.exportScopeGeneration++;
    this.statusFilter.set(value);
  }

  setPublicFilter(value: PublicDisplayFilter): void {
    if (value !== this.publicFilter()) this.exportScopeGeneration++;
    this.publicFilter.set(value);
  }

  selectContribution(contributionId: string): void {
    this.selectedContributionId.set(contributionId);
    const url = new URL(window.location.href);
    url.searchParams.set('contributionId', contributionId);
    window.history.replaceState({}, '', url);
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

  private rowView(contribution: AdminContributionRecord): ContributionRowView {
    return {
      id: contribution.id,
      reference: contribution.public_reference,
      name: this.displayName(contribution),
      typeLabel: this.contributionTypeLabel(contribution),
      emailLabel: this.privateEmailLabel(contribution),
      paymentStatus: contribution.payment_status,
      publicDisplayLabel: this.publicDisplayLabel(contribution),
      sponsorStatusLabel: this.sponsorStatusLabel(contribution),
      amountLabel: this.formatMoney(contribution.amount, contribution.currency),
      dateLabel: this.dateLabel(contribution.paid_at || contribution.updated_at)
    };
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
