import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import {
  AdminBadgeComponent,
  type AdminBadgeTone
} from '../admin-ui/admin-badge.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  dossierServiceSummary,
  type DossierServiceStatus
} from '../../models/admin-sponsorship-services-summary.js';

import { AdminSponsorshipNextStepComponent } from './admin-sponsorship-next-step.component.js';
import { AdminSponsorshipProgressController } from './admin-sponsorship-progress-controller.js';

/** Funding organism: read-only dossier projection and navigation to existing actions. */
@Component({
  selector: 'openg7-admin-sponsorship-progress',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    AdminBadgeComponent,
    AdminSponsorshipNextStepComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-progress.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-progress.component.css'
  ]
})
export class AdminSponsorshipProgressComponent implements OnInit, OnChanges {
  readonly sponsorshipId = input<string>();
  readonly compact = input(false);
  readonly streamlined = input(false);
  readonly showNextStep = input(true);
  readonly showSummary = input(true);
  readonly completedSteps = computed(
    () =>
      this.data()?.dossier?.milestones.filter(
        (step) => step.state === 'complete' || step.state === 'not_required'
      ).length ?? 0
  );
  readonly refreshKey = input<unknown>(0);
  readonly disabled = input(false);
  readonly loaded = output<AdminSponsorshipProgress | null>();
  readonly refreshed = output<HTMLElement>();
  readonly i18n = inject(FundingI18nService);
  readonly router = inject(Router);
  private readonly admin = inject(FundingAdminService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('progressPanel');
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
  readonly servicesSummary = computed(() => {
    const dossier = this.data()?.dossier;
    return dossier ? dossierServiceSummary(dossier) : null;
  });

  serviceTone(status: DossierServiceStatus): AdminBadgeTone {
    if (status === 'fulfilled') return 'success';
    if (status === 'blocked' || status === 'error') return 'danger';
    if (['unverified', 'action_required', 'uncertain'].includes(status))
      return 'warning';
    return 'neutral';
  }

  serviceReason(reason: string): string {
    const key =
      'admin.dossier.publicationBridge.schedule.workflow.reason.' + reason;
    const translated = this.i18n.t(key);
    return translated === key
      ? this.i18n.t('admin.sponsorsCleanup.servicesSummary.trackingUnavailable')
      : translated;
  }

  serviceDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeZone: 'America/Toronto'
        }).format(date)
      : this.i18n.t('admin.sponsorsCleanup.servicesSummary.dateUnavailable');
  }

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
  async refresh(): Promise<void> {
    const panel = this.panel()?.nativeElement;
    const restoreFocus = panel?.contains(panel.ownerDocument.activeElement);
    const sponsorshipId = this.sponsorshipId();
    if (restoreFocus) panel?.focus({ preventScroll: true });
    await this.load();
    if (
      restoreFocus &&
      panel &&
      !this.destroy.destroyed &&
      sponsorshipId === this.sponsorshipId() &&
      panel.ownerDocument.activeElement === panel &&
      this.data()?.dossier &&
      !this.showSummary() &&
      !this.showNextStep()
    )
      this.refreshed.emit(panel);
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
