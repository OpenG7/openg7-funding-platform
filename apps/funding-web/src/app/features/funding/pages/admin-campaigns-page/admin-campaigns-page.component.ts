import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { Router, RouterLink, type UrlTree } from '@angular/router';
import type {
  AdminCampaignItem,
  AdminCampaignsQuery
} from '@openg7/funding-core';

import fr from '../../../../../assets/i18n/admin-campaigns.fr-CA.json' with { type: 'json' };
import en from '../../../../../assets/i18n/admin-campaigns.en.json' with { type: 'json' };
import frSchedule from '../../../../../assets/i18n/admin-publication-schedule.fr-CA.json' with { type: 'json' };
import enSchedule from '../../../../../assets/i18n/admin-publication-schedule.en.json' with { type: 'json' };
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminSponsorshipPreparationComponent } from '../../components/admin-sponsors/admin-sponsorship-preparation.component.js';
import { automaticAdminUrl } from '../../components/admin-automatic/admin-automatic-run.js';
import { AdminCampaignsStore } from '../../services/admin-campaigns-store.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { groupCampaignRows } from './admin-campaigns-controller.js';

interface CampaignFilters {
  search: string;
  channel: string;
  target: string;
  state: string;
  sort: string;
  direction: string;
}

/** Routed admin page: private promise reads and navigation to existing owner forms. */
@Component({
  selector: 'openg7-admin-campaigns-page',
  standalone: true,
  imports: [
    RouterLink,
    AdminLayoutComponent,
    AdminIconComponent,
    AdminSponsorshipPreparationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-campaigns-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-campaigns-page.component.css'
  ]
})
export class AdminCampaignsPageComponent {
  readonly c = inject(AdminCampaignsStore);
  readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  readonly channels = ['website', 'facebook', 'linkedin'] as const;
  readonly targets = ['openg7', 'openg20'] as const;
  readonly states = [
    'waiting',
    'action_required',
    'blocked',
    'error',
    'uncertain',
    'complete'
  ] as const;
  readonly sorts = ['preparation', 'paid_at', 'due_at'] as const;
  readonly filters = signal<CampaignFilters>(this.filterDraft(this.c.query()));
  readonly grouped = signal(true);
  readonly groups = computed(() =>
    groupCampaignRows(this.c.data()?.items ?? [], this.grouped())
  );
  readonly dossierCount = computed(
    () => new Set(this.c.data()?.items.map((row) => row.contributionId)).size
  );
  readonly preparationRefreshKey = computed(
    () =>
      `${this.c.data()?.generatedAt ?? ''}:${this.c.selected()?.preparation.version ?? ''}`
  );

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { campaigns: language === 'en' ? en : fr }
        })
      );
    });
    afterNextRender(() => void this.c.connect());
    effect(() => {
      this.c.sessionKey();
      untracked(() => {
        this.filters.set(this.filterDraft(this.c.query()));
      });
    });
    inject(DestroyRef).onDestroy(() => this.c.detach());
  }

  private filterDraft(query: AdminCampaignsQuery): CampaignFilters {
    return {
      search: query.search ?? '',
      channel: query.channel ?? '',
      target: query.target ?? '',
      state: query.state ?? '',
      sort: query.sort,
      direction: query.direction
    };
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.campaigns.' + key, params);
  }

  setFilter(key: keyof CampaignFilters, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  apply(event: Event): void {
    event.preventDefault();
    const filters = this.filters();
    const query: AdminCampaignsQuery = {
      page: 1,
      pageSize: 25,
      sort: this.sorts.find((sort) => sort === filters.sort) ?? 'preparation',
      direction: filters.direction === 'asc' ? 'asc' : 'desc',
      channel: this.channels.find((channel) => channel === filters.channel),
      target: this.targets.find((target) => target === filters.target),
      state: this.states.find((state) => state === filters.state),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {})
    };
    void this.c.load(query);
  }

  changePage(delta: number): void {
    const pagination = this.c.data()?.pagination;
    if (
      !pagination ||
      (delta < 0 && !pagination.hasPreviousPage) ||
      (delta > 0 && !pagination.hasNextPage)
    )
      return;
    void this.c.load({ ...this.c.query(), page: pagination.page + delta });
  }

  date(value: string | null | undefined): string {
    if (!value || !Number.isFinite(Date.parse(value))) return this.t('noDate');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeZone: 'America/Toronto'
    }).format(new Date(value));
  }

  scheduledDate(value: string | null): string {
    if (!value || !Number.isFinite(Date.parse(value))) return this.t('noDate');
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto'
    }).format(new Date(value));
  }

  workflowReason(row: AdminCampaignItem): string {
    const reasons: Readonly<Record<string, string>> =
      this.i18n.currentLanguage() === 'en'
        ? enSchedule.workflow.reason
        : frSchedule.workflow.reason;
    return reasons[row.workflow.reason] ?? this.t('detail.unknownReason');
  }

  deliveryUrl(row: AdminCampaignItem): UrlTree {
    return this.router.createUrlTree(
      ['/admin/fundraiser/publications/automation'],
      {
        queryParams: {
          sponsorshipId: row.contributionId,
          deliveryId: row.workflow.deliveryId ?? ''
        }
      }
    );
  }

  ownerUrl(row: AdminCampaignItem): UrlTree {
    return this.router.parseUrl(
      automaticAdminUrl(row.adminUrl) ??
        `/admin/fundraiser/sponsors?sponsorshipId=${encodeURIComponent(row.contributionId)}&tab=publication`
    );
  }

  proofUrl(row: AdminCampaignItem): string | null {
    const value = row.proof?.externalPostUrl;
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
}
