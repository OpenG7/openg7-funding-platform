import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  DestroyRef,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  ContributionType,
  FundTransparencyPublicResponse,
  FundingSnapshot,
  PublicSponsorshipBatchAvailabilityResponse,
  PublicMonthlySummary
} from '@openg7/funding-core';
import { FundingProjectConfig } from '@openg7/funding-models';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { provideFundingProjectConfig } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';
import { FundingService } from '../../services/funding.service.js';
import {
  FundingContributionFormComponent,
  type FundingContributionSubmission
} from '../../components/funding-contribution-form/funding-contribution-form.component.js';
import { FundingCheckoutNoticeComponent } from '../../components/funding-checkout-notice/funding-checkout-notice.component.js';
import { FundingFinanceSummaryComponent } from '../../components/funding-finance-summary/funding-finance-summary.component.js';
import { CheckoutStatusMonitor } from '../../services/checkout-status-monitor.service.js';
import {
  currentFundingMonth,
  monthlyContributions
} from '../../models/funding-home.utils.js';
interface EcosystemCard {
  readonly id: number;
  readonly title: string;
  readonly descriptionKey: string;
  readonly asset: string;
}

interface FoundationPillar {
  readonly titleKey: string;
  readonly descriptionKey: string;
}

const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
@Component({
  selector: 'openg7-funding-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    FundingContributionFormComponent,
    FundingCheckoutNoticeComponent,
    FundingFinanceSummaryComponent
  ],
  providers: [
    provideFundingProjectConfig(OPENG7_FUNDING_CONFIG),
    CheckoutStatusMonitor
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-page.component.html'
})
export class FundingPageComponent implements OnInit, OnDestroy {
  private readonly fundingService = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);
  private readonly transparencyService = inject(FundTransparencyService);
  private transparencyRefreshId: number | null = null;
  readonly checkoutMonitor = inject(CheckoutStatusMonitor);
  private readonly destroyRef = inject(DestroyRef);
  private transparencyRequest: AbortController | null = null;
  readonly allowedContributionAmounts = signal<readonly number[]>(
    OPENG7_FUNDING_CONFIG.contributionAmounts
  );
  readonly sponsorshipBatchAvailability =
    signal<PublicSponsorshipBatchAvailabilityResponse | null>(null);
  readonly monthlySummary = signal<readonly PublicMonthlySummary[]>([]);
  readonly currentMonth = signal('');
  readonly currentMonthContributions = computed(() =>
    monthlyContributions(
      this.monthlySummary(),
      this.currentMonth(),
      this.currency()
    )
  );
  private readonly emptySnapshot: FundingSnapshot = {
    totals: {
      confirmedContributions: 0,
      transactionFees: 0,
      availableFunds: 0
    },
    allocation: [],
    contributors: []
  };

  readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  readonly sponsorshipSelectionEnabled = signal<boolean>(false);
  // This public intent only selects a form type; it never grants consent or confirms payment.
  readonly requestedContributionType: ContributionType =
    inject(ActivatedRoute).snapshot.queryParamMap.get('intent') ===
    'sponsorship'
      ? 'sponsorship_interest'
      : 'personal_support';

  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

  readonly snapshot = signal<FundingSnapshot>(this.emptySnapshot);
  readonly hasTransparencySnapshot = signal(false);

  readonly loadingState = signal<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  readonly checkoutResultMode = signal<'mocked' | null>(null);

  readonly pendingSponsorFollowupToken = signal<string | null>(null);
  readonly transparencyState = signal<'loading' | 'synced' | 'empty' | 'error'>(
    'loading'
  );
  readonly contributionCount = signal<number>(0);
  readonly currency = signal<string>(this.config.currency);
  readonly lastTransparencySync = signal<string | null>(null);
  readonly transparencySource =
    signal<FundTransparencyPublicResponse['data_source']>('empty');

  readonly campaignProgress = computed<number>(() => {
    const goal = this.config.monthlyGoal;
    if (goal <= 0) {
      return 0;
    }

    const ratio = (this.currentMonthContributions() / goal) * 100;
    return Math.min(100, Math.max(0, Math.round(ratio)));
  });

  readonly publicValueUnavailableLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    return this.i18n.t(
      this.transparencyState() === 'loading'
        ? 'funding.home.sync.loading'
        : 'funding.home.sync.unavailable'
    );
  });

  readonly campaignProgressLabel = computed<string>(() =>
    this.hasTransparencySnapshot()
      ? `${this.campaignProgress()} %`
      : this.publicValueUnavailableLabel()
  );

  readonly allocationTotal = computed<number>(() =>
    this.snapshot().allocation.reduce((sum, item) => sum + item.amount, 0)
  );

  readonly remainingForMonthlyGoal = computed<number>(() =>
    Math.max(0, this.config.monthlyGoal - this.currentMonthContributions())
  );

  readonly transparencyStatusLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    const state = this.transparencyState();
    if (state === 'loading') {
      return this.i18n.t('funding.home.status.syncing');
    }

    if (state === 'error') {
      if (this.hasTransparencySnapshot()) {
        return this.i18n
          .t('funding.home.status.stale')
          .replace('{{ date }}', this.lastTransparencySyncLabel());
      }
      return this.i18n.t('funding.home.status.unavailable');
    }

    if (state === 'empty') {
      return this.i18n.t('funding.home.status.empty');
    }

    return `${this.i18n.t('funding.home.status.synced')} ${this.lastTransparencySyncLabel()}`;
  });

  readonly lastTransparencySyncLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    const state = this.transparencyState();
    if (state === 'loading' && !this.hasTransparencySnapshot()) {
      return this.i18n.t('funding.home.sync.loading');
    }

    if (state === 'error' && !this.hasTransparencySnapshot()) {
      return this.i18n.t('funding.home.sync.unavailable');
    }

    const lastSync = this.lastTransparencySync();
    if (!lastSync) {
      return state === 'empty'
        ? this.i18n.t('funding.home.sync.pending')
        : this.i18n.t('funding.home.sync.notAvailable');
    }

    const date = new Date(lastSync);
    if (Number.isNaN(date.getTime())) {
      return this.i18n.t('funding.home.sync.notAvailable');
    }

    return date.toLocaleString(this.i18n.currentLanguage(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  readonly transparencySourceLabel = computed<string>(() =>
    !this.hasTransparencySnapshot()
      ? this.publicValueUnavailableLabel()
      : this.transparencySource() === 'database'
        ? this.i18n.t('funding.home.status.databaseRegistry')
        : this.i18n.t('funding.home.status.stripeRegistry')
  );

  readonly contributionCountLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    if (!this.hasTransparencySnapshot()) {
      return this.publicValueUnavailableLabel();
    }
    const count = this.contributionCount();
    return count === 1
      ? this.i18n.t('funding.home.contributionCount.one')
      : this.i18n
          .t('funding.home.contributionCount.many')
          .replace('{{ count }}', count.toString());
  });
  private readonly allocationPalette = [
    '#f4b53c',
    '#2f9fe5',
    '#58d79a',
    '#e5df80',
    '#e58a3e'
  ];

  readonly allocationDonut = computed<string>(() => {
    const total = this.allocationTotal();
    if (total <= 0) {
      return 'conic-gradient(#f4b53c 0 100%)';
    }

    let cursor = 0;
    const segments = this.snapshot().allocation.map((allocation, index) => {
      const start = cursor;
      cursor += (allocation.amount / total) * 100;
      return `${this.allocationColor(index)} ${start}% ${cursor}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  });

  readonly ecosystemCards: readonly EcosystemCard[] = [
    {
      id: 1,
      title: 'OpenG7 Social',
      descriptionKey: 'funding.home.cards.social',
      asset:
        'assets/openg7-social-communautes-connectees-canada-miniature-480.webp'
    },
    {
      id: 2,
      title: 'Migration Flow Engine',
      descriptionKey: 'funding.home.cards.migration',
      asset: 'assets/openg7-migration-flow-engine-canada-miniature-480.webp'
    },
    {
      id: 3,
      title: 'Firewall',
      descriptionKey: 'funding.home.cards.firewall',
      asset: 'assets/openg7-firewall-cybersecurite-canada-miniature-480.webp'
    },
    {
      id: 4,
      title: 'CA: Election Day Ops',
      descriptionKey: 'funding.home.cards.electionOps',
      asset:
        'assets/openg7-ca-election-day-ops-results-audit-miniature-480.webp'
    },
    {
      id: 5,
      title: 'CA: Voter Register',
      descriptionKey: 'funding.home.cards.voterRegister',
      asset: 'assets/openg7-ca-voter-register-official-docs-miniature-480.webp'
    },
    {
      id: 6,
      title: 'Canadian Vehicle Registry',
      descriptionKey: 'funding.home.cards.vehicleRegistry',
      asset: 'assets/openg7-canadian-vehicle-registry-miniature-480.webp'
    },
    {
      id: 7,
      title: 'GovGraph',
      descriptionKey: 'funding.home.cards.govgraph',
      asset: 'assets/openg7-govgraph-gouvernance-canada-miniature-480.webp'
    },
    {
      id: 8,
      title: 'Nexus',
      descriptionKey: 'funding.home.cards.nexus',
      asset: 'assets/openg7-nexus-carte-canada-connecte-miniature-480.webp'
    },
    {
      id: 9,
      title: 'Patient Navigation',
      descriptionKey: 'funding.home.cards.patientNavigation',
      asset: 'assets/openg7-patient-navigation-canada-miniature-480.webp'
    },
    {
      id: 10,
      title: 'Medical Referral Router',
      descriptionKey: 'funding.home.cards.referral',
      asset: 'assets/openg7-medical-referral-router-canada-miniature-480.webp'
    },
    {
      id: 11,
      title: 'Clinical Workforce Exchange',
      descriptionKey: 'funding.home.cards.workforce',
      asset:
        'assets/openg7-clinical-workforce-exchange-canada-miniature-480.webp'
    },
    {
      id: 12,
      title: 'Health Supply Corridors',
      descriptionKey: 'funding.home.cards.supply',
      asset: 'assets/openg7-health-supply-corridors-canada-miniature-480.webp'
    },
    {
      id: 13,
      title: 'Funding Platform',
      descriptionKey: 'funding.home.cards.funding',
      asset: 'assets/openg7-funding-platform-dragon-coffre-miniature-480.webp'
    }
  ];

  readonly foundationPillars: readonly FoundationPillar[] = [
    {
      titleKey: 'funding.home.pillars.transparency.title',
      descriptionKey: 'funding.home.pillars.transparency.description'
    },
    {
      titleKey: 'funding.home.pillars.resilience.title',
      descriptionKey: 'funding.home.pillars.resilience.description'
    },
    {
      titleKey: 'funding.home.pillars.collaboration.title',
      descriptionKey: 'funding.home.pillars.collaboration.description'
    },
    {
      titleKey: 'funding.home.pillars.openFuture.title',
      descriptionKey: 'funding.home.pillars.openFuture.description'
    }
  ];

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.home.title',
        descriptionKey: 'funding.seo.home.description',
        path: '/fonds-des-batisseurs',
        imagePath: '/assets/fonds-des-batisseurs-canada-coffre-lumineux.png'
      },
      this.injector
    );
  }
  ngOnInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (checkout === 'cancel') {
      this.checkoutMonitor.cancel();
    } else if (checkout === 'success') {
      this.checkoutMonitor.start(params.get('reference'));
    }

    if (checkout === 'success') {
      const followupToken = params.get('followup_token');
      const isSponsorship =
        params.get('contributionType') === 'sponsorship_interest';
      if (
        isSponsorship &&
        followupToken &&
        sponsorshipFollowupTokenPattern.test(followupToken)
      ) {
        this.pendingSponsorFollowupToken.set(followupToken);
      }
    }

    void this.loadPublicTransparency();
    void this.loadPublicFundingConfig();
    this.startTransparencyRefresh();
  }
  async loadPublicFundingConfig(): Promise<void> {
    try {
      const runtimeConfig = await this.fundingService.getPublicFundingConfig();
      if (this.destroyRef.destroyed) return;
      this.allowedContributionAmounts.set(
        runtimeConfig.allowed_contribution_amounts ??
          this.config.contributionAmounts
      );
      this.sponsorshipSelectionEnabled.set(
        runtimeConfig.business_sponsorship_enabled
      );

      if (runtimeConfig.business_sponsorship_enabled) {
        await this.loadSponsorshipBatchAvailability();
        return;
      }
    } catch {
      this.sponsorshipSelectionEnabled.set(false);
    }

    this.sponsorshipBatchAvailability.set(null);
  }

  async loadSponsorshipBatchAvailability(): Promise<void> {
    try {
      const availability =
        await this.fundingService.getSponsorshipBatchAvailability();
      if (!this.destroyRef.destroyed)
        this.sponsorshipBatchAvailability.set(availability);
    } catch {
      this.sponsorshipBatchAvailability.set(null);
    }
  }
  ngOnDestroy(): void {
    if (this.transparencyRefreshId !== null)
      clearInterval(this.transparencyRefreshId);
    this.transparencyRequest?.abort();
  }
  async loadPublicTransparency(
    options: { readonly silent?: boolean } = {}
  ): Promise<void> {
    if (this.destroyRef.destroyed || this.transparencyRequest) return;
    const request = new AbortController();
    this.transparencyRequest = request;
    const timeout = setTimeout(() => request.abort(), 15_000);
    if (!options.silent) {
      this.transparencyState.set('loading');
    }

    try {
      const report = await this.transparencyService.getPublicTransparency(
        request.signal
      );
      if (this.destroyRef.destroyed) return;
      this.currentMonth.set(currentFundingMonth(new Date()));
      this.monthlySummary.set(report.monthly_summary);
      this.snapshot.set(this.toFundingSnapshot(report));
      this.contributionCount.set(report.contributions_count);
      this.currency.set(report.currency || this.config.currency);
      this.lastTransparencySync.set(report.last_updated_at);
      this.transparencySource.set(report.data_source);
      this.hasTransparencySnapshot.set(true);
      this.transparencyState.set(
        this.hasPublicFinanceData(report) ? 'synced' : 'empty'
      );
    } catch {
      if (!this.destroyRef.destroyed) this.transparencyState.set('error');
    } finally {
      clearTimeout(timeout);
      this.transparencyRequest = null;
    }
  }
  dismissCheckoutNotice(): void {
    this.checkoutMonitor.dismiss();
    this.pendingSponsorFollowupToken.set(null);

    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('contributionType');
    url.searchParams.delete('followup_token');
    url.searchParams.delete('session_id');
    url.searchParams.delete('reference');
    window.history.replaceState(window.history.state, '', url);
  }
  formatMoney(amount: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: this.currency(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  formatPublicMoney(amount: number): string {
    return this.hasTransparencySnapshot()
      ? this.formatMoney(amount)
      : this.publicValueUnavailableLabel();
  }
  allocationShare(amount: number): number {
    const total = this.allocationTotal();
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }

  allocationColor(index: number): string {
    return this.allocationPalette[index % this.allocationPalette.length];
  }
  scrollToSupport(): void {
    if (typeof document === 'undefined') return;
    const support = document.getElementById('support');
    support?.focus({ preventScroll: true });
    support?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start'
    });
  }
  async supportProject(
    submission: FundingContributionSubmission
  ): Promise<void> {
    if (this.loadingState() === 'loading') return;
    this.checkoutResultMode.set(null);
    this.loadingState.set('loading');
    try {
      const result = await this.fundingService.startCheckout(
        submission.amount,
        submission.consent
      );
      if (this.destroyRef.destroyed) return;
      if (result.status === 'redirected') {
        window.location.assign(result.redirectUrl);
        return;
      }
      this.checkoutResultMode.set(result.status);
      this.loadingState.set('success');
      void this.loadPublicTransparency({ silent: true });
    } catch {
      if (!this.destroyRef.destroyed) this.loadingState.set('error');
    }
  }
  private startTransparencyRefresh(): void {
    if (typeof window === 'undefined' || this.transparencyRefreshId) {
      return;
    }

    this.transparencyRefreshId = window.setInterval(() => {
      void this.loadPublicTransparency({ silent: true });
    }, 30000);
  }
  private toFundingSnapshot(
    report: FundTransparencyPublicResponse
  ): FundingSnapshot {
    return {
      totals: {
        confirmedContributions: report.total_received,
        transactionFees: -Math.abs(report.total_fees),
        availableFunds: report.current_available_estimate
      },
      allocation: report.latest_public_allocations.map((allocation) => ({
        category: allocation.project_name,
        amount: allocation.amount_allocated
      })),
      contributors: []
    };
  }

  private hasPublicFinanceData(
    report: FundTransparencyPublicResponse
  ): boolean {
    return (
      report.total_received > 0 ||
      report.total_fees > 0 ||
      report.total_net > 0 ||
      report.total_refunded > 0 ||
      report.total_payouts > 0 ||
      report.current_available_estimate > 0 ||
      report.contributions_count > 0 ||
      report.latest_public_allocations.length > 0
    );
  }
}
