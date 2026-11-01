import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  inject,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminDashboardResponse } from '@openg7/funding-core';

import { AdminAttentionPanelComponent } from '../../components/admin-attention/admin-attention-panel.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminBadgeComponent } from '../../components/admin-ui/admin-badge.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminCockpitMetricsComponent } from '../../components/admin-cockpit/admin-cockpit-metrics.component.js';
import { AdminCockpitActivityComponent } from '../../components/admin-cockpit/admin-cockpit-activity.component.js';
import { AdminCockpitSystemsComponent } from '../../components/admin-cockpit/admin-cockpit-systems.component.js';
import { AdminPlatformJourneysComponent } from '../../components/admin-cockpit/admin-platform-journeys.component.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-admin-dashboard-page',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminLayoutComponent,
    AdminAttentionPanelComponent,
    AdminBadgeComponent,
    AdminIconComponent,
    AdminCockpitMetricsComponent,
    AdminCockpitActivityComponent,
    AdminCockpitSystemsComponent,
    AdminPlatformJourneysComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-dashboard-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-dashboard-page.component.css'
  ]
})
export class AdminDashboardPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  readonly i18n = inject(FundingI18nService);
  readonly attentionRefresh = signal(0);
  readonly dashboard = signal<AdminDashboardResponse | null>(null);
  readonly readError = signal('');
  readonly state = signal<
    'idle' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable'
  >('idle');

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    if (this.state() === 'loading') return;
    const token = this.admin.getSavedAdminToken();
    if (!token) {
      await this.returnToLogin();
      return;
    }
    this.attentionRefresh.update((value) => value + 1);
    this.state.set('loading');
    this.readError.set('');
    try {
      const dashboard = await this.admin.getDashboard(token);
      if (dashboard.data_available === false) {
        this.dashboard.set(null);
        this.state.set('unavailable');
        return;
      }
      this.dashboard.set(dashboard);
      this.state.set('ready');
    } catch (error) {
      if (
        error instanceof AdminDashboardRequestError &&
        error.code === 'ADMIN_FINANCIAL_CURRENCY_CONFLICT'
      ) {
        this.dashboard.set(null);
        this.readError.set('admin.financial.currencyConflict');
        this.state.set('error');
        return;
      }
      if (error instanceof AdminDashboardRequestError && error.status === 401) {
        await this.returnToLogin();
      } else if (
        error instanceof AdminDashboardRequestError &&
        error.status === 403
      ) {
        this.dashboard.set(null);
        this.state.set('forbidden');
      } else {
        // Keep the last successful snapshot, with a visible stale-data notice.
        this.state.set('error');
      }
    }
  }

  formatCount(count: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage()).format(count);
  }

  dateLabel(value: string | null, dateOnly = false): string {
    if (!value || !Number.isFinite(Date.parse(value)))
      return this.i18n.t('admin.dashboard.notAvailable');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: dateOnly ? 'long' : 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' as const })
    }).format(new Date(value));
  }

  private async returnToLogin(): Promise<void> {
    this.dashboard.set(null);
    this.admin.clearAdminSession();
    await this.router.navigate(['/admin/login'], {
      queryParams: { returnUrl: '/admin/fundraiser' }
    });
  }
}
