import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AdminContributionRecord } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminAutomaticPreparationDirective } from '../../components/admin-automatic/admin-automatic-preparation.directive.js';
import { AdminStripeBackfillComponent } from '../../components/admin-stripe-backfill/admin-stripe-backfill.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { guidanceContributionId } from '../../services/admin-guidance-state.js';
import { AdminPaymentJourneyComponent } from '../../components/admin-guidance/admin-payment-journey.component.js';
import { AdminPaymentJourneyService } from '../../components/admin-guidance/admin-payment-journey.service.js';
import { highlightGuidanceRegions } from '../../components/admin-guidance/admin-guidance-highlight.js';
import { revealGuidanceRegion } from '../../components/admin-guidance/admin-guidance-scroll.js';
import { revealControllerFocus } from '../../components/admin-controller/admin-controller-navigation.js';

import { AdminContributionsSummaryComponent } from './admin-contributions-summary.component.js';
import { AdminContributionsFiltersComponent } from './admin-contributions-filters.component.js';
import { AdminContributionsListComponent } from './admin-contributions-list.component.js';
import { AdminContributionsDetailComponent } from './admin-contributions-detail.component.js';
import { AdminContributionsExportComponent } from './admin-contributions-export.component.js';
import { AdminContributionsController } from './admin-contributions-controller.js';
import { AdminContributionsExportWorkflow } from './admin-contributions-export-workflow.js';
import { adminContributionsBrowser } from './admin-contributions-browser.js';
import type {
  ContributionRowView,
  ContributionTypeFilter,
  PublicDisplayFilter
} from './admin-contributions-view.js';

@Component({
  selector: 'openg7-admin-contributions-page',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    AdminLayoutComponent,
    AdminAutomaticPreparationDirective,
    AdminStripeBackfillComponent,
    AdminContributionsSummaryComponent,
    AdminContributionsFiltersComponent,
    AdminContributionsListComponent,
    AdminContributionsDetailComponent,
    AdminPaymentJourneyComponent,
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
  readonly guidance = inject(AdminGuidanceService);
  readonly journey = inject(AdminPaymentJourneyService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private sessionExpired = false;
  private readonly destroy = inject(DestroyRef);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focusJourneyId = signal<string | null>(null);
  private releaseJourneyHighlight: (() => void) | null = null;
  readonly missingJourneyTarget = signal(false);
  readonly invalidContributionLink = signal(false);
  readonly adminToken = signal<string>('');
  readonly canExport = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  private readonly controller = new AdminContributionsController({
    admin: this.admin,
    token: () => this.adminToken(),
    canExport: () => this.canExport(),
    accessRevision: () => this.admin.sessionGeneration(),
    unauthorized: () => this.expireSession(true)
  });
  private readonly exportWorkflow = new AdminContributionsExportWorkflow({
    admin: this.admin,
    confirmation: this.confirmation,
    token: () => this.adminToken(),
    ready: () => this.state() === 'ready',
    scopeRevision: () =>
      this.controller.exportScopeRevision() + this.admin.sessionGeneration(),
    canExport: () => this.canExport(),
    contributions: () => this.filteredContributions(),
    t: (key, params) => this.i18n.t(key, params),
    saveCsv: (csv) => adminContributionsBrowser()?.saveCsv(csv),
    unauthorized: () => this.expireSession(true)
  });
  readonly data = this.controller.data;
  readonly state = this.controller.state;
  readonly readError = this.controller.readError;
  readonly search = this.controller.search;
  readonly selectedContributionId = this.controller.selectedContributionId;
  readonly typeFilter = this.controller.typeFilter;
  readonly statusFilter = this.controller.statusFilter;
  readonly publicFilter = this.controller.publicFilter;
  readonly contributions = this.controller.contributions;
  readonly selectedContribution = this.controller.selectedContribution;
  readonly filteredContributions = this.controller.filteredContributions;
  readonly exporting = this.exportWorkflow.exporting;
  readonly exportError = this.exportWorkflow.error;

  readonly contributionRows = computed(() =>
    this.filteredContributions().map((contribution) =>
      this.rowView(contribution)
    )
  );
  readonly selectedContributionView = computed(() => {
    const selected = this.selectedContribution();
    return selected ? this.rowView(selected) : null;
  });
  readonly missingContribution = computed(
    () =>
      this.state() === 'ready' &&
      !!this.selectedContributionId() &&
      !this.selectedContributionView()
  );

  constructor() {
    let identity = this.admin.identity();
    let sessionGeneration = this.admin.sessionGeneration();
    effect(() => {
      const nextIdentity = this.admin.identity();
      const nextGeneration = this.admin.sessionGeneration();
      if (identity === nextIdentity && sessionGeneration === nextGeneration)
        return;
      const sessionChanged = sessionGeneration !== nextGeneration;
      identity = nextIdentity;
      sessionGeneration = nextGeneration;
      untracked(() => {
        this.controller.notifyAccessChanged();
        this.exportWorkflow.clearError();
        if (sessionChanged) this.expireSession();
        else void this.loadContributions();
      });
    });
    effect(() => {
      const id =
        this.state() === 'ready'
          ? (this.selectedContributionView()?.id ?? null)
          : null;
      this.journey.data();
      untracked(() => {
        this.journey.connect(id);
        this.clearJourneyHighlight();
      });
    });
    afterRenderEffect(() => {
      const id = this.focusJourneyId();
      if (
        !id ||
        id !== this.selectedContributionView()?.id ||
        this.state() !== 'ready'
      )
        return;
      const heading = this.element.nativeElement.querySelector<HTMLElement>(
        '[data-og7="payment-journey-heading"]'
      );
      if (!heading) return;
      this.focusJourneyId.set(null);
      const active = heading.ownerDocument.activeElement;
      if (
        active?.matches('input, textarea, select') ||
        heading.ownerDocument.querySelector('dialog[open]')
      )
        return;
      revealControllerFocus(heading);
    });
  }

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroy.onDestroy(() => {
      this.controller.dispose();
      this.exportWorkflow.dispose();
      this.journey.disconnect();
      this.clearJourneyHighlight();
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        const ids = params.getAll('contributionId');
        const id = ids.length === 1 ? guidanceContributionId(ids[0]) : null;
        this.invalidContributionLink.set(ids.length > 0 && !id);
        this.focusJourneyId.set(id);
        if (this.invalidContributionLink()) {
          this.journey.disconnect();
          this.controller.notifyAccessChanged();
          return;
        }
        this.journey.disconnect();
        this.controller.setRouteContribution(id);
        void this.loadContributions();
      });
  }

  loadContributions(): Promise<void> {
    this.exportWorkflow.clearError();
    if (this.invalidContributionLink()) return Promise.resolve();
    return this.controller.load();
  }

  private expireSession(clearSession = false): void {
    this.controller.notifyAccessChanged();
    this.exportWorkflow.clearError();
    this.adminToken.set('');
    if (this.sessionExpired) return;
    this.sessionExpired = true;
    if (clearSession) this.admin.clearAdminSession();
    void this.router.navigate(['/admin/login'], {
      queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
    });
  }

  exportCsv(): Promise<void> {
    return this.exportWorkflow.exportCsv();
  }

  setAdminToken(event: Event): void {
    const token = this.valueFromEvent(event);
    if (token !== this.adminToken()) this.controller.notifyAccessChanged();
    this.adminToken.set(token);
    this.admin.saveAdminToken(this.adminToken());
  }

  setSearch(value: string): void {
    this.controller.setSearch(value);
  }

  setTypeFilter(value: ContributionTypeFilter): void {
    this.controller.setTypeFilter(value);
  }

  setStatusFilter(value: string): void {
    this.controller.setStatusFilter(value);
  }

  setPublicFilter(value: PublicDisplayFilter): void {
    this.controller.setPublicFilter(value);
  }

  selectContribution(contributionId: string): void {
    const id = guidanceContributionId(contributionId);
    if (!id || !this.contributions().some((item) => item.id === id)) return;
    this.controller.selectContribution(id);
    this.journey.connect(id);
    this.focusJourneyId.set(id);
    void this.router.navigate(['/admin/fundraiser/contributions'], {
      queryParams: { contributionId: id },
      replaceUrl: true
    });
  }

  followPayment(contributionId: string): void {
    if (contributionId !== this.selectedContributionView()?.id) return;
    this.guidance.followPayment(contributionId, true);
    this.journey.connect(contributionId);
    this.focusJourneyId.set(contributionId);
  }

  showJourneyTarget(hook: string): void {
    this.clearJourneyHighlight();
    if (!/^[a-z0-9-]+$/.test(hook)) return;
    const region = this.element.nativeElement
      .querySelector<HTMLElement>('[data-og7="contributions-page"]')
      ?.querySelector<HTMLElement>(`[data-og7="${hook}"]`);
    const view = region?.ownerDocument.defaultView;
    if (
      !region ||
      !view ||
      !region.getClientRects().length ||
      view.getComputedStyle(region).visibility === 'hidden'
    ) {
      this.missingJourneyTarget.set(true);
      return;
    }
    const target =
      region.querySelector<HTMLElement>('h1, h2, h3, legend') ?? region;
    const tabindex = target.getAttribute('tabindex');
    if (tabindex === null) target.setAttribute('tabindex', '-1');
    const release = highlightGuidanceRegions([region], view);
    this.releaseJourneyHighlight = () => {
      release();
      if (tabindex === null) target.removeAttribute('tabindex');
    };
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant'
    });
    revealGuidanceRegion(region, target, undefined, view);
  }

  private clearJourneyHighlight(): void {
    this.releaseJourneyHighlight?.();
    this.releaseJourneyHighlight = null;
    this.missingJourneyTarget.set(false);
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
}
