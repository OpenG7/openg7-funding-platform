import { CommonModule, isPlatformBrowser } from '@angular/common';
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
  PublicBuilderProfile,
  PublicBuildersResponse
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { isPublicBuildersResponse } from '../../models/public-builders.utils.js';
import { FundTransparencyService } from '../../services/fund-transparency.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

/** Public directory page: consented records, pagination and navigation. */
@Component({
  selector: 'openg7-builders-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './builders-page.component.html',
  styleUrl: './builders-page.component.css'
})
export class BuildersPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(FundTransparencyService);
  private controller: AbortController | null = null;
  readonly data = signal<PublicBuildersResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly page = signal(1);
  readonly pageSize = 12;
  readonly hasData = computed(() => this.data()?.data_source === 'database');
  readonly publicBuilders = computed(() =>
    this.hasData() ? this.data()!.builders : []
  );
  readonly total = computed(() =>
    this.hasData() ? this.data()!.pagination.total_count : null
  );
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil((this.total() ?? 0) / this.pageSize))
  );
  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly sponsorsPath = computed(() =>
    this.i18n.localizedPath('/commanditaires')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  constructor() {
    inject(FundingSeoService).bind(
      {
        titleKey: 'funding.seo.builders.title',
        descriptionKey: 'funding.seo.builders.description',
        path: '/batisseurs',
        imagePath: '/assets/fonds-des-batisseurs-dragon-coffre-lumineux.png'
      },
      inject(Injector)
    );
    this.destroyRef.onDestroy(() => this.controller?.abort());
  }
  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) void this.load();
  }
  async load(page = this.page(), moveFocus = false): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    this.page.set(page);
    this.loading.set(true);
    this.error.set(false);
    this.data.set(null);
    try {
      const result = await this.api.getPublicBuilders(
        page,
        this.pageSize,
        controller.signal
      );
      if (this.destroyRef.destroyed) return;
      if (
        !isPublicBuildersResponse(result) ||
        result.pagination.page !== page ||
        result.pagination.page_size !== this.pageSize
      )
        throw new Error('Invalid public builder response');
      this.data.set(result);
    } catch {
      if (!this.destroyRef.destroyed) this.error.set(true);
    } finally {
      clearTimeout(timeout);
      this.controller = null;
      if (!this.destroyRef.destroyed) {
        this.loading.set(false);
        if (moveFocus)
          document.getElementById('public-builders-title')?.focus();
      }
    }
  }
  trackBuilder(index: number, builder: PublicBuilderProfile): string {
    return builder.public_id ?? String(index);
  }
  contributionTypeLabel(
    type: PublicBuilderProfile['contribution_type']
  ): string {
    return this.i18n.t(
      type === 'sponsorship_interest'
        ? 'funding.buildersPage.directory.sponsorship'
        : 'funding.buildersPage.directory.personal'
    );
  }
  amountLabel(builder: PublicBuilderProfile): string {
    return builder.amount === null
      ? this.i18n.t('funding.buildersPage.directory.amountHidden')
      : new Intl.NumberFormat(this.i18n.currentLanguage(), {
          style: 'currency',
          currency: builder.currency,
          currencyDisplay: 'code',
          maximumFractionDigits: 2
        }).format(builder.amount);
  }
  initials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }
}
