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
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import {
  isPublicSponsorshipsResponse,
  publicHttpsUrl,
  publicMediaUrl
} from '../../models/public-sponsors.utils.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';
import { SponsorshipsService } from '../../services/sponsorships.service.js';

/** Directory page: loading, pagination and navigation; publication is owned by the API. */
@Component({
  selector: 'openg7-sponsors-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsors-page.component.html',
  styleUrl: './sponsors-page.component.css'
})
export class SponsorsPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sponsorshipsService = inject(SponsorshipsService);
  private controller: AbortController | null = null;
  readonly pageSize = 12;
  readonly data = signal<PublicSponsorshipsResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly page = signal(1);
  readonly failedImages = signal<ReadonlySet<string>>(new Set());
  readonly hasData = computed(() => this.data()?.data_source === 'database');
  readonly sponsorships = computed(() =>
    this.hasData() ? this.data()!.sponsorships : []
  );
  readonly pagination = computed(() =>
    this.hasData() ? this.data()?.pagination : undefined
  );
  readonly totalCount = computed(() => this.pagination()?.total_count ?? null);
  readonly publishedCount = computed(
    () => this.pagination()?.published_count ?? null
  );
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil((this.totalCount() ?? 0) / this.pageSize))
  );
  readonly firstVisible = computed(() => (this.page() - 1) * this.pageSize + 1);
  readonly lastVisible = computed(
    () => this.firstVisible() + this.sponsorships().length - 1
  );
  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly buildersPath = computed(() =>
    this.i18n.localizedPath('/batisseurs')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly followupPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/suivi-commandite')
  );

  constructor() {
    inject(FundingSeoService).bind(
      {
        titleKey: 'funding.seo.sponsors.title',
        descriptionKey: 'funding.seo.sponsors.description',
        path: '/commanditaires',
        imagePath:
          '/assets/openg7-social-communautes-connectees-canada-1920.webp'
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
    const timeout = setTimeout(() => controller.abort(), 15_000);
    this.page.set(page);
    this.loading.set(true);
    this.error.set(false);
    // Do not retain a profile whose consent may have been withdrawn after a failed refresh.
    this.data.set(null);
    this.failedImages.set(new Set());
    try {
      const report = await this.sponsorshipsService.getPublicSponsorshipPage(
        page,
        this.pageSize,
        controller.signal
      );
      if (this.destroyRef.destroyed) return;
      if (
        !isPublicSponsorshipsResponse(report) ||
        (!report.pagination && page !== 1) ||
        (report.pagination &&
          (report.pagination.page !== page ||
            report.pagination.page_size !== this.pageSize))
      ) {
        throw new Error('Invalid public sponsorship response');
      }
      this.data.set(report);
    } catch {
      if (!this.destroyRef.destroyed) this.error.set(true);
    } finally {
      clearTimeout(timeout);
      this.controller = null;
      if (!this.destroyRef.destroyed) {
        this.loading.set(false);
        if (moveFocus) document.getElementById('sponsors-list-title')?.focus();
      }
    }
  }

  trackBySponsor(index: number, sponsor: PublicSponsorshipProfile): string {
    return sponsor.public_id ?? `legacy-${index}`;
  }
  imageFailed(url: string): void {
    this.failedImages.update((previous) => new Set([...previous, url]));
  }
  logoUrl(sponsor: PublicSponsorshipProfile): string | null {
    const url = publicMediaUrl(sponsor.logo_url);
    return url && !this.failedImages().has(url) ? url : null;
  }
  presentationPhoto(sponsor: PublicSponsorshipProfile) {
    const photo = sponsor.media.find(
      (asset) => asset.kind === 'supporting_image'
    );
    const url = publicMediaUrl(photo?.url);
    return photo && url && !this.failedImages().has(url)
      ? { ...photo, url }
      : null;
  }
  websiteUrl = (sponsor: PublicSponsorshipProfile) =>
    publicHttpsUrl(sponsor.website_url);
  publicationUrl = (sponsor: PublicSponsorshipProfile) =>
    sponsor.feed_status === 'published'
      ? publicHttpsUrl(sponsor.feed_public_url)
      : null;
  hasFeedPlacement(sponsor: PublicSponsorshipProfile): boolean {
    return this.publicationUrl(sponsor) !== null;
  }
  amountLabel(sponsor: PublicSponsorshipProfile): string {
    if (sponsor.amount === null)
      return this.i18n.t('funding.sponsorsPage.directory.amountHidden');
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: sponsor.currency,
      currencyDisplay: 'code',
      minimumFractionDigits: Number.isInteger(sponsor.amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(sponsor.amount);
  }
  feedTargetLabel(target: SponsorFeedTarget | null): string {
    return target === 'openg20' ? 'OpenG20' : 'OpenG7';
  }
  feedChannelLabel(channel: SponsorFeedChannel): string {
    return channel === 'facebook' ? 'Facebook' : 'LinkedIn';
  }
  initials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
}
