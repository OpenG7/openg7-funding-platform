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
  signal,
  untracked,
  viewChild,
  viewChildren
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PreflightInboxProposal,
  PreflightInboxResponse,
  AdminSponsorshipProgress
} from '@openg7/funding-core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminPreflightRehearsalComponent } from '../../components/admin-preflight-rehearsal/admin-preflight-rehearsal.component.js';
import { AdminPreflightDeskComponent } from '../../components/admin-preflight-desk/admin-preflight-desk.component.js';
import { AdminPreflightExaminationComponent } from '../../components/admin-preflight-examination/admin-preflight-examination.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../../components/admin-ui/admin-icon.component.js';
import { registerAdminPreflightTranslations } from '../../services/admin-preflight-translations.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { PreflightInboxRequestError } from '../../services/funding-admin-preflight-inbox.client.js';
import { AdminPreflightWorkSessionCoordinator } from '../../services/admin-preflight-work-session-coordinator.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { AdminPublicationWorkshopComponent } from '../../components/admin-sponsors/admin-publication-workshop.component.js';
import { AdminSponsorshipPreparationComponent } from '../../components/admin-sponsors/admin-sponsorship-preparation.component.js';
import { publicationReturnId } from '../../components/admin-sponsors/publication-monitor-navigation.js';

@Component({
  selector: 'openg7-admin-preflight-page',
  standalone: true,
  providers: [AdminPreflightWorkSessionCoordinator],
  imports: [
    TranslatePipe,
    RouterLink,
    AdminLayoutComponent,
    AdminPreflightRehearsalComponent,
    AdminPreflightDeskComponent,
    AdminPreflightExaminationComponent,
    AdminIconComponent,
    AdminPublicationWorkshopComponent,
    AdminSponsorshipPreparationComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-preflight-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-preflight-page.component.css'
  ]
})
export class AdminPreflightPageComponent implements OnInit {
  readonly work = inject(AdminPreflightWorkSessionCoordinator);
  private readonly examination = viewChild(AdminPreflightExaminationComponent);
  private workRouteKey = '';
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly routeParams = toSignal(this.route.queryParamMap);
  private readonly routeFragment = toSignal(this.route.fragment);
  private readonly publicationPreparation = viewChild<
    AdminSponsorshipPreparationComponent,
    ElementRef<HTMLElement>
  >('publicationPreparation', { read: ElementRef });
  private focusedPublicationAnchor = '';
  readonly workshopSelection = computed(() =>
    this.routeParams()?.get('view') === 'publication'
      ? publicationReturnId(this.routeParams()?.get('workshopSponsorshipId'))
      : null
  );
  readonly workshopDossier = signal<AdminSponsorshipProgress | null>(null);
  readonly workshopState = signal<
    'loading' | 'ready' | 'unavailable' | 'forbidden' | 'not_found'
  >('loading');
  private workshopSerial = 0;
  private workshopContext = '';
  readonly examinationSelection = computed(() => {
    const params = this.routeParams();
    return params?.has('sponsorshipId') || params?.has('obligationId')
      ? {
          contributionId: params?.get('sponsorshipId') ?? '',
          obligationId: params?.get('obligationId') ?? ''
        }
      : null;
  });
  readonly workspaceViews = [
    'desk',
    'rehearsal',
    'proposals',
    'evidence'
  ] as const;
  readonly activeView = computed(() => {
    const view = this.routeParams()?.get('view');
    return this.workspaceViews.find((item) => item === view) ?? 'desk';
  });
  private readonly tabButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('workspaceTab');
  private readonly proposalDialog =
    viewChild<ElementRef<HTMLDialogElement>>('proposalDialog');
  readonly selectedProposal = signal<PreflightInboxProposal | null>(null);
  readonly inboxCheckedAt = signal<string | null>(null);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly previousButton =
    viewChild<ElementRef<HTMLButtonElement>>('previousButton');
  private readonly nextButton =
    viewChild<ElementRef<HTMLButtonElement>>('nextButton');
  readonly i18n = inject(FundingI18nService);
  readonly state = signal<
    'loading' | 'ready' | 'disabled' | 'unavailable' | 'forbidden'
  >('loading');
  readonly response = signal<PreflightInboxResponse | null>(null);
  readonly consoleUrl = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil((this.response()?.total ?? 0) / 20))
  );
  private requestId = 0;
  private disposed = false;
  private activeRequest?: AbortController;
  private sessionGeneration = this.admin.sessionGeneration();

  constructor() {
    registerAdminPreflightTranslations();
    effect(() => {
      const id = this.workshopSelection();
      const context = this.publicationOwnerContext();
      const revision = this.admin.dataRevision();
      untracked(() => {
        void revision;
        const changed = context !== this.workshopContext;
        if (changed) {
          this.workshopContext = context;
          ++this.workshopSerial;
          this.workshopDossier.set(null);
        }
        // Keep the native receipt mounted during its own versioned refresh so
        // its approval focus restoration and pending-operation guards survive.
        if (id && this.browser && this.admin.hasValidAdminSession())
          void this.loadPublicationOwner(!changed);
      });
    });
    effect(() => {
      const id = this.routeParams()?.get('workSession') ?? '';
      const identity = this.work.identityKey();
      const key = `${identity}:${id}`;
      untracked(() => {
        if (!this.browser || this.workRouteKey === key) return;
        this.workRouteKey = key;
        if (id && !/^[0-9a-f-]{36}$/i.test(id)) return;
        if (!id || this.work.current()?.id !== id)
          void this.work.load(id || undefined);
      });
    });
    effect((onCleanup) => {
      const fragment = this.routeFragment();
      const target = this.publicationPreparation();
      const dossier = this.workshopDossier();
      const context = this.publicationOwnerContext();
      if (fragment !== 'dossier-preparation') {
        this.focusedPublicationAnchor = '';
        return;
      }
      if (
        !this.browser ||
        !target ||
        dossier?.contributionId !== this.workshopSelection() ||
        context === this.focusedPublicationAnchor
      )
        return;
      let current = true;
      onCleanup(() => (current = false));
      afterNextRender(
        () => {
          if (
            !current ||
            this.disposed ||
            !this.admin.hasValidAdminSession() ||
            context !== this.publicationOwnerContext() ||
            this.routeFragment() !== 'dossier-preparation' ||
            !target.nativeElement.isConnected
          )
            return;
          this.focusedPublicationAnchor = context;
          target.nativeElement.focus();
        },
        { injector: this.injector }
      );
    });
    effect(() => {
      const generation = this.admin.sessionGeneration();
      untracked(() => {
        if (generation === this.sessionGeneration) return;
        this.sessionGeneration = generation;
        this.cancelRequest();
        this.response.set(null);
        this.closeProposal();
        this.inboxCheckedAt.set(null);
        this.consoleUrl.set(null);
        if (!this.admin.hasValidAdminSession()) this.signIn();
        else void this.load(1);
      });
    });
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      ++this.workshopSerial;
      this.cancelRequest();
    });
  }

  ngOnInit(): void {
    if (this.browser) void this.load(1);
  }
  async loadPublicationOwner(preserve = false): Promise<void> {
    const contributionId = this.workshopSelection();
    if (!this.browser || !contributionId || !this.admin.hasValidAdminSession())
      return;
    const serial = ++this.workshopSerial;
    const generation = this.admin.sessionGeneration();
    const context = this.publicationOwnerContext();
    if (!preserve) this.workshopDossier.set(null);
    this.workshopState.set('loading');
    try {
      const result = await this.admin.getSponsorshipProgress(
        this.admin.getSavedAdminToken(),
        contributionId
      );
      if (
        this.disposed ||
        serial !== this.workshopSerial ||
        generation !== this.admin.sessionGeneration() ||
        context !== this.publicationOwnerContext() ||
        contributionId !== this.workshopSelection()
      )
        return;
      if (
        result.status !== 'ok' ||
        result.dossier?.contributionId !== contributionId
      ) {
        this.workshopDossier.set(null);
        this.workshopState.set(
          result.status === 'not_found' || result.status === 'empty'
            ? 'not_found'
            : 'unavailable'
        );
        return;
      }
      this.workshopDossier.set(result.dossier);
      this.workshopState.set('ready');
    } catch (error) {
      if (
        this.disposed ||
        serial !== this.workshopSerial ||
        generation !== this.admin.sessionGeneration() ||
        context !== this.publicationOwnerContext()
      )
        return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401) {
        this.workshopDossier.set(null);
        this.signIn();
        return;
      }
      if (status === 403 || status === 404) this.workshopDossier.set(null);
      this.workshopState.set(
        status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : 'unavailable'
      );
    }
  }
  private publicationOwnerContext(): string {
    const identity = this.admin.identity();
    return `${this.workshopSelection() ?? ''}:${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }
  canLeave(): boolean | Promise<boolean> {
    return this.examination()?.canLeave() ?? true;
  }
  async resumeWorkSession(id: string): Promise<void> {
    const identity = this.work.identityKey();
    if (this.work.busy() || !(await this.work.load(id))) return;
    const initial = this.work.current();
    if (!initial || !(await this.work.command('resume'))) return;
    const session = this.work.current()!;
    if (identity !== this.work.identityKey() || !session) return;
    const item =
      session.items.find((item) => item.position === session.lastPosition) ??
      session.items[0];
    if (!item) return;
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: 'desk',
        workSession: session.id,
        sponsorshipId: item.contributionId,
        obligationId: item.obligationId,
        preparationVersion: null,
        deskStatus:
          session.filters.deskStatus === 'all'
            ? null
            : (session.filters.deskStatus ?? null),
        deskSearch: session.filters.deskSearch ?? null,
        deskPage: session.filters.deskPage ?? null
      },
      queryParamsHandling: 'merge'
    });
  }

  async load(page = this.page()): Promise<void> {
    if (!this.browser || this.disposed) return;
    this.cancelRequest();
    const id = this.requestId;
    const sessionGeneration = this.admin.sessionGeneration();
    const request = new AbortController();
    this.activeRequest = request;
    this.response.set(null);
    this.state.set('loading');
    try {
      const result = await this.admin.preflightInbox.read(page, request.signal);
      if (
        id !== this.requestId ||
        this.disposed ||
        sessionGeneration !== this.admin.sessionGeneration()
      )
        return;
      this.response.set(result);
      this.inboxCheckedAt.set(new Date().toISOString());
      this.page.set(result.page);
      this.consoleUrl.set(this.safeConsoleUrl(result.consoleUrl));
      this.state.set(result.state);
    } catch (error) {
      if (
        this.disposed ||
        id !== this.requestId ||
        request.signal.aborted ||
        sessionGeneration !== this.admin.sessionGeneration()
      )
        return;
      if (error instanceof PreflightInboxRequestError && error.status === 401) {
        this.signIn();
        return;
      }
      this.consoleUrl.set(
        error instanceof PreflightInboxRequestError
          ? this.safeConsoleUrl(error.consoleUrl)
          : null
      );
      this.state.set(
        error instanceof PreflightInboxRequestError && error.status === 403
          ? 'forbidden'
          : 'unavailable'
      );
    }
  }

  proposalTitle(proposal: PreflightInboxProposal): string {
    return proposal.type === 'human_arbitration'
      ? 'admin.preflight.arbitration'
      : 'admin.preflight.proposal';
  }

  viewIcon(view: string): AdminIconName {
    return view === 'desk'
      ? 'invoices'
      : view === 'rehearsal'
        ? 'settings'
        : view === 'proposals'
          ? 'transparency'
          : 'clock';
  }

  selectView(view: (typeof this.workspaceViews)[number]): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view },
      queryParamsHandling: 'merge'
    });
  }

  tabKey(
    event: KeyboardEvent,
    view: (typeof this.workspaceViews)[number]
  ): void {
    const index = this.workspaceViews.indexOf(view);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 3
          : event.key === 'ArrowRight'
            ? (index + 1) % 4
            : event.key === 'ArrowLeft'
              ? (index + 3) % 4
              : null;
    if (next === null) return;
    event.preventDefault();
    this.selectView(this.workspaceViews[next]!);
    this.tabButtons()[next]?.nativeElement.focus();
  }

  examineProposal(proposal: PreflightInboxProposal): void {
    if (!this.browser) return;
    this.selectedProposal.set(proposal);
    this.proposalDialog()?.nativeElement.showModal();
  }

  closeProposal(): void {
    if (this.browser) this.proposalDialog()?.nativeElement.close();
    this.selectedProposal.set(null);
  }

  async changePage(
    page: number,
    direction: 'previous' | 'next'
  ): Promise<void> {
    await this.load(page);
    if (this.disposed || this.state() !== 'ready') return;
    afterNextRender(
      () => {
        const preferred = (
          direction === 'next' ? this.nextButton() : this.previousButton()
        )?.nativeElement;
        const fallback = (
          direction === 'next' ? this.previousButton() : this.nextButton()
        )?.nativeElement;
        if (preferred && !preferred.disabled) preferred.focus();
        else if (fallback && !fallback.disabled) fallback.focus();
      },
      { injector: this.injector }
    );
  }

  riskKey(risk: string): string {
    return `admin.preflight.risk.${['normal', 'exception', 'low', 'medium', 'high', 'critical'].includes(risk) ? risk : 'unknown'}`;
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private signIn(): void {
    this.response.set(null);
    this.consoleUrl.set(null);
    void this.router.navigate(['/admin/login'], {
      queryParams: {
        returnUrl: this.router.url,
        sessionExpired: '1'
      }
    });
  }

  private cancelRequest(): void {
    this.requestId++;
    this.activeRequest?.abort();
    this.activeRequest = undefined;
  }

  private safeConsoleUrl(value: string | null): string | null {
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
}
