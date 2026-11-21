import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  FundTransparencyPublicResponse,
  PublicFundAllocation
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import {
  isPublicProgressReport,
  publicProgressAllocations
} from '../../models/public-progress.utils.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

/** Public reading of published allocations; this page grants no financial authority. */
@Component({
  selector: 'openg7-funding-progress-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-progress-page.component.html',
  styleUrl: './funding-progress-page.component.css'
})
export class FundingProgressPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(FundTransparencyService);
  private controller: AbortController | null = null;
  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly checkedAt = signal<string | null>(null);
  readonly hasRegistry = computed(
    () => this.data()?.data_source === 'database'
  );
  readonly allocations = computed(() => {
    const report = this.data();
    return report ? publicProgressAllocations(report) : [];
  });
  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly intentions = ['support', 'build', 'document'] as const;

  constructor() {
    inject(FundingSeoService).bind(
      {
        titleKey: 'funding.seo.progress.title',
        descriptionKey: 'funding.seo.progress.description',
        path: '/fonds-des-batisseurs/realisations',
        imagePath:
          '/assets/fonds-des-batisseurs-feuille-erable-lumineuse-1920.webp'
      },
      inject(Injector)
    );
    this.destroyRef.onDestroy(() => this.controller?.abort());
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) void this.load();
  }

  async load(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    this.loading.set(true);
    this.error.set(false);
    let onAbort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error('Public progress read cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const report = await Promise.race([
        this.api.getPublicTransparency(controller.signal),
        cancelled
      ]);
      if (this.destroyRef.destroyed) return;
      if (controller.signal.aborted || !isPublicProgressReport(report))
        throw new Error('Invalid public progress report');
      this.data.set(report);
      this.checkedAt.set(new Date().toISOString());
    } catch {
      if (!this.destroyRef.destroyed) this.error.set(true);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      this.controller = null;
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  statusKey(status: PublicFundAllocation['progress_status']): string {
    return 'funding.collectiveProgressPage.status.' + status;
  }

  formatMoney(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeZone: 'UTC'
    }).format(new Date(value));
  }

  formatCheckedAt(value: string): string {
    return (
      new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(new Date(value)) + ' UTC'
    );
  }
}
