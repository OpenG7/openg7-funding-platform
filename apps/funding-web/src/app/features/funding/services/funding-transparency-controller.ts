import { computed, signal } from '@angular/core';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';
import type { FundingProjectConfig } from '@openg7/funding-models';

import {
  currentFundingMonth,
  monthlyContributions
} from '../models/funding-home.utils.js';
import {
  isTransparencyReport,
  parseTransparencyView,
  type TransparencyRegistryFilter,
  transparencyCsv,
  transparencyExport
} from '../models/funding-transparency.utils.js';

import type { FundTransparencyService } from './fund-transparency.service.js';
import type { FundingI18nService } from './funding-i18n.service.js';

export interface TransparencyViewQueryParams {
  period: string | null;
  type: TransparencyRegistryFilter | null;
}

export interface FundingTransparencyPorts {
  transparency: Pick<FundTransparencyService, 'getPublicTransparency'>;
  config: Pick<FundingProjectConfig, 'currency' | 'monthlyGoal'>;
  i18n: Pick<FundingI18nService, 't'>;
  isBrowser: () => boolean;
  now: () => Date;
  navigate: (params: TransparencyViewQueryParams) => Promise<boolean>;
  publicLink: (params: TransparencyViewQueryParams) => string;
}

/** One public page's snapshot, view and browser resources; never financial authority. */
export class FundingTransparencyController {
  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly checkedAt = signal<string | null>(null);
  readonly currentMonth = signal('');
  readonly snapshotMonth = signal('');
  readonly registryFilter = signal<TransparencyRegistryFilter>('all');
  readonly period = signal('all');
  readonly copyState = signal<'' | 'copied' | 'copyFailed'>('');
  readonly hasSnapshot = computed(
    () => this.data() !== null && this.data()?.data_source !== 'empty'
  );
  readonly availableMonths = computed(() =>
    [...new Set(this.data()?.monthly_summary.map((row) => row.month) ?? [])]
      .sort()
      .reverse()
  );
  readonly periodUnavailable = computed(
    () =>
      this.period() !== 'all' && !this.availableMonths().includes(this.period())
  );
  readonly canExport = computed(
    () =>
      this.hasSnapshot() &&
      !this.loading() &&
      !this.error() &&
      !this.periodUnavailable()
  );
  readonly sourceLabel = computed(() =>
    !this.hasSnapshot()
      ? '—'
      : this.ports.i18n.t(
          this.data()?.data_source === 'database'
            ? 'funding.transparencyPage.sync.database'
            : 'funding.transparencyPage.sync.stripe'
        )
  );
  readonly feeQualityKey = computed(() => {
    const count = this.data()?.pending_fee_count;
    return (
      'funding.transparencyPage.kpis.' +
      (count == null
        ? 'feesUnknown'
        : count > 0
          ? 'feesPending'
          : 'feesComplete')
    );
  });
  readonly kpiCards = computed(() => {
    const report = this.hasSnapshot() ? this.data() : null;
    return [
      {
        label: 'funding.transparency.confirmed',
        value: report?.total_received ?? null,
        detail: 'funding.transparencyPage.kpis.cumulative',
        net: false
      },
      {
        label: 'funding.home.purpose.paymentFees',
        value: report?.total_fees ?? null,
        detail: 'funding.transparencyPage.kpis.totalFees',
        net: false
      },
      {
        label: 'funding.transparencyPage.kpis.refunds',
        value: report?.total_refunded ?? null,
        detail: 'funding.transparencyPage.kpis.totalRefunded',
        net: false
      },
      {
        label: 'funding.transparencyPage.kpis.netBeforeExpenses',
        value: report?.current_available_estimate ?? null,
        detail: 'funding.transparencyPage.kpis.availableForProjects',
        net: true
      }
    ];
  });
  readonly currentMonthReceived = computed(() => {
    const report = this.data();
    if (
      !this.hasSnapshot() ||
      !report ||
      this.snapshotMonth() !== this.currentMonth() ||
      report.currency !== this.ports.config.currency
    )
      return null;
    return monthlyContributions(
      report.monthly_summary,
      this.currentMonth(),
      this.ports.config.currency
    );
  });
  readonly monthlyProgress = computed(() => {
    const received = this.currentMonthReceived();
    return received === null
      ? null
      : this.ports.config.monthlyGoal <= 0
        ? 0
        : Math.min(
            100,
            Math.max(
              0,
              Math.round((received / this.ports.config.monthlyGoal) * 100)
            )
          );
  });
  readonly remainingForGoal = computed(() => {
    const received = this.currentMonthReceived();
    return received === null
      ? null
      : Math.max(0, this.ports.config.monthlyGoal - received);
  });
  readonly publicAllocations = computed(() =>
    this.hasSnapshot() ? (this.data()?.latest_public_allocations ?? []) : []
  );

  private disposed = false;
  private started = false;
  private activeRequest: {
    abort: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private copyGeneration = 0;
  private readonly downloads = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ports: FundingTransparencyPorts) {}

  start(): void {
    if (this.disposed || this.started || !this.ports.isBrowser()) return;
    this.started = true;
    void this.refresh();
    this.interval = setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, 60_000);
  }

  async refresh(): Promise<void> {
    if (this.disposed || !this.ports.isBrowser() || this.activeRequest) return;
    const abort = new AbortController();
    const request = {
      abort,
      timeout: setTimeout(() => abort.abort(), 15_000)
    };
    this.activeRequest = request;
    this.loading.set(true);
    const startedAt = this.ports.now();
    this.currentMonth.set(currentFundingMonth(startedAt));
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error('Public transparency request aborted'));
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // A transport ignoring AbortSignal cannot hold loading open or publish a late result.
      const report = await Promise.race([
        this.ports.transparency.getPublicTransparency(abort.signal),
        cancelled
      ]);
      if (this.disposed) return;
      if (abort.signal.aborted)
        throw new Error('Public transparency request aborted');
      if (!isTransparencyReport(report))
        throw new Error('Invalid public transparency response');
      this.data.set(report);
      this.snapshotMonth.set(
        currentFundingMonth(
          new Date(report.generated_at ?? startedAt.toISOString())
        )
      );
      this.currentMonth.set(currentFundingMonth(this.ports.now()));
      this.checkedAt.set(this.ports.now().toISOString());
      this.error.set(false);
    } catch {
      if (!this.disposed) this.error.set(true);
    } finally {
      clearTimeout(request.timeout);
      abort.signal.removeEventListener('abort', onAbort);
      if (this.activeRequest === request) this.activeRequest = null;
      if (!this.disposed) this.loading.set(false);
    }
  }

  applyView(period: string | null, filter: string | null): void {
    if (this.disposed) return;
    const view = parseTransparencyView(period, filter);
    this.period.set(view.period);
    this.registryFilter.set(view.filter);
    this.resetCopy();
  }

  selectPeriod(value: string): void {
    if (
      !this.disposed &&
      (value === 'all' || this.availableMonths().includes(value))
    ) {
      this.period.set(value);
      this.resetCopy();
      void this.updateViewUrl();
    }
  }

  selectFilter(filter: TransparencyRegistryFilter): void {
    if (this.disposed) return;
    this.registryFilter.set(filter);
    this.resetCopy();
    void this.updateViewUrl();
  }

  private viewQueryParams(): TransparencyViewQueryParams {
    return {
      period: this.period() === 'all' ? null : this.period(),
      type: this.registryFilter() === 'all' ? null : this.registryFilter()
    };
  }

  private async updateViewUrl(): Promise<void> {
    if (!this.ports.isBrowser()) return;
    // Navigation cancellation must not create an unhandled rejection in a public page.
    try {
      await this.ports.navigate(this.viewQueryParams());
    } catch {
      // Route emissions remain authoritative for the selected view.
    }
  }

  scrollToRegistry(): void {
    if (this.disposed || !this.ports.isBrowser()) return;
    const element = document.getElementById('public-registry');
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  handleReportAction(intent: 'csv' | 'json' | 'copy'): void {
    switch (intent) {
      case 'csv':
        this.downloadCsv();
        break;
      case 'json':
        this.downloadReport();
        break;
      case 'copy':
        void this.copyTransparencyLink();
        break;
    }
  }

  downloadReport(): void {
    const report = this.data();
    if (
      this.disposed ||
      !this.ports.isBrowser() ||
      !this.canExport() ||
      !report
    )
      return;
    this.downloadBlob(
      new Blob(
        [
          JSON.stringify(
            transparencyExport(
              report,
              this.period(),
              this.ports.now().toISOString()
            ),
            null,
            2
          )
        ],
        { type: 'application/json' }
      ),
      `openg7-transparence-fonds-batisseurs${this.period() === 'all' ? '' : '-' + this.period()}.json`
    );
  }

  downloadCsv(): void {
    const report = this.data();
    if (
      this.disposed ||
      !this.ports.isBrowser() ||
      !this.canExport() ||
      !report
    )
      return;
    this.downloadBlob(
      new Blob(
        [
          transparencyCsv(report, this.period(), this.ports.now().toISOString())
        ],
        { type: 'text/csv;charset=utf-8' }
      ),
      `openg7-registre-public${this.period() === 'all' ? '' : '-' + this.period()}.csv`
    );
  }

  async copyTransparencyLink(): Promise<void> {
    if (this.disposed || !this.ports.isBrowser()) return;
    const generation = ++this.copyGeneration;
    try {
      const path = this.ports.publicLink(this.viewQueryParams());
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).href
      );
      if (!this.disposed && generation === this.copyGeneration)
        this.copyState.set('copied');
    } catch {
      if (!this.disposed && generation === this.copyGeneration)
        this.copyState.set('copyFailed');
    }
  }

  private resetCopy(): void {
    this.copyGeneration++;
    this.copyState.set('');
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } finally {
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        this.downloads.delete(url);
      }, 0);
      this.downloads.set(url, timer);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.copyGeneration++;
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (this.activeRequest) {
      clearTimeout(this.activeRequest.timeout);
      this.activeRequest.abort.abort();
      this.activeRequest = null;
    }
    for (const [url, timer] of this.downloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.downloads.clear();
  }
}
