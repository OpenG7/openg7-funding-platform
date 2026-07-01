import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FundingProjectConfig } from '@openg7/funding-models';

import { CanadaFundingMapComponent } from '../../components/canada-funding-map/canada-funding-map.component.js';
import { ContributionSelectorComponent } from '../../components/contribution-selector/contribution-selector.component.js';
import { FundGuardianComponent } from '../../components/fund-guardian/fund-guardian.component.js';
import { FundingAllocationComponent } from '../../components/funding-allocation/funding-allocation.component.js';
import { FundingHeroComponent } from '../../components/funding-hero/funding-hero.component.js';
import {
  FundingImpactComponent,
  FundingImpactItem
} from '../../components/funding-impact/funding-impact.component.js';
import { FundingProgressComponent } from '../../components/funding-progress/funding-progress.component.js';
import { FundingTransparencyComponent } from '../../components/funding-transparency/funding-transparency.component.js';
import { LatestBuildersComponent } from '../../components/latest-builders/latest-builders.component.js';
import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { provideFundingProjectConfig } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';

@Component({
  selector: 'openg7-funding-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FundingHeroComponent,
    FundGuardianComponent,
    ContributionSelectorComponent,
    FundingProgressComponent,
    FundingTransparencyComponent,
    FundingAllocationComponent,
    LatestBuildersComponent,
    FundingImpactComponent,
    CanadaFundingMapComponent
  ],
  providers: [provideFundingProjectConfig(OPENG7_FUNDING_CONFIG)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="funding-shell">
      <header class="top-nav">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">*</span>
          <span>Open</span><span class="brand-accent">G7</span>
        </div>
        <nav aria-label="Navigation principale">
          <a href="#" aria-current="page">{{ t('funding.nav.home') }}</a>
          <a href="#">{{ t('funding.nav.projects') }}</a>
          <a [routerLink]="['/fonds-des-batisseurs/transparence']">{{ t('funding.nav.transparency') }}</a>
          <a href="#">{{ t('funding.nav.impact') }}</a>
          <a href="#">{{ t('funding.nav.about') }}</a>
          <a href="#">{{ t('funding.nav.contact') }}</a>
        </nav>
        <div class="top-actions">
          <button type="button" class="icon" [attr.aria-label]="t('funding.nav.themeToggle')">
            ○
          </button>
          <button type="button" class="ghost">{{ t('funding.nav.login') }}</button>
          <button type="button" class="primary">{{ t('funding.nav.supportCta') }}</button>
        </div>
      </header>

      <section class="hero-scene">
        <openg7-canada-funding-map
          class="hero-map-ambient"
          [decorative]="true"
          [title]="t('funding.map.title')"
          [placeholder]="t('funding.map.placeholder')"
          [actionLabel]="t('funding.map.explore')"
          [legendOil]="t('funding.map.legend.oil')"
          [legendElectricity]="t('funding.map.legend.electricity')"
          [legendServices]="t('funding.map.legend.services')"
          [legendLabor]="t('funding.map.legend.labor')"
          aria-hidden="true"
        />

        <div class="hero-layout">
          <section class="hero-left funding-glass-panel">
            <div class="hero-title-block">
              <openg7-funding-hero
                [campaignTitle]="config.campaignTitle"
                [campaignDescription]="config.campaignDescription"
              />
            </div>

            <div class="hero-progress-block">
              <openg7-funding-progress
                [label]="t('funding.progress.label')"
                [goalLabel]="t('funding.goal.monthly')"
                [confirmedLabel]="t('funding.progress.confirmed')"
                [remainingLabel]="t('funding.progress.remaining')"
                [confirmedTotal]="snapshot().totals.confirmedContributions"
                [goal]="config.monthlyGoal"
                [currencyCode]="config.currency"
              />
            </div>

            <div class="hero-selector-block">
              <openg7-contribution-selector
                [amounts]="config.contributionAmounts"
                [label]="t('funding.contribution.selector')"
                [customAmountLabel]="t('funding.contribution.customAmount')"
                (amountSelected)="selectedContributionAmount.set($event)"
              />
            </div>

            <button
              type="button"
              class="support-cta"
              (click)="supportProject()"
            >
              <span>{{ t('funding.actions.support') }}</span>
              <span aria-hidden="true">-></span>
            </button>

            <p class="state" *ngIf="loadingState() === 'loading'">
              {{ t('funding.state.loading') }}
            </p>
            <p class="state state-error" *ngIf="loadingState() === 'error'">
              {{ t('funding.state.error') }}
            </p>
            <p class="fine-print">{{ t('funding.impact.description') }}</p>
          </section>

          <section class="hero-center" aria-label="Gardien OpenG7">
            <openg7-fund-guardian
              [asset]="config.guardianAsset"
              alt=""
              [progress]="campaignProgress()"
            />
          </section>

          <aside class="hero-right">
            <section class="funding-glass-panel">
              <openg7-funding-transparency
                [title]="t('funding.transparency.title')"
                [detailsLabel]="t('funding.transparency.details')"
                [liveUpdateLabel]="t('funding.liveUpdate')"
                [confirmedLabel]="t('funding.confirmedContributions')"
                [feesLabel]="t('funding.transactionFees')"
                [availableLabel]="t('funding.availableFunds')"
                [confirmed]="snapshot().totals.confirmedContributions"
                [fees]="snapshot().totals.transactionFees"
                [available]="snapshot().totals.availableFunds"
              />
            </section>

            <section class="funding-glass-panel">
              <openg7-funding-allocation
                [title]="t('funding.allocation.title')"
                [footNoteLabel]="t('funding.allocation.footnote')"
                [allocation]="snapshot().allocation"
              />
            </section>

            <section class="funding-glass-panel">
              <openg7-canada-funding-map
                [title]="t('funding.map.title')"
                [placeholder]="t('funding.map.placeholder')"
                [actionLabel]="t('funding.map.explore')"
                [legendOil]="t('funding.map.legend.oil')"
                [legendElectricity]="t('funding.map.legend.electricity')"
                [legendServices]="t('funding.map.legend.services')"
                [legendLabor]="t('funding.map.legend.labor')"
              />
            </section>
          </aside>
        </div>
      </section>

      <section class="stats-grid">
        <section class="funding-glass-panel">
          <openg7-latest-builders
            [title]="t('funding.builders.title')"
            [contributors]="snapshot().contributors"
            [recentLabels]="builderRecentLabels()"
            [recentFallbackLabel]="t('funding.builders.recentFallback')"
            [thanksLabel]="t('funding.builders.thanks')"
          />
        </section>

        <section class="funding-glass-panel">
          <openg7-funding-impact
            [title]="t('funding.impact.title')"
            [description]="t('funding.impact.description')"
            [items]="impactItems()"
          />
        </section>

        <article class="flow-card funding-glass-panel">
          <h2>{{ t('funding.scene.flow.title') }}</h2>
          <p>{{ t('funding.scene.flow.description') }}</p>
          <button type="button">{{ t('funding.scene.flow.action') }}</button>
        </article>
      </section>

      <footer class="bottom-strip">
        <span>{{ t('funding.footer.tagline') }}</span>
        <span>{{ t('funding.footer.project') }}</span>
        <span>{{ t('funding.footer.privacy') }}</span>
      </footer>
    </main>
  `
})
export class FundingPageComponent {
  readonly fundingService = inject(FundingService);
  readonly fundingI18n = inject(FundingI18nService);
  readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;

  readonly selectedContributionAmount = signal<number>(
    this.config.contributionAmounts[0]
  );
  readonly guardianAnimationState = signal<'idle' | 'active'>('idle');
  readonly temporaryVisualEffects = signal<boolean>(false);
  readonly openedPanels = signal<Record<string, boolean>>({
    transparency: true,
    allocation: true,
    contributors: true
  });
  readonly localLoadingIndicator = signal<boolean>(false);
  readonly snapshot = signal(this.fundingService.mockSnapshot);
  readonly effectiveContribution = computed<number>(() =>
    this.selectedContributionAmount()
  );
  readonly campaignProgress = computed<number>(() => {
    const goal = this.config.monthlyGoal;
    if (goal <= 0) {
      return 0;
    }

    const ratio = (this.snapshot().totals.confirmedContributions / goal) * 100;
    return Math.min(100, Math.max(0, Math.round(ratio)));
  });

  readonly impactItems = computed<readonly FundingImpactItem[]>(() => [
    {
      title: this.t('funding.impact.items.infrastructure.title'),
      description: this.t('funding.impact.items.infrastructure.description')
    },
    {
      title: this.t('funding.impact.items.tools.title'),
      description: this.t('funding.impact.items.tools.description')
    },
    {
      title: this.t('funding.impact.items.community.title'),
      description: this.t('funding.impact.items.community.description')
    },
    {
      title: this.t('funding.impact.items.innovation.title'),
      description: this.t('funding.impact.items.innovation.description')
    }
  ]);

  readonly builderRecentLabels = computed<readonly string[]>(() => [
    this.t('funding.builders.recent.0'),
    this.t('funding.builders.recent.1'),
    this.t('funding.builders.recent.2'),
    this.t('funding.builders.recent.3')
  ]);

  readonly loadingState = signal<'loading' | 'empty' | 'success' | 'error'>(
    'success'
  );

  constructor() {
    effect(() => {
      const amount = this.effectiveContribution();
      this.temporaryVisualEffects.set(amount >= 25);
      this.guardianAnimationState.set(amount >= 25 ? 'active' : 'idle');
    });
  }

  async supportProject(): Promise<void> {
    this.localLoadingIndicator.set(true);
    this.loadingState.set('loading');
    try {
      const result = await this.fundingService.startCheckout(
        this.effectiveContribution()
      );
      if (result.status === 'redirected' && typeof window !== 'undefined') {
        window.location.assign(result.redirectUrl);
        return;
      }
      this.loadingState.set('success');
    } catch {
      this.loadingState.set('error');
    } finally {
      this.localLoadingIndicator.set(false);
    }
  }

  t(key: string): string {
    this.fundingI18n.trackTranslationState();
    return this.fundingI18n.t(key);
  }
}
