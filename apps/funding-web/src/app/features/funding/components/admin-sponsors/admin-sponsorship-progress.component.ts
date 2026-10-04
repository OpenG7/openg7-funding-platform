import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';
import { nextDossierSection } from '../../models/admin-sponsorship-navigation.js';

import { AdminSponsorshipProgressController } from './admin-sponsorship-progress-controller.js';

/** Funding organism: read-only dossier projection and navigation to existing actions. */
@Component({
  selector: 'openg7-admin-sponsorship-progress',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-progress.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-progress.component.css'
  ]
})
export class AdminSponsorshipProgressComponent implements OnInit, OnChanges {
  readonly activity = inject(ContributionActivityService);
  readonly sponsorshipId = input<string>();
  readonly compact = input(false);
  readonly streamlined = input(false);
  readonly activeTab = input<SponsorshipDossierTab>('overview');
  readonly completedSteps = computed(
    () =>
      this.data()?.dossier?.milestones.filter(
        (step) => step.state === 'complete'
      ).length ?? 0
  );
  readonly activeStep = computed(() => {
    const steps =
      this.data()?.dossier?.milestones.filter(
        (step) => step.tab === this.activeTab()
      ) ?? [];
    return (steps.find((step) => step.state !== 'complete') ?? steps.at(-1))
      ?.id;
  });
  readonly refreshKey = input<unknown>(0);
  readonly disabled = input(false);
  readonly refreshRequested = output<void>();
  readonly loaded = output<AdminSponsorshipProgress | null>();
  readonly nextSection = computed(() => {
    const next = this.data()?.dossier?.next;
    return next ? nextDossierSection(next) : null;
  });
  readonly i18n = inject(FundingI18nService);
  readonly router = inject(Router);
  private readonly admin = inject(FundingAdminService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private initialized = false;
  private readonly controller = new AdminSponsorshipProgressController({
    sponsorshipId: () => this.sponsorshipId(),
    compact: () => this.compact(),
    isDestroyed: () => this.destroy.destroyed,
    token: () => this.admin.getSavedAdminToken(),
    rememberedSelection: () => this.admin.getSelectedSponsorship(),
    selectSponsorship: (id) => this.admin.selectSponsorship(id),
    getSponsorshipProgress: (token, id) =>
      this.admin.getSponsorshipProgress(token, id),
    loaded: (dossier) => this.loaded.emit(dossier),
    onUnauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly data = this.controller.data;
  readonly state = this.controller.state;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platform)) {
      this.initialized = true;
      void this.load();
    }
  }
  ngOnChanges(changes: import('@angular/core').SimpleChanges): void {
    if (this.initialized && (changes['sponsorshipId'] || changes['refreshKey']))
      void this.load();
  }
  refresh(): void {
    if (this.streamlined()) this.refreshRequested.emit();
    else void this.load();
  }

  load(): Promise<void> {
    return this.controller.load();
  }
  params(id: string, tab: SponsorshipDossierTab): Record<string, string> {
    return { sponsorshipId: id, tab };
  }
  money(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(amount / 100);
  }
}
