import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  type UrlTree
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PreflightDeskOrder,
  PreflightDeskQuery,
  PreflightDeskResponse,
  PreflightDeskService,
  PreflightDeskStage
} from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-preflight-desk.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-preflight-desk.fr-CA.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';
import { AdminSponsorshipPreparationComponent } from '../admin-sponsors/admin-sponsorship-preparation.component.js';
import { automaticAdminUrl } from '../admin-automatic/admin-automatic-run.js';

type Stage = PreflightDeskQuery['stage'];
type InboxState =
  'loading' | 'ready' | 'disabled' | 'unavailable' | 'forbidden';
const stages: readonly PreflightDeskStage[] = [
  'to_prepare',
  'to_review',
  'to_deliver',
  'delivered'
];

/** Funding's work projection; preparation, authorization and qualified delivery stay server-owned. */
@Component({
  selector: 'openg7-admin-preflight-desk',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminIconComponent,
    AdminSponsorshipPreparationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-preflight-desk.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-preflight-desk.component.css'
  ]
})
export class AdminPreflightDeskComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly reviewPanel =
    viewChild<ElementRef<HTMLElement>>('reviewPanel');
  private readonly summaryTitle =
    viewChild<ElementRef<HTMLElement>>('summaryTitle');
  readonly i18n = inject(FundingI18nService);
  readonly inboxState = input<InboxState>('loading');
  readonly inboxCheckedAt = input<string | null>(null);
  readonly state = signal<'loading' | 'ready' | 'unavailable' | 'forbidden'>(
    'loading'
  );
  readonly response = signal<PreflightDeskResponse | null>(null);
  readonly query = signal<PreflightDeskQuery>({
    page: 1,
    pageSize: 20,
    stage: 'all'
  });
  readonly search = signal('');
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly selection = signal<{
    order: PreflightDeskOrder;
    service: PreflightDeskService;
  } | null>(null);
  readonly stale = signal(false);
  readonly stages = stages;
  readonly summary = computed(() => this.response()?.summary ?? null);
  readonly orders = computed(() => this.response()?.orders ?? []);
  readonly refreshKey = computed(
    () => `${this.response()?.generatedAt ?? ''}:${this.admin.dataRevision()}`
  );
  private requestSerial = 0;
  private request?: AbortController;
  private disposed = false;
  private routeKey = '';
  private currentSession = this.admin.sessionGeneration();
  private revision = this.admin.dataRevision();
  private reviewTrigger: HTMLElement | null = null;
  private expansionInitialized = false;

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { preflightDesk: language === 'en' ? en : fr }
        })
      );
    });
    effect(() => {
      const session = this.admin.sessionGeneration();
      untracked(() => {
        if (session === this.currentSession) return;
        this.currentSession = session;
        this.invalidate();
        this.response.set(null);
        this.selection.set(null);
        if (!this.admin.hasValidAdminSession()) this.signIn();
        else void this.load(false);
      });
    });
    effect(() => {
      const revision = this.admin.dataRevision();
      untracked(() => {
        if (revision === this.revision) return;
        this.revision = revision;
        void this.load(true);
      });
    });
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.invalidate();
    });
  }

  ngOnInit(): void {
    if (!this.browser) return;
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const candidate = params.get('deskStatus');
        const stage: Stage = stages.includes(candidate as PreflightDeskStage)
          ? (candidate as PreflightDeskStage)
          : 'all';
        const rawPage = params.get('deskPage') ?? '1';
        const page = /^[1-9]\d{0,4}$/.test(rawPage) ? Number(rawPage) : 1;
        const search = (params.get('deskSearch') ?? '').slice(0, 120);
        const query: PreflightDeskQuery = {
          page,
          pageSize: 20,
          stage,
          ...(search ? { search } : {})
        };
        const key = JSON.stringify(query);
        if (key === this.routeKey) return;
        this.routeKey = key;
        this.query.set(query);
        this.search.set(search);
        this.selection.set(null);
        this.expansionInitialized = false;
        void this.load(false);
      });
  }

  async load(preserve = true): Promise<void> {
    if (!this.browser || this.disposed) return;
    this.invalidate();
    const serial = this.requestSerial,
      session = this.admin.sessionGeneration();
    const controller = new AbortController();
    this.request = controller;
    if (!preserve) this.response.set(null);
    this.stale.set(false);
    this.state.set('loading');
    try {
      const response = await this.admin.preflightDesk.read(
        this.query(),
        controller.signal
      );
      if (!this.current(serial, session, controller)) return;
      this.response.set(response);
      this.state.set('ready');
      if (!this.expansionInitialized && response.orders[0])
        this.expanded.set(new Set([response.orders[0].contributionId]));
      this.expansionInitialized = true;
      const selected = this.selection();
      if (selected) {
        const order = response.orders.find(
          (order) => order.contributionId === selected.order.contributionId
        );
        const service = order?.services.find(
          (service) => service.id === selected.service.id
        );
        this.selection.set(order && service ? { order, service } : null);
      }
    } catch (error) {
      if (!this.current(serial, session, controller)) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401) {
        this.signIn();
        return;
      }
      if (status === 403) {
        this.response.set(null);
        this.selection.set(null);
      }
      this.stale.set(this.response() !== null);
      this.state.set(status === 403 ? 'forbidden' : 'unavailable');
    }
  }

  chooseStage(stage: Stage): void {
    void this.navigate({
      deskStatus: stage === 'all' ? null : stage,
      deskPage: null
    });
  }

  submitSearch(event: Event): void {
    event.preventDefault();
    void this.navigate({
      deskSearch: this.search().trim() || null,
      deskPage: null
    });
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }
  changePage(page: number): void {
    void this.navigate({ deskPage: page === 1 ? null : String(page) });
  }
  toggleOrder(id: string): void {
    const expanded = new Set(this.expanded());
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    this.expanded.set(expanded);
  }

  examine(
    order: PreflightDeskOrder,
    service: PreflightDeskService,
    event: Event
  ): void {
    this.reviewTrigger =
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.selection.set({ order, service });
    afterNextRender(
      () => {
        const panel = this.reviewPanel()?.nativeElement;
        panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }

  closeReview(): void {
    this.selection.set(null);
    afterNextRender(
      () => {
        if (this.reviewTrigger?.isConnected) this.reviewTrigger.focus();
        else this.summaryTitle()?.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }

  count(stage: PreflightDeskStage): number {
    const summary = this.summary();
    if (!summary) return 0;
    return stage === 'to_prepare'
      ? summary.toPrepare
      : stage === 'to_review'
        ? summary.toReview
        : stage === 'to_deliver'
          ? summary.toDeliver
          : summary.delivered;
  }
  percentage(stage: PreflightDeskStage): number {
    return this.summary()?.total
      ? Math.round((this.count(stage) / this.summary()!.total) * 100)
      : 0;
  }
  proportion(stage: PreflightDeskStage): number {
    return this.summary()?.total
      ? (this.count(stage) / this.summary()!.total) * 100
      : 0;
  }
  deliveredPercentage(order: PreflightDeskOrder): number {
    return order.total ? Math.round((order.delivered / order.total) * 100) : 0;
  }
  icon(stage: PreflightDeskStage): AdminIconName {
    return stage === 'to_prepare'
      ? 'publications'
      : stage === 'to_review'
        ? 'search'
        : stage === 'to_deliver'
          ? 'arrow'
          : 'check';
  }
  channelKey(channel: string): string {
    return `admin.preflightDesk.channels.${['website', 'facebook', 'linkedin'].includes(channel) ? channel : 'other'}`;
  }

  blockerLabel(code: string): string {
    const family = /^(?:payment_|refund_)/.test(code)
      ? 'payment'
      : /consent/.test(code)
        ? 'consent'
        : /review|moderation/.test(code)
          ? 'review'
          : /media|presentation/.test(code)
            ? 'media'
            : /draft/.test(code)
              ? 'draft'
              : /offer|commitment_needs_confirmation/.test(code)
                ? 'agreement'
                : /fulfilment|evidence/.test(code)
                  ? 'proof'
                  : code === 'company_missing'
                    ? 'identity'
                    : /publication_|obligation_/.test(code)
                      ? 'execution'
                      : 'unknown';
    return 'admin.preflightDesk.blockerLabels.' + family;
  }
  formatDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }
  money(minor: string, currency: string): string {
    try {
      const value = BigInt(minor),
        absolute = value < 0n ? -value : value;
      const integer = new Intl.NumberFormat(this.i18n.currentLanguage()).format(
        absolute / 100n
      );
      const fraction = (absolute % 100n).toString().padStart(2, '0');
      return new Intl.NumberFormat(this.i18n.currentLanguage(), {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
        .formatToParts(value < 0n ? -0 : 0)
        .map((part) =>
          part.type === 'integer'
            ? integer
            : part.type === 'fraction'
              ? fraction
              : part.value
        )
        .join('');
    } catch {
      return '—';
    }
  }

  ownerRoute(value: string): UrlTree | null {
    const safe = automaticAdminUrl(value);
    return safe ? this.router.parseUrl(safe) : null;
  }

  proofUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  private navigate(params: Record<string, string | null>): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge'
    });
  }
  private current(
    serial: number,
    session: number,
    controller: AbortController
  ): boolean {
    return (
      !this.disposed &&
      serial === this.requestSerial &&
      session === this.admin.sessionGeneration() &&
      !controller.signal.aborted
    );
  }
  private invalidate(): void {
    this.requestSerial++;
    this.request?.abort();
    this.request = undefined;
  }
  private signIn(): void {
    this.invalidate();
    this.response.set(null);
    this.selection.set(null);
    void this.router.navigate(['/admin/login'], {
      queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
    });
  }
}
