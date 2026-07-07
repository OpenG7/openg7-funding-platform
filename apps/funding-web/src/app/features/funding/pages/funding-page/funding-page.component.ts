import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  FundTransparencyPublicResponse,
  FundingSnapshot
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
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  providers: [provideFundingProjectConfig(OPENG7_FUNDING_CONFIG)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="builders-shell">
      <openg7-funding-header></openg7-funding-header>

      <section
        class="checkout-success-stage"
        *ngIf="checkoutStatus() === 'success'"
        aria-labelledby="checkout-success-title"
      >
        <img
          class="checkout-success-art"
          src="assets/openg7-dragon-dime-coffre-fort.png"
          [alt]="'funding.home.checkout.successAlt' | translate"
        />
        <div class="checkout-success-glow" aria-hidden="true"></div>
        <button
          type="button"
          class="checkout-success-close"
          [attr.aria-label]="'funding.home.checkout.closeSuccess' | translate"
          (click)="dismissCheckoutNotice()"
        >
          ×
        </button>
        <article class="checkout-success-card">
          <span class="section-kicker">{{ 'funding.home.checkout.successKicker' | translate }}</span>
          <h2 id="checkout-success-title">
            {{ 'funding.home.checkout.successTitle' | translate }}
          </h2>
          <p>{{ 'funding.home.checkout.successCopy' | translate }}</p>
          <div class="checkout-success-actions">
            <a [routerLink]="transparencyPath()">{{ 'funding.home.actions.viewTransparency' | translate }}</a>
            <button type="button" (click)="scrollToSupport()">
              {{ 'funding.home.actions.contributeAgain' | translate }}
            </button>
          </div>
        </article>
      </section>

      <section
        class="checkout-success-stage checkout-cancel-stage"
        *ngIf="checkoutStatus() === 'cancel'"
        aria-labelledby="checkout-cancel-title"
      >
        <img
          class="checkout-success-art"
          src="assets/openg7-coffre-fort-ferme-dragon.png"
          [alt]="'funding.home.checkout.cancelAlt' | translate"
        />
        <div
          class="checkout-success-glow checkout-cancel-glow"
          aria-hidden="true"
        ></div>
        <button
          type="button"
          class="checkout-success-close"
          [attr.aria-label]="'funding.home.checkout.closeCancel' | translate"
          (click)="dismissCheckoutNotice()"
        >
          ×
        </button>
        <article class="checkout-success-card checkout-cancel-card">
          <span class="section-kicker">{{ 'funding.home.checkout.cancelKicker' | translate }}</span>
          <h2 id="checkout-cancel-title">
            {{ 'funding.home.checkout.cancelTitle' | translate }}
          </h2>
          <p>{{ 'funding.home.checkout.cancelCopy' | translate }}</p>
          <div class="checkout-success-actions">
            <button type="button" (click)="scrollToSupport()">{{ 'funding.home.actions.retry' | translate }}</button>
            <a [routerLink]="supportPath()">{{ 'funding.home.actions.contactSupport' | translate }}</a>
          </div>
        </article>
      </section>

      <section class="poster-hero" aria-labelledby="builders-title">
        <img
          class="hero-backdrop"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse.png"
          [alt]="'funding.home.hero.backgroundAlt' | translate"
        />
        <div class="hero-shade" aria-hidden="true"></div>

        <div class="hero-copy">
          <h1 id="builders-title">
            <span>{{ 'funding.home.hero.line1' | translate }}</span>
            <span>{{ 'funding.home.hero.line2' | translate }}</span>
            <strong>{{ 'funding.home.hero.line3' | translate }}</strong>
          </h1>
          <p>{{ 'funding.home.hero.copy' | translate }}</p>

          <article
            class="hero-progress-card"
            [attr.aria-label]="'funding.home.hero.progressAria' | translate"
          >
            <div>
              <span
                >{{
                  formatMoney(snapshot().totals.confirmedContributions)
                }}
                {{ 'funding.home.hero.raisedOn' | translate }} {{ formatMoney(config.monthlyGoal) }}</span
              >
              <strong>{{ campaignProgress() }}%</strong>
            </div>
            <div class="progress-track" aria-hidden="true">
              <span [style.width.%]="campaignProgress()"></span>
            </div>
            <small>{{ transparencyStatusLabel() }}</small>
            <button type="button" (click)="scrollToSupport()">
              {{ 'funding.nav.supportCta' | translate }}
              <span aria-hidden="true">→</span>
            </button>
          </article>
        </div>
      </section>

      <section
        id="ecosystem"
        class="ecosystem-section"
        aria-labelledby="ecosystem-title"
      >
        <header class="section-title ornament-title">
          <h2 id="ecosystem-title">{{ 'funding.home.ecosystem.title' | translate }} <strong>OpenG7</strong></h2>
          <p>{{ 'funding.home.ecosystem.copy' | translate }}</p>
        </header>

        <div class="tool-grid">
          <article class="tool-card" *ngFor="let card of ecosystemCards">
            <img [src]="card.asset" [alt]="card.title" />
            <div class="tool-card-copy">
              <span>{{ card.id }}</span>
              <div>
                <h3>{{ card.title }}</h3>
                <p>{{ card.descriptionKey | translate }}</p>
              </div>
            </div>
          </article>
        </div>

        <p class="solid-foundations">
          {{ 'funding.home.ecosystem.foundationLead' | translate }} <strong>{{ 'funding.home.ecosystem.foundationStrong' | translate }}</strong>
        </p>
      </section>

      <section
        id="funding-purpose"
        class="funding-purpose-board"
        aria-labelledby="funding-purpose-title"
      >
        <img
          class="purpose-city"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse.png"
          [alt]="'funding.home.hero.backgroundAlt' | translate"
        />
        <img
          class="purpose-dragon"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort.png"
          [alt]="'funding.home.purpose.dragonAlt' | translate"
        />
        <div class="purpose-overlay" aria-hidden="true"></div>

        <article class="purpose-intro">
          <span class="section-kicker">{{ 'funding.brand.title' | translate }}</span>
          <h2 id="funding-purpose-title">
            {{ 'funding.home.purpose.title' | translate }} <strong>OpenG7</strong> ?
          </h2>
          <p>{{ 'funding.home.purpose.copy' | translate }}</p>
          <div class="purpose-actions">
            <button type="button" (click)="scrollToSupport()">
              {{ 'funding.nav.supportCta' | translate }}
            </button>
            <a [routerLink]="transparencyPath()">{{ 'funding.home.actions.viewRegistry' | translate }}</a>
          </div>
        </article>

        <dl class="purpose-proof-strip" [attr.aria-label]="'funding.home.purpose.proofAria' | translate">
          <div>
            <dt>{{ 'funding.home.purpose.lastSync' | translate }}</dt>
            <dd>{{ lastTransparencySyncLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'funding.home.purpose.source' | translate }}</dt>
            <dd>{{ transparencySourceLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'funding.home.purpose.currency' | translate }}</dt>
            <dd>{{ currency() }}</dd>
          </div>
          <div>
            <dt>{{ 'funding.home.purpose.activeCampaign' | translate }}</dt>
            <dd>{{ config.campaignTitle }}</dd>
          </div>
        </dl>

        <section
          class="purpose-kpi-grid"
          [attr.aria-label]="'funding.home.purpose.kpiAria' | translate"
        >
          <article class="purpose-kpi blue">
            <span aria-hidden="true">+</span>
            <div>
              <h3>{{ 'funding.confirmedContributions' | translate }}</h3>
              <strong>{{
                formatMoney(snapshot().totals.confirmedContributions)
              }}</strong>
              <p>{{ contributionCountLabel() }}</p>
            </div>
          </article>
          <article class="purpose-kpi red">
            <span aria-hidden="true">-</span>
            <div>
              <h3>{{ 'funding.home.purpose.paymentFees' | translate }}</h3>
              <strong>{{
                formatMoney(snapshot().totals.transactionFees)
              }}</strong>
              <p>{{ 'funding.home.purpose.deductedBeforeAvailable' | translate }}</p>
            </div>
          </article>
          <article class="purpose-kpi green">
            <span aria-hidden="true">=</span>
            <div>
              <h3>{{ 'funding.home.purpose.netAvailable' | translate }}</h3>
              <strong>{{
                formatMoney(snapshot().totals.availableFunds)
              }}</strong>
              <p>{{ 'funding.home.purpose.availableForProjects' | translate }}</p>
            </div>
          </article>
          <article class="purpose-kpi gold">
            <span aria-hidden="true">%</span>
            <div>
              <h3>{{ 'funding.goal.monthly' | translate }}</h3>
              <strong>{{ formatMoney(config.monthlyGoal) }}</strong>
              <p>{{ campaignProgress() }} % {{ 'funding.home.purpose.reached' | translate }}</p>
            </div>
          </article>
        </section>

        <article
          class="purpose-campaign-card"
          [attr.aria-label]="'funding.home.purpose.campaignProgressAria' | translate"
        >
          <header>
            <span>{{ 'funding.home.purpose.campaignProgress' | translate }}</span>
            <strong>{{ campaignProgress() }} %</strong>
          </header>
          <div class="purpose-track" aria-hidden="true">
            <span [style.width.%]="campaignProgress()"></span>
          </div>
          <p>
            {{ formatMoney(remainingForMonthlyGoal()) }} {{ 'funding.home.purpose.remainingForGoal' | translate }}
          </p>
        </article>

        <div class="purpose-dashboard-grid">
          <article class="purpose-panel purpose-flow">
            <h3>{{ 'funding.home.flow.title' | translate }}</h3>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>{{ 'funding.home.flow.steps.received.title' | translate }}</strong>
                  <p>{{ 'funding.home.flow.steps.received.copy' | translate }}</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>{{ 'funding.home.flow.steps.confirmed.title' | translate }}</strong>
                  <p>
                    {{ 'funding.home.flow.steps.confirmed.copy' | translate }}
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>{{ 'funding.home.flow.steps.fees.title' | translate }}</strong>
                  <p>
                    {{ 'funding.home.flow.steps.fees.copy' | translate }}
                  </p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>{{ 'funding.home.flow.steps.available.title' | translate }}</strong>
                  <p>
                    {{ 'funding.home.flow.steps.available.copy' | translate }}
                  </p>
                </div>
              </li>
            </ol>
          </article>

          <article class="purpose-panel purpose-allocation">
            <h3>{{ 'funding.home.allocation.title' | translate }}</h3>
            <div
              class="purpose-donut"
              [style.background]="allocationDonut()"
              aria-hidden="true"
            ></div>
            <p
              class="purpose-empty-state"
              *ngIf="snapshot().allocation.length === 0"
            >
              {{ 'funding.home.allocation.empty' | translate }}
            </p>
            <ul>
              <li
                *ngFor="
                  let allocation of snapshot().allocation;
                  let index = index
                "
              >
                <span
                  [style.background]="allocationColor(index)"
                  aria-hidden="true"
                ></span>
                <strong>{{ allocationShare(allocation.amount) }}%</strong>
                <p>{{ allocation.category }}</p>
              </li>
            </ul>
          </article>

          <aside
            id="support"
            class="purpose-support-panel"
            [attr.aria-label]="'funding.home.contribution.ariaLabel' | translate"
          >
            <section class="contribution-panel">
              <h3>{{ 'funding.home.contribution.title' | translate }}</h3>
              <div class="contribution-type-grid">
                <article class="contribution-type-card active">
                  <span>{{ 'funding.home.contribution.personal.kicker' | translate }}</span>
                  <strong>{{ 'funding.home.contribution.personal.title' | translate }}</strong>
                  <p>{{ 'funding.home.contribution.personal.copy' | translate }}</p>
                </article>
                <article class="contribution-type-card review">
                  <span>{{ 'funding.home.contribution.sponsorship.kicker' | translate }}</span>
                  <strong>{{ 'funding.home.contribution.sponsorship.title' | translate }}</strong>
                  <p>{{ 'funding.home.contribution.sponsorship.copy' | translate }}</p>
                </article>
              </div>
              <div class="amount-grid">
                <button
                  type="button"
                  *ngFor="let amount of config.contributionAmounts"
                  [class.active]="isSelectedAmount(amount)"
                  (click)="setContributionAmount(amount)"
                >
                  {{ amount }} $
                </button>
              </div>
              <label for="custom-contribution">{{ 'funding.home.contribution.otherAmount' | translate }}</label>
              <input
                id="custom-contribution"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="$"
                (input)="setCustomContributionFromEvent($event)"
              />
              <p class="non-charity-note">
                {{ 'funding.home.contribution.nonCharityNotice' | translate }}
              </p>
              <button type="button" class="gold-cta" (click)="supportProject()">
                {{ 'funding.nav.supportCta' | translate }}
              </button>
              <p class="payment-note">{{ 'funding.home.contribution.securePayment' | translate }}</p>
              <p class="state" *ngIf="loadingState() === 'loading'">
                {{ 'funding.home.contribution.loading' | translate }}
              </p>
              <p
                class="state state-success"
                *ngIf="loadingState() === 'success'"
              >
                {{ 'funding.home.contribution.success' | translate }}
              </p>
              <p class="state state-error" *ngIf="loadingState() === 'error'">
                {{ 'funding.home.contribution.error' | translate }}
              </p>
            </section>

            <section class="finance-panel">
              <h3>{{ 'funding.home.finance.title' | translate }}</h3>
              <dl>
                <div>
                  <dt>{{ 'funding.confirmedContributions' | translate }}</dt>
                  <dd>
                    {{ formatMoney(snapshot().totals.confirmedContributions) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'funding.home.finance.stripeFees' | translate }}</dt>
                  <dd>{{ formatMoney(snapshot().totals.transactionFees) }}</dd>
                </div>
                <div>
                  <dt>{{ 'funding.home.purpose.netAvailable' | translate }}</dt>
                  <dd>{{ formatMoney(snapshot().totals.availableFunds) }}</dd>
                </div>
              </dl>
              <a [routerLink]="transparencyPath()">{{ 'funding.home.finance.publicDetails' | translate }}</a>
            </section>
          </aside>
        </div>
      </section>

      <footer class="builders-footer">
        <p>
          {{ 'funding.home.footer.copy' | translate }}
          <strong
            >{{ 'funding.home.footer.strong' | translate }}</strong
          >
        </p>
        <ul>
          <li *ngFor="let pillar of foundationPillars">
            <strong>{{ pillar.titleKey | translate }}</strong>
            <span>{{ pillar.descriptionKey | translate }}</span>
          </li>
        </ul>
      </footer>
    </main>
  `
})
export class FundingPageComponent implements OnInit, OnDestroy {
  private readonly fundingService = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);
  private readonly transparencyService = inject(FundTransparencyService);
  private transparencyRefreshId: number | null = null;
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

  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

  readonly snapshot = signal<FundingSnapshot>(this.emptySnapshot);
  readonly selectedContributionAmount = signal<number>(
    this.config.contributionAmounts[2] ?? this.config.contributionAmounts[0]
  );
  readonly loadingState = signal<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  readonly checkoutStatus = signal<'idle' | 'success' | 'cancel'>('idle');
  readonly transparencyState = signal<'loading' | 'synced' | 'empty' | 'error'>(
    'loading'
  );
  readonly contributionCount = signal<number>(0);
  readonly currency = signal<string>(this.config.currency);
  readonly lastTransparencySync = signal<string | null>(null);

  readonly campaignProgress = computed<number>(() => {
    const goal = this.config.monthlyGoal;
    if (goal <= 0) {
      return 0;
    }

    const ratio = (this.snapshot().totals.confirmedContributions / goal) * 100;
    return Math.min(100, Math.max(0, Math.round(ratio)));
  });

  readonly allocationTotal = computed<number>(() =>
    this.snapshot().allocation.reduce((sum, item) => sum + item.amount, 0)
  );

  readonly remainingForMonthlyGoal = computed<number>(() =>
    Math.max(
      0,
      this.config.monthlyGoal - this.snapshot().totals.confirmedContributions
    )
  );

  readonly transparencyStatusLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    const state = this.transparencyState();
    if (state === 'loading') {
      return this.i18n.t('funding.home.status.syncing');
    }

    if (state === 'error') {
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
    if (state === 'loading') {
      return this.i18n.t('funding.home.sync.loading');
    }

    if (state === 'error') {
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

    return date.toLocaleString(this.config.locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  readonly transparencySourceLabel = computed<string>(() =>
    this.transparencyState() === 'error'
      ? this.i18n.t('funding.home.status.stripeUnsynced')
      : this.i18n.t('funding.home.status.stripeRegistry')
  );

  readonly contributionCountLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    const count = this.contributionCount();
    return count === 1
      ? this.i18n.t('funding.home.contributionCount.one')
      : this.i18n.t('funding.home.contributionCount.many').replace('{{ count }}', count.toString());
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
      asset: 'assets/openg7-social-communautes-connectees-canada-miniature.png'
    },
    {
      id: 2,
      title: 'Migration Flow Engine',
      descriptionKey: 'funding.home.cards.migration',
      asset: 'assets/openg7-migration-flow-engine-canada-miniature.png'
    },
    {
      id: 3,
      title: 'Firewall',
      descriptionKey: 'funding.home.cards.firewall',
      asset: 'assets/openg7-firewall-cybersecurite-canada-miniature.png'
    },
    {
      id: 4,
      title: 'CA: Election Day Ops',
      descriptionKey: 'funding.home.cards.electionOps',
      asset: 'assets/openg7-ca-election-day-ops-results-audit-miniature.png'
    },
    {
      id: 5,
      title: 'CA: Voter Register',
      descriptionKey: 'funding.home.cards.voterRegister',
      asset: 'assets/openg7-ca-voter-register-official-docs-miniature.png'
    },
    {
      id: 6,
      title: 'Canadian Vehicle Registry',
      descriptionKey: 'funding.home.cards.vehicleRegistry',
      asset: 'assets/openg7-canadian-vehicle-registry-miniature.png'
    },
    {
      id: 7,
      title: 'GovGraph',
      descriptionKey: 'funding.home.cards.govgraph',
      asset: 'assets/openg7-govgraph-gouvernance-canada-miniature.png'
    },
    {
      id: 8,
      title: 'Nexus',
      descriptionKey: 'funding.home.cards.nexus',
      asset: 'assets/openg7-nexus-carte-canada-connecte-miniature.png'
    },
    {
      id: 9,
      title: 'Patient Navigation',
      descriptionKey: 'funding.home.cards.patientNavigation',
      asset: 'assets/openg7-patient-navigation-canada-miniature.png'
    },
    {
      id: 10,
      title: 'Medical Referral Router',
      descriptionKey: 'funding.home.cards.referral',
      asset: 'assets/openg7-medical-referral-router-canada-miniature.png'
    },
    {
      id: 11,
      title: 'Clinical Workforce Exchange',
      descriptionKey: 'funding.home.cards.workforce',
      asset: 'assets/openg7-clinical-workforce-exchange-canada-miniature.png'
    },
    {
      id: 12,
      title: 'Health Supply Corridors',
      descriptionKey: 'funding.home.cards.supply',
      asset: 'assets/openg7-health-supply-corridors-canada-miniature.png'
    },
    {
      id: 13,
      title: 'Funding Platform',
      descriptionKey: 'funding.home.cards.funding',
      asset: 'assets/openg7-funding-platform-dragon-coffre-miniature.png'
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

    const checkout = new URLSearchParams(window.location.search).get(
      'checkout'
    );
    if (checkout === 'success' || checkout === 'cancel') {
      this.checkoutStatus.set(checkout);
    }

    void this.loadPublicTransparency();
    this.startTransparencyRefresh();
  }

  ngOnDestroy(): void {
    if (this.transparencyRefreshId) {
      clearInterval(this.transparencyRefreshId);
    }
  }

  async loadPublicTransparency(
    options: { readonly silent?: boolean } = {}
  ): Promise<void> {
    if (!options.silent) {
      this.transparencyState.set('loading');
    }

    try {
      const report = await this.transparencyService.getPublicTransparency();
      this.snapshot.set(this.toFundingSnapshot(report));
      this.contributionCount.set(report.contributions_count);
      this.currency.set(report.currency || this.config.currency);
      this.lastTransparencySync.set(report.last_updated_at);
      this.transparencyState.set(
        this.hasPublicFinanceData(report) ? 'synced' : 'empty'
      );
    } catch {
      this.snapshot.set(this.emptySnapshot);
      this.contributionCount.set(0);
      this.currency.set(this.config.currency);
      this.lastTransparencySync.set(null);
      this.transparencyState.set('error');
    }
  }

  dismissCheckoutNotice(): void {
    this.checkoutStatus.set('idle');

    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    window.history.replaceState({}, '', url);
  }

  setContributionAmount(amount: number): void {
    this.selectedContributionAmount.set(amount);
  }

  setCustomContributionFromEvent(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const amount = Number(input?.value ?? 0);

    if (amount > 0) {
      this.selectedContributionAmount.set(amount);
    }
  }

  isSelectedAmount(amount: number): boolean {
    return this.selectedContributionAmount() === amount;
  }

  formatMoney(amount: number): string {
    return new Intl.NumberFormat(this.config.locale, {
      style: 'currency',
      currency: this.currency(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  allocationShare(amount: number): number {
    const total = this.allocationTotal();
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }

  allocationColor(index: number): string {
    return this.allocationPalette[index % this.allocationPalette.length];
  }

  scrollToSupport(): void {
    document.getElementById('support')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }

  async supportProject(): Promise<void> {
    this.loadingState.set('loading');
    try {
      const result = await this.fundingService.startCheckout(
        this.selectedContributionAmount()
      );
      if (result.status === 'redirected') {
        window.location.assign(result.redirectUrl);
        return;
      }

      this.loadingState.set('success');
      void this.loadPublicTransparency({ silent: true });
    } catch {
      this.loadingState.set('error');
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
