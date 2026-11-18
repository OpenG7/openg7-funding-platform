import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  type UrlTree
} from '@angular/router';
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
import {
  adminCampaignsDestination,
  adminCampaignsReturnContext
} from '../../models/admin-campaigns-navigation.js';
import { revealControllerFocus } from '../../components/admin-controller/admin-controller-navigation.js';
import { capturePreparationFocus } from '../../components/admin-preparation/preparation-focus.js';

import {
  campaignDetailAction,
  groupCampaignRows
} from './admin-campaigns-controller.js';

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
  private readonly route = inject(ActivatedRoute);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
  readonly destination = computed(() =>
    adminCampaignsDestination(this.params())
  );
  private readonly rendered = signal(false);
  private routeKey = '';
  private pendingDetailFocus: {
    id: string;
    session: string;
    restore: () => void;
  } | null = null;
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
  readonly advancedFiltersActive = computed(
    () =>
      !!this.filters().target ||
      this.filters().sort !== 'preparation' ||
      this.filters().direction !== 'desc'
  );
  readonly grouped = signal(true);
  readonly groups = computed(() =>
    groupCampaignRows(this.c.data()?.items ?? [], this.grouped())
  );
  readonly dossierCount = computed(
    () => new Set(this.c.data()?.items.map((row) => row.contributionId)).size
  );
  readonly detailRows = computed(() => {
    const row = this.c.selected();
    return row ? [row] : [];
  });
  readonly preparationExpanded = signal(false);
  readonly contentExpanded = signal(false);
  readonly proofExpanded = signal(false);
  readonly detailAction = campaignDetailAction;
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
    afterNextRender(() => this.rendered.set(true));
    effect(() => {
      const rendered = this.rendered();
      const destination = this.destination();
      untracked(() => {
        if (!rendered) return;
        const key = JSON.stringify(destination);
        if (key === this.routeKey) return;
        this.routeKey = key;
        if (destination.kind === 'invalid') this.c.detach();
        else {
          void this.c.connect(
            destination.kind === 'focused' ? destination.focus : undefined
          );
          this.filters.set(this.filterDraft(this.c.query()));
        }
      });
    });
    effect(() => {
      this.c.sessionKey();
      untracked(() => {
        this.filters.set(this.filterDraft(this.c.query()));
      });
    });
    effect(() => {
      this.c.sessionKey();
      this.c.selectedId();
      this.preparationExpanded.set(false);
      this.contentExpanded.set(false);
      this.proofExpanded.set(false);
    });
    effect(() => {
      const rendered = this.rendered();
      const state = this.c.state();
      const id = this.c.selectedId();
      const session = this.c.sessionKey();
      const row = this.c.selected();
      untracked(() => {
        if (!rendered) return;
        if (!id || !session) {
          this.pendingDetailFocus = null;
          return;
        }
        if (
          this.pendingDetailFocus &&
          (this.pendingDetailFocus.id !== id ||
            this.pendingDetailFocus.session !== session)
        )
          this.pendingDetailFocus = null;
        if (state === 'loading' && !this.pendingDetailFocus) {
          const restore = this.captureDetailFocus();
          if (restore) this.pendingDetailFocus = { id, session, restore };
        } else if (
          state === 'ready' &&
          row?.id === id &&
          this.pendingDetailFocus
        ) {
          const pending = this.pendingDetailFocus;
          this.pendingDetailFocus = null;
          afterNextRender(
            () => {
              if (
                this.c.selected()?.id === pending.id &&
                this.c.sessionKey() === pending.session
              )
                pending.restore();
            },
            { injector: this.injector }
          );
        } else if (state !== 'loading') {
          this.pendingDetailFocus = null;
        }
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
      ...(this.c.query().sponsorshipId
        ? { sponsorshipId: this.c.query().sponsorshipId }
        : {}),
      ...(this.c.query().obligationId
        ? { obligationId: this.c.query().obligationId }
        : {}),
      channel: this.channels.find((channel) => channel === filters.channel),
      target: this.targets.find((target) => target === filters.target),
      state: this.states.find((state) => state === filters.state),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {})
    };
    void this.c.load(query);
  }

  showAll(): void {
    this.routeKey = JSON.stringify({ kind: 'all' });
    void this.c.connect(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sponsorshipId: null, obligationId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.filters.set(this.filterDraft(this.c.query()));
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

  select(row: AdminCampaignItem): void {
    this.c.select(row);
    afterNextRender(
      () => {
        if (this.c.selected()?.id !== row.id) return;
        const heading = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-og7="campaign-detail-heading"]'
        );
        if (heading) revealControllerFocus(heading);
      },
      { injector: this.injector }
    );
  }

  returnToList(): void {
    const selectedId = this.c.selectedId();
    const row = Array.from(
      this.element.nativeElement.querySelectorAll<HTMLElement>(
        '[data-og7="campaign-row"]'
      )
    ).find((item) => item.getAttribute('data-og7-id') === selectedId);
    if (row) revealControllerFocus(row);
  }

  openDetail(details: HTMLDetailsElement, row: AdminCampaignItem): void {
    if (this.c.selected()?.id !== row.id) return;
    details.open = true;
    if (details.getAttribute('data-og7') === 'campaign-preparation-details')
      this.preparationExpanded.set(true);
    if (details.getAttribute('data-og7') === 'campaign-proof-details')
      this.proofExpanded.set(true);
    const summary = details.querySelector<HTMLElement>('summary');
    if (summary) revealControllerFocus(summary);
  }

  private captureDetailFocus(): (() => void) | null {
    const host = this.element.nativeElement;
    const document = host.ownerDocument;
    const active = document.activeElement;
    const detail = host.querySelector('[data-og7="campaign-detail"]');
    if (!active || !detail?.contains(active)) return null;
    const preparationFocus = capturePreparationFocus(host);
    const disclosure = active
      .closest<HTMLElement>(
        '[data-og7="campaign-content-details"], [data-og7="campaign-preparation-details"], [data-og7="campaign-proof-details"]'
      )
      ?.getAttribute('data-og7');
    const hook =
      disclosure ??
      active.getAttribute('data-og7') ??
      'campaign-detail-heading';
    return () => {
      if (
        !host.isConnected ||
        document.activeElement !== document.body ||
        document.querySelector('dialog[open]')
      )
        return;
      preparationFocus?.();
      if (document.activeElement !== document.body) return;
      const target = Array.from(
        host.querySelectorAll<HTMLElement>('[data-og7]')
      ).find((candidate) => candidate.getAttribute('data-og7') === hook);
      const focus = disclosure
        ? target?.querySelector<HTMLElement>(':scope > summary')
        : target;
      const fallback = host.querySelector<HTMLElement>(
        '[data-og7="campaign-detail-heading"]'
      );
      const destination =
        focus?.getClientRects().length &&
        !focus.matches(':disabled,[aria-disabled="true"]')
          ? focus
          : fallback;
      if (destination) revealControllerFocus(destination);
    };
  }

  deliveryActionLabel(row: AdminCampaignItem): string {
    if (['uncertain', 'error'].includes(row.workflow.state))
      return this.t('detail.reviewResult');
    return this.t(
      row.workflow.reason === 'publication_scheduled'
        ? 'detail.openScheduled'
        : 'detail.openDelivery'
    );
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

  evidenceDate(value: string | null): string | null {
    return value && Number.isFinite(Date.parse(value))
      ? this.scheduledDate(value)
      : null;
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
          obligationId: row.id,
          deliveryId: row.workflow.deliveryId ?? ''
        }
      }
    );
  }

  ownerUrl(row: AdminCampaignItem): UrlTree {
    const deliveryId = row.workflow.deliveryId ?? row.proof?.deliveryId;
    const returnContext = adminCampaignsReturnContext(this.params(), row);
    const destination = this.router.parseUrl(
      automaticAdminUrl(row.adminUrl) ??
        `/admin/fundraiser/sponsors?sponsorshipId=${encodeURIComponent(row.contributionId)}&tab=publication`
    );
    const ownerParams = { ...destination.queryParams };
    if (returnContext) {
      delete ownerParams['draftId'];
      delete ownerParams['deliveryId'];
    }
    destination.queryParams = {
      ...ownerParams,
      sponsorshipId: row.contributionId,
      obligationId: row.id,
      ...(returnContext ?? (deliveryId ? { deliveryId } : {}))
    };
    return destination;
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
