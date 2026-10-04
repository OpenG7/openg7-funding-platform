import { computed, signal } from '@angular/core';
import type {
  FundTransparencyPublicResponse,
  FundingSnapshot,
  PublicMonthlySummary,
  PublicSponsorshipBatchAvailabilityResponse
} from '@openg7/funding-core';
import type { FundingProjectConfig } from '@openg7/funding-models';

import type { FundingContributionSubmission } from '../components/funding-contribution-form/funding-contribution-form.component.js';
import {
  currentFundingMonth,
  monthlyContributions
} from '../models/funding-home.utils.js';

import type { CheckoutStatusMonitor } from './checkout-status-monitor.service.js';
import type { FundTransparencyService } from './fund-transparency.service.js';
import type { FundingService } from './funding.service.js';

export interface FundingHomePorts {
  funding: Pick<
    FundingService,
    | 'getPublicFundingConfig'
    | 'getSponsorshipBatchAvailability'
    | 'startCheckout'
  >;
  transparency: Pick<FundTransparencyService, 'getPublicTransparency'>;
  checkout: Pick<CheckoutStatusMonitor, 'start' | 'cancel' | 'dismiss'>;
  config: Pick<
    FundingProjectConfig,
    'contributionAmounts' | 'currency' | 'monthlyGoal'
  >;
  isBrowser: () => boolean;
  now: () => Date;
  navigate: (url: string) => void;
  clearCheckoutReturn: () => void;
}

const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

/** One home page's public projections and checkout intent; the API confirms payment. */
export class FundingHomeController {
  readonly allowedContributionAmounts;
  readonly sponsorshipBatchAvailability =
    signal<PublicSponsorshipBatchAvailabilityResponse | null>(null);
  readonly sponsorshipSelectionEnabled = signal<boolean>(false);
  readonly monthlySummary = signal<readonly PublicMonthlySummary[]>([]);
  readonly currentMonth = signal('');
  readonly currency;
  readonly snapshot = signal<FundingSnapshot>({
    totals: {
      confirmedContributions: 0,
      transactionFees: 0,
      availableFunds: 0
    },
    allocation: [],
    contributors: []
  });
  readonly hasTransparencySnapshot = signal(false);
  readonly transparencyState = signal<'loading' | 'synced' | 'empty' | 'error'>(
    'loading'
  );
  readonly contributionCount = signal(0);
  readonly lastTransparencySync = signal<string | null>(null);
  readonly transparencySource =
    signal<FundTransparencyPublicResponse['data_source']>('empty');
  readonly loadingState = signal<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  readonly checkoutResultMode = signal<'mocked' | null>(null);
  readonly pendingSponsorFollowupToken = signal<string | null>(null);
  readonly currentMonthContributions = computed(() =>
    monthlyContributions(
      this.monthlySummary(),
      this.currentMonth(),
      this.currency()
    )
  );
  readonly campaignProgress = computed(() => {
    const goal = this.ports.config.monthlyGoal;
    return goal <= 0
      ? 0
      : Math.min(
          100,
          Math.max(
            0,
            Math.round((this.currentMonthContributions() / goal) * 100)
          )
        );
  });
  readonly remainingForMonthlyGoal = computed(() =>
    Math.max(
      0,
      this.ports.config.monthlyGoal - this.currentMonthContributions()
    )
  );
  readonly allocationTotal = computed(() =>
    this.snapshot().allocation.reduce((sum, item) => sum + item.amount, 0)
  );
  readonly allocationDonut = computed(() => {
    const total = this.allocationTotal();
    if (total <= 0) return 'conic-gradient(#f4b53c 0 100%)';
    let cursor = 0;
    const segments = this.snapshot().allocation.map((allocation, index) => {
      const start = cursor;
      cursor += (allocation.amount / total) * 100;
      return `${this.allocationColor(index)} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${segments.join(', ')})`;
  });

  private disposed = false;
  private started = false;
  private configGeneration = 0;
  private availabilityGeneration = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private activeRequest: {
    abort: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly allocationPalette = [
    '#f4b53c',
    '#2f9fe5',
    '#58d79a',
    '#e5df80',
    '#e58a3e'
  ];

  constructor(private readonly ports: FundingHomePorts) {
    this.allowedContributionAmounts = signal<readonly number[]>(
      ports.config.contributionAmounts
    );
    this.currency = signal<string>(ports.config.currency);
  }

  start(params: URLSearchParams): void {
    if (this.disposed || this.started || !this.ports.isBrowser()) return;
    this.started = true;
    const checkout = params.get('checkout');
    if (checkout === 'cancel') {
      this.ports.checkout.cancel(params.get('reference'));
    } else if (checkout === 'success') {
      this.ports.checkout.start(params.get('reference'));
      const token = params.get('followup_token');
      if (
        params.get('contributionType') === 'sponsorship_interest' &&
        token &&
        sponsorshipFollowupTokenPattern.test(token)
      ) {
        this.pendingSponsorFollowupToken.set(token);
      }
    }
    void this.loadPublicTransparency();
    void this.loadPublicFundingConfig();
    this.interval = setInterval(() => {
      void this.loadPublicTransparency({ silent: true });
    }, 30_000);
  }

  async loadPublicFundingConfig(): Promise<void> {
    if (this.disposed || !this.ports.isBrowser()) return;
    const generation = ++this.configGeneration;
    ++this.availabilityGeneration;
    try {
      const runtimeConfig = await this.ports.funding.getPublicFundingConfig();
      if (this.disposed || generation !== this.configGeneration) return;
      this.allowedContributionAmounts.set(
        runtimeConfig.allowed_contribution_amounts ??
          this.ports.config.contributionAmounts
      );
      this.sponsorshipSelectionEnabled.set(
        runtimeConfig.business_sponsorship_enabled
      );
      if (runtimeConfig.business_sponsorship_enabled) {
        await this.loadSponsorshipBatchAvailability();
        return;
      }
    } catch {
      if (this.disposed || generation !== this.configGeneration) return;
      this.sponsorshipSelectionEnabled.set(false);
    }
    this.sponsorshipBatchAvailability.set(null);
  }

  async loadSponsorshipBatchAvailability(): Promise<void> {
    if (this.disposed || !this.ports.isBrowser()) return;
    const generation = ++this.availabilityGeneration;
    try {
      const availability =
        await this.ports.funding.getSponsorshipBatchAvailability();
      if (!this.disposed && generation === this.availabilityGeneration)
        this.sponsorshipBatchAvailability.set(availability);
    } catch {
      if (!this.disposed && generation === this.availabilityGeneration)
        this.sponsorshipBatchAvailability.set(null);
    }
  }

  async loadPublicTransparency(
    options: { readonly silent?: boolean } = {}
  ): Promise<void> {
    if (this.disposed || !this.ports.isBrowser() || this.activeRequest) return;
    const abort = new AbortController();
    const request = {
      abort,
      timeout: setTimeout(() => abort.abort(), 15_000)
    };
    this.activeRequest = request;
    if (!options.silent) this.transparencyState.set('loading');
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error('Public transparency request aborted'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const report = await Promise.race([
        this.ports.transparency.getPublicTransparency(abort.signal),
        cancelled
      ]);
      if (this.disposed) return;
      if (abort.signal.aborted)
        throw new Error('Public transparency request aborted');
      const snapshot = this.toFundingSnapshot(report);
      const state = this.hasPublicFinanceData(report) ? 'synced' : 'empty';
      this.currentMonth.set(currentFundingMonth(this.ports.now()));
      this.monthlySummary.set(report.monthly_summary);
      this.snapshot.set(snapshot);
      this.contributionCount.set(report.contributions_count);
      this.currency.set(report.currency || this.ports.config.currency);
      this.lastTransparencySync.set(report.last_updated_at);
      this.transparencySource.set(report.data_source);
      this.hasTransparencySnapshot.set(true);
      this.transparencyState.set(state);
    } catch {
      if (!this.disposed) this.transparencyState.set('error');
    } finally {
      clearTimeout(request.timeout);
      abort.signal.removeEventListener('abort', onAbort);
      if (this.activeRequest === request) this.activeRequest = null;
    }
  }

  dismissCheckoutNotice(): void {
    if (this.disposed) return;
    this.ports.checkout.dismiss();
    this.pendingSponsorFollowupToken.set(null);
    if (this.ports.isBrowser()) this.ports.clearCheckoutReturn();
  }

  async supportProject(
    submission: FundingContributionSubmission
  ): Promise<void> {
    if (
      this.disposed ||
      !this.ports.isBrowser() ||
      this.loadingState() === 'loading'
    )
      return;
    this.checkoutResultMode.set(null);
    this.loadingState.set('loading');
    try {
      const result = await this.ports.funding.startCheckout(
        submission.amount,
        submission.consent
      );
      if (this.disposed) return;
      if (result.status === 'redirected') {
        this.ports.navigate(result.redirectUrl);
        return;
      }
      this.checkoutResultMode.set(result.status);
      this.loadingState.set('success');
      void this.loadPublicTransparency({ silent: true });
    } catch {
      if (!this.disposed) this.loadingState.set('error');
    }
  }

  allocationShare(amount: number): number {
    const total = this.allocationTotal();
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }

  allocationColor(index: number): string {
    return this.allocationPalette[index % this.allocationPalette.length];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (this.activeRequest) {
      clearTimeout(this.activeRequest.timeout);
      this.activeRequest.abort.abort();
      this.activeRequest = null;
    }
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
