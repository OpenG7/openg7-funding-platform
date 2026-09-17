import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse,
  SponsorshipDossierTab
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

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
  readonly sponsorshipId = input<string>();
  readonly compact = input(false);
  readonly refreshKey = input<unknown>(0);
  readonly disabled = input(false);
  readonly loaded = output<AdminSponsorshipProgress | null>();
  readonly data = signal<AdminSponsorshipProgressResponse | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );
  readonly i18n = inject(FundingI18nService);
  readonly router = inject(Router);
  private readonly admin = inject(FundingAdminService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private generation = 0;
  private initialized = false;

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
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set('loading');
    this.data.set(null);
    this.loaded.emit(null);
    try {
      const token = this.admin.getSavedAdminToken();
      if (!token) throw new AdminDashboardRequestError(401);
      const remembered = this.compact()
        ? this.admin.getSelectedSponsorship()
        : undefined;
      let response = await this.admin.getSponsorshipProgress(
        token,
        this.sponsorshipId() ?? remembered
      );
      if (generation !== this.generation || this.destroy.destroyed) return;
      if (
        !this.sponsorshipId() &&
        remembered &&
        response.status === 'not_found'
      ) {
        this.admin.selectSponsorship(null);
        response = await this.admin.getSponsorshipProgress(token);
      }
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.data.set(response);
      this.state.set('ready');
      this.loaded.emit(response.dossier);
    } catch (error) {
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.state.set(
        error instanceof AdminDashboardRequestError && error.status === 403
          ? 'forbidden'
          : 'error'
      );
      if (error instanceof AdminDashboardRequestError && error.status === 401) {
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url }
        });
      }
    }
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
