import { FormsModule } from '@angular/forms';
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
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { AdminAttentionListComponent } from './admin-attention-list.component.js';

/** Owns loading and URL filters for the queue or its independent cockpit summary. */
@Component({
  selector: 'openg7-admin-attention-panel',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    AdminAttentionListComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-attention-panel.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-attention.css'
  ]
})
export class AdminAttentionPanelComponent implements OnInit, OnChanges {
  readonly compact = input(false);
  readonly refreshKey = input(0);
  readonly data = signal<AdminWorkQueueResponse | null>(null);
  readonly state = signal<
    'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable'
  >('loading');
  readonly query = signal<AdminWorkQueueQuery>({});
  readonly returnTo = signal('/admin/fundraiser/attention');
  readonly types = [
    'sponsorship_needs_info',
    'sponsorship_needs_review',
    'publication_needs_preparation',
    'publication_late',
    'email_delivery_failed',
    'financial_data_warning',
    'invoice_missing',
    'stripe_event_failed',
    'stripe_event_stalled',
    'publication_ready',
    'publication_slot_upcoming'
  ] as const;
  readonly priorities = [
    'urgent',
    'today',
    'this_week',
    'informational'
  ] as const;
  private readonly admin = inject(FundingAdminService);
  private readonly i18n = inject(FundingI18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private initialized = false;
  private generation = 0;
  ngOnInit(): void {
    if (!isPlatformBrowser(this.platform)) return;
    this.initialized = true;
    if (this.compact()) {
      void this.load();
      return;
    }
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        this.query.set({
          type: (params.get('type') ||
            undefined) as AdminWorkQueueQuery['type'],
          priority: (params.get('priority') ||
            undefined) as AdminWorkQueueQuery['priority'],
          due: (params.get('due') || 'all') as AdminWorkQueueQuery['due'],
          page: Number(params.get('page') || 1),
          pageSize: 25,
          itemId: params.get('itemId') || undefined
        });
        this.returnTo.set(
          this.router.serializeUrl(
            this.router.createUrlTree(['/admin/fundraiser/attention'], {
              queryParams: Object.fromEntries(
                params.keys
                  .filter((key) => key !== 'returnTo')
                  .map((key) => [key, params.get(key)])
              )
            })
          )
        );
        this.data.set(null);
        void this.load();
      });
  }
  ngOnChanges(): void {
    if (this.initialized && this.compact()) void this.load();
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set('loading');
    try {
      if (!this.admin.hasValidAdminSession())
        throw new AdminDashboardRequestError(401);
      const response = await this.admin.getWorkQueue(
        this.admin.getSavedAdminToken(),
        this.compact() ? { due: 'today', pageSize: 4 } : this.query()
      );
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.data.set(response.available ? response : null);
      this.state.set(response.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (generation !== this.generation || this.destroy.destroyed) return;
      if (error instanceof AdminDashboardRequestError && error.status === 401) {
        this.data.set(null);
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url }
        });
      } else if (
        error instanceof AdminDashboardRequestError &&
        error.status === 403
      ) {
        this.data.set(null);
        this.state.set('forbidden');
      } else this.state.set('error');
    }
  }
  filter(key: string, value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null, page: null, itemId: null },
      queryParamsHandling: 'merge'
    });
  }
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }
  page(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge'
    });
  }
}
