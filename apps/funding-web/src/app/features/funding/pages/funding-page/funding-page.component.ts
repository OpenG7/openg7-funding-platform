import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FundingProjectConfig } from '@openg7/funding-models';

import { CanadaFundingMapComponent } from '../../components/canada-funding-map/canada-funding-map.component.js';
import { ContributionSelectorComponent } from '../../components/contribution-selector/contribution-selector.component.js';
import { FundGuardianComponent } from '../../components/fund-guardian/fund-guardian.component.js';
import { FundingAllocationComponent } from '../../components/funding-allocation/funding-allocation.component.js';
import { FundingHeroComponent } from '../../components/funding-hero/funding-hero.component.js';
import { FundingImpactComponent } from '../../components/funding-impact/funding-impact.component.js';
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
  template: `
    <main>
      <openg7-funding-hero
        [campaignTitle]="config.campaignTitle"
        [campaignDescription]="config.campaignDescription"
      />
      <openg7-fund-guardian
        [asset]="config.guardianAsset"
        [alt]="t('funding.guardian.alt')"
      />
      <openg7-funding-progress
        [label]="t('funding.progress.label')"
        [confirmedTotal]="snapshot().totals.confirmedContributions"
        [goal]="config.monthlyGoal"
      />
      <openg7-contribution-selector
        [amounts]="config.contributionAmounts"
        [label]="t('funding.contribution.selector')"
        [customAmountLabel]="t('funding.contribution.customAmount')"
        (amountSelected)="selectedContributionAmount.set($event)"
      />
      <button type="button" (click)="supportProject()">
        {{ t('funding.actions.support') }}
      </button>
      <p *ngIf="loadingState() === 'loading'">
        {{ t('funding.state.loading') }}
      </p>
      <p *ngIf="loadingState() === 'empty'">{{ t('funding.state.empty') }}</p>
      <p *ngIf="loadingState() === 'success'">
        {{ t('funding.state.success') }}
      </p>
      <p *ngIf="loadingState() === 'error'">{{ t('funding.state.error') }}</p>
      <openg7-funding-transparency
        [title]="t('funding.transparency.title')"
        [confirmedLabel]="t('funding.transparency.confirmed')"
        [feesLabel]="t('funding.transparency.fees')"
        [availableLabel]="t('funding.transparency.available')"
        [confirmed]="snapshot().totals.confirmedContributions"
        [fees]="snapshot().totals.transactionFees"
        [available]="snapshot().totals.availableFunds"
      />
      <openg7-funding-allocation
        [title]="t('funding.allocation.title')"
        [allocation]="snapshot().allocation"
      />
      <openg7-latest-builders
        [title]="t('funding.builders.title')"
        [contributors]="snapshot().contributors"
      />
      <openg7-funding-impact
        [title]="t('funding.impact.title')"
        [description]="t('funding.impact.description')"
      />
      <openg7-canada-funding-map
        [title]="t('funding.map.title')"
        [placeholder]="t('funding.map.placeholder')"
      />
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
  readonly customContributionAmount = signal<number | null>(null);
  readonly guardianAnimationState = signal<'idle' | 'active'>('idle');
  readonly temporaryVisualEffects = signal<boolean>(false);
  readonly openedPanels = signal<Record<string, boolean>>({
    transparency: true,
    allocation: true,
    contributors: true
  });
  readonly localLoadingIndicator = signal<boolean>(false);
  readonly snapshot = signal(this.fundingService.mockSnapshot);
  readonly effectiveContribution = computed<number>(
    () => this.customContributionAmount() ?? this.selectedContributionAmount()
  );

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
      await this.fundingService.startCheckout(this.effectiveContribution());
      this.loadingState.set('success');
    } catch {
      this.loadingState.set('error');
    } finally {
      this.localLoadingIndicator.set(false);
    }
  }

  t(key: string): string {
    return this.fundingI18n.t(key);
  }
}
