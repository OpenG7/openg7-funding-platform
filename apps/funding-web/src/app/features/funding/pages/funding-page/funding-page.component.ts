import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  OnDestroy,
  OnInit
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { ContributionType } from '@openg7/funding-core';
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
import { FundingHomeController } from '../../services/funding-home-controller.js';
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
  templateUrl: './funding-page.component.html',
  styleUrl: './funding-page.component.css'
})
export class FundingPageComponent implements OnInit, OnDestroy {
  private readonly fundingService = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);
  private readonly transparencyService = inject(FundTransparencyService);
  readonly checkoutMonitor = inject(CheckoutStatusMonitor);
  readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;
  private readonly controller = new FundingHomeController({
    funding: this.fundingService,
    transparency: this.transparencyService,
    checkout: this.checkoutMonitor,
    config: this.config,
    isBrowser: () => typeof window !== 'undefined',
    now: () => new Date(),
    navigate: (url) => window.location.assign(url),
    clearCheckoutReturn: () => {
      const url = new URL(window.location.href);
      for (const key of [
        'checkout',
        'contributionType',
        'followup_token',
        'session_id',
        'reference'
      ])
        url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url);
    }
  });
  readonly allowedContributionAmounts =
    this.controller.allowedContributionAmounts;
  readonly sponsorshipBatchAvailability =
    this.controller.sponsorshipBatchAvailability;
  readonly sponsorshipSelectionEnabled =
    this.controller.sponsorshipSelectionEnabled;
  readonly monthlySummary = this.controller.monthlySummary;
  readonly currentMonth = this.controller.currentMonth;
  readonly currentMonthContributions =
    this.controller.currentMonthContributions;
  readonly snapshot = this.controller.snapshot;
  readonly hasTransparencySnapshot = this.controller.hasTransparencySnapshot;
  readonly loadingState = this.controller.loadingState;
  readonly checkoutResultMode = this.controller.checkoutResultMode;
  readonly checkoutRequiresVerification =
    this.controller.checkoutRequiresVerification;
  readonly pendingSponsorFollowupToken =
    this.controller.pendingSponsorFollowupToken;
  readonly transparencyState = this.controller.transparencyState;
  readonly contributionCount = this.controller.contributionCount;
  readonly currency = this.controller.currency;
  readonly lastTransparencySync = this.controller.lastTransparencySync;
  readonly transparencySource = this.controller.transparencySource;
  readonly campaignProgress = this.controller.campaignProgress;
  readonly allocationTotal = this.controller.allocationTotal;
  readonly remainingForMonthlyGoal = this.controller.remainingForMonthlyGoal;
  readonly allocationDonut = this.controller.allocationDonut;

  // This public intent only selects a form type; it never grants consent or confirms payment.
  readonly requestedContributionType: ContributionType =
    inject(ActivatedRoute).snapshot.queryParamMap.get('intent') ===
    'sponsorship'
      ? 'sponsorship_interest'
      : 'personal_support';

  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

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
    if (typeof window === 'undefined') return;
    this.controller.start(new URLSearchParams(window.location.search));
  }

  ngOnDestroy(): void {
    this.controller.dispose();
  }

  dismissCheckoutNotice(): void {
    this.controller.dismissCheckoutNotice();
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
    return this.controller.allocationShare(amount);
  }

  allocationColor(index: number): string {
    return this.controller.allocationColor(index);
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
  restartContribution(): void {
    this.dismissCheckoutNotice();
    this.scrollToSupport();
  }
  supportProject(submission: FundingContributionSubmission): Promise<void> {
    return this.controller.supportProject(submission);
  }
}
