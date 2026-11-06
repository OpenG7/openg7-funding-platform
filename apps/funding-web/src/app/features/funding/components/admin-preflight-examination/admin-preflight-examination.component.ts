import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
  RouterLink,
  type UrlTree
} from '@angular/router';
import type {
  AdminPreparationCheck,
  AdminPreflightWorkSessionCheckpoint,
  AdminPreflightWorkSessionFilters,
  AdminServicePreparationDecisionRequest,
  AdminServicePreparationSaveDraftRequest,
  AdminServicePreparationDecisionKind,
  AdminServicePreparationReceipt
} from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-preflight-examination.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-preflight-examination.fr-CA.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminPreflightWorkSessionCoordinator } from '../../services/admin-preflight-work-session-coordinator.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

import { PreflightServicePreviewComponent } from './preflight-service-preview.component.js';

type Section = 'preview' | 'text' | 'media' | 'checks' | 'details' | 'history';
type Viewport = 'desktop' | 'tablet' | 'mobile';
type State =
  'loading' | 'ready' | 'unavailable' | 'forbidden' | 'not_found' | 'expired';
type ApprovalGuidance =
  | 'readonly'
  | 'busy'
  | 'unavailable'
  | 'uncertain'
  | 'session-inactive'
  | 'stale'
  | 'dirty'
  | 'buffer-readonly'
  | 'recorded'
  | 'missing-draft'
  | 'incomplete'
  | 'closed';

/** One exact promised passage, reviewed through Funding's existing preparation owner. */
@Component({
  selector: 'openg7-admin-preflight-examination',
  standalone: true,
  imports: [RouterLink, AdminIconComponent, PreflightServicePreviewComponent],
  templateUrl: './admin-preflight-examination.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-preflight-examination.component.css',
    './admin-preflight-work-session.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPreflightExaminationComponent {
  readonly contributionId = input.required<string>();
  readonly obligationId = input.required<string>();
  readonly admin = inject(FundingAdminService);
  readonly work = inject(AdminPreflightWorkSessionCoordinator);
  readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly injector = inject(Injector);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly reasonInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');
  private readonly enlargedDialog =
    viewChild<ElementRef<HTMLDialogElement>>('enlargedDialog');
  private readonly enlargeButton =
    viewChild<ElementRef<HTMLButtonElement>>('enlargeButton');
  readonly state = signal<State>('loading');
  readonly receipt = signal<AdminServicePreparationReceipt | null>(null);
  readonly section = signal<Section>('preview');
  readonly viewport = signal<Viewport>('desktop');
  readonly enlarged = signal(false);
  readonly sections: readonly Section[] = [
    'preview',
    'text',
    'media',
    'checks',
    'details',
    'history'
  ];
  readonly viewports: readonly Viewport[] = ['desktop', 'tablet', 'mobile'];
  readonly pendingDecision = signal<AdminServicePreparationDecisionKind | null>(
    null
  );
  readonly reason = signal('');
  readonly reasonInvalid = signal(false);
  readonly busy = signal(false);
  readonly mediaBusy = signal(false);
  readonly stale = signal(false);
  readonly message = signal<string | null>(null);
  readonly success = signal(false);
  readonly workNotice = signal<string | null>(null);
  readonly sourceChanged = signal(false);
  readonly decisionUncertain = signal(false);
  readonly decisionReconciled = signal(false);
  readonly draftUncertain = signal(false);
  readonly draftSourceConflict = signal(false);
  readonly draftTitle = signal('');
  readonly draftBody = signal('');
  readonly draftDisclosure = signal('');
  readonly savedReason = signal('');
  readonly savedPending = signal<AdminServicePreparationDecisionKind | null>(
    null
  );
  readonly draftDirty = computed(() => {
    const draft = this.receipt()?.draft;
    return (
      draft?.kind === 'publication' &&
      (this.draftTitle() !== draft.title ||
        this.draftBody() !== draft.body ||
        this.draftDisclosure() !== draft.disclosureText)
    );
  });
  readonly localDirty = computed(
    () =>
      this.draftDirty() ||
      this.reason() !== this.savedReason() ||
      this.pendingDecision() !== this.savedPending()
  );
  readonly continuationBlocked = computed(
    () =>
      this.busy() ||
      this.mediaBusy() ||
      this.work.busy() ||
      this.work.unresolved() ||
      this.work.error() === 'conflict' ||
      this.decisionUncertain() ||
      this.draftUncertain()
  );
  readonly socialEditable = computed(
    () =>
      this.receipt()?.draft?.kind === 'publication' &&
      !this.readOnly() &&
      ['draft', 'pending_review'].includes(
        this.receipt()?.draft?.status ?? ''
      ) &&
      !['fulfilled', 'adjusted'].includes(
        this.receipt()?.service.obligationState ?? ''
      )
  );
  readonly finishDialog =
    viewChild<ElementRef<HTMLDialogElement>>('finishDialog');
  readonly leaveDialog =
    viewChild<ElementRef<HTMLDialogElement>>('leaveDialog');
  readonly leavePending = signal(false);
  private leaveResolve: ((accepted: boolean) => void) | null = null;
  private departureAccepted = false;
  private restoredCheckpoint = '';
  private decisionIntent: AdminServicePreparationDecisionRequest | null = null;
  private pendingDraft: AdminServicePreparationSaveDraftRequest | null = null;
  private draftAcknowledged = false;
  private readonly urlNormalizations = new Set<{
    url: string;
    selection: string;
    navigationId: number | null;
  }>();
  readonly versionMismatch = computed(() => {
    const expected = this.params()?.get('preparationVersion');
    return (
      !!expected && !!this.receipt() && expected !== this.receipt()!.version
    );
  });
  readonly readOnly = computed(() => this.admin.identity()?.role === 'reader');
  readonly canDecide = computed(
    () =>
      this.state() === 'ready' &&
      this.receipt()?.canDecide === true &&
      !this.readOnly() &&
      !this.busy() &&
      !this.mediaBusy() &&
      !this.work.busy() &&
      !this.work.unresolved() &&
      (!this.work.current() || this.work.current()?.status === 'active') &&
      !this.decisionUncertain() &&
      !this.draftUncertain() &&
      !this.draftDirty() &&
      !this.stale() &&
      !this.versionMismatch()
  );
  readonly canApprove = computed(
    () => this.canDecide() && this.receipt()?.canApprove === true
  );
  /** Explains the existing guards; it never grants or changes permission to approve. */
  readonly approvalReason = computed<ApprovalGuidance | null>(() => {
    if (this.canApprove()) return null;
    if (this.readOnly()) return 'readonly';
    if (
      this.busy() ||
      this.mediaBusy() ||
      this.work.busy() ||
      this.state() === 'loading'
    )
      return 'busy';
    if (this.state() !== 'ready') return 'unavailable';
    if (
      this.work.unresolved() ||
      this.decisionUncertain() ||
      this.draftUncertain()
    )
      return 'uncertain';
    if (this.work.current() && this.work.current()?.status !== 'active')
      return 'session-inactive';
    if (
      this.stale() ||
      this.versionMismatch() ||
      this.draftSourceConflict() ||
      this.work.error() === 'conflict'
    )
      return 'stale';
    if (this.draftDirty())
      return this.socialEditable() ? 'dirty' : 'buffer-readonly';
    const receipt = this.receipt();
    if (receipt?.decision) return 'recorded';
    if (!receipt?.draft) return 'missing-draft';
    if (receipt.blockers.includes('service_closed')) return 'closed';
    if (receipt.blockers.length) return 'incomplete';
    return receipt.canDecide ? 'incomplete' : 'closed';
  });
  readonly needsPublicationDraft = computed(
    () =>
      this.receipt()?.service.channel !== 'website' &&
      (this.receipt()?.blockers.includes('service_draft_missing') ?? false)
  );
  readonly needsSponsorProfile = computed(() =>
    this.receipt()?.blockers.some((code) =>
      [
        'company_missing',
        'presentation_missing',
        'public_consent_missing'
      ].includes(code)
    )
  );
  readonly dossierCompletionLink = computed(() => {
    const raw = this.receipt()?.links.dossier ?? null;
    const link = this.ownerLink(raw);
    if (link && raw?.split(/[?#]/, 1)[0] === '/admin/fundraiser/sponsors')
      link.queryParams = { ...link.queryParams, tab: 'identity' };
    return link;
  });
  readonly confirmedCount = computed(
    () =>
      this.receipt()?.checks.filter((check) => check.state === 'complete')
        .length ?? 0
  );
  readonly interventionCount = computed(
    () =>
      (this.receipt()?.checks.filter((check) => check.state === 'missing')
        .length ?? 0) + (this.receipt()?.canDecide ? 1 : 0)
  );
  readonly navigation = computed(() => {
    const receipt = this.receipt();
    const session = this.work.current();
    const recorded = session?.items.find(
      (item) =>
        item.contributionId === receipt?.contributionId &&
        item.obligationId === this.obligationId()
    );
    const stage = this.filters().deskStatus ?? 'all';
    const items =
      session?.status === 'active' && recorded
        ? session.items.filter(
            (item) =>
              item.contributionId === receipt?.contributionId &&
              (stage === 'all' || item.currentStatus === stage)
          )
        : (receipt?.siblings ?? []).map((service, index) => ({
            contributionId: service.contributionId,
            obligationId: service.id,
            position: index + 1
          }));
    const sourcePosition =
      session?.status === 'active' && recorded
        ? recorded.position
        : (receipt?.siblings.findIndex(
            (service) => service.id === this.obligationId()
          ) ?? -1) + 1;
    const ordered = [...items].sort(
      (left, right) => left.position - right.position
    );
    return {
      position:
        ordered.findIndex((item) => item.obligationId === this.obligationId()) +
        1,
      total: ordered.length,
      previous: ordered.filter((item) => item.position < sourcePosition).at(-1),
      next: ordered.find((item) => item.position > sourcePosition)
    };
  });
  readonly position = computed(() => this.navigation().position);
  private serial = 0;
  private disposed = false;
  private request?: AbortController;
  private selectionKey = '';
  private decisionSerial = 0;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        for (const normalization of this.urlNormalizations) {
          if (
            normalization.selection === this.selectionKey &&
            normalization.url === event.url
          )
            normalization.navigationId = event.id;
        }
      }
      const normalizationEvent =
        'id' in event &&
        [...this.urlNormalizations].some(
          (normalization) =>
            normalization.selection === this.selectionKey &&
            (normalization.navigationId === event.id ||
              (event instanceof NavigationSkipped &&
                normalization.url === event.url))
        );
      if (
        !normalizationEvent &&
        (event instanceof NavigationCancel ||
          event instanceof NavigationError ||
          event instanceof NavigationSkipped)
      )
        this.cancelDeparture();
      if (event instanceof NavigationEnd && !normalizationEvent)
        this.departureAccepted = false;
    });
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { preflightExamination: language === 'en' ? en : fr }
        })
      );
    });
    effect(() => {
      const contribution = this.contributionId(),
        obligation = this.obligationId(),
        session = this.work.identityKey();
      untracked(() => {
        const key = `${session}:${contribution}:${obligation}`;
        if (!this.browser || key === this.selectionKey) return;
        this.selectionKey = key;
        ++this.decisionSerial;
        this.busy.set(false);
        this.mediaBusy.set(false);
        this.receipt.set(null);
        this.section.set('preview');
        this.viewport.set('desktop');
        this.pendingDecision.set(null);
        this.reason.set('');
        this.reasonInvalid.set(false);
        this.message.set(null);
        this.success.set(false);
        this.workNotice.set(null);
        this.sourceChanged.set(false);
        this.decisionUncertain.set(false);
        this.decisionReconciled.set(false);
        this.draftUncertain.set(false);
        this.draftSourceConflict.set(false);
        this.decisionIntent = null;
        this.pendingDraft = null;
        this.draftTitle.set('');
        this.draftBody.set('');
        this.draftDisclosure.set('');
        this.draftAcknowledged = false;
        this.restoredCheckpoint = '';
        this.savedReason.set('');
        this.savedPending.set(null);
        this.departureAccepted = false;
        this.urlNormalizations.clear();
        this.answerLeave(false);
        this.closeEnlarged();
        void this.load(false, false, true);
      });
    });
    effect((cleanup) => {
      const unsafe =
        this.localDirty() ||
        this.busy() ||
        this.work.busy() ||
        this.decisionUncertain() ||
        this.draftUncertain();
      if (!this.browser || !unsafe) return;
      const view = this.host.nativeElement.ownerDocument.defaultView;
      const preventLoss = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      view?.addEventListener('beforeunload', preventLoss);
      cleanup(() => view?.removeEventListener('beforeunload', preventLoss));
    });
    effect(() => {
      const receipt = this.receipt();
      this.work.current();
      if (receipt) untracked(() => void this.restoreCheckpoint(receipt));
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      ++this.serial;
      ++this.decisionSerial;
      this.request?.abort();
      this.enlargedDialog()?.nativeElement.close();
      this.finishDialog()?.nativeElement.close();
      this.leaveDialog()?.nativeElement.close();
      this.answerLeave(false);
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t(`admin.preflightExamination.${key}`, params);
  }
  channel(service = this.receipt()?.service): string {
    return this.t(`channels.${service?.channel ?? 'website'}`);
  }
  icon(section: Section): AdminIconName {
    return (
      {
        preview: 'dashboard',
        text: 'publications',
        media: 'transparency',
        checks: 'audit',
        details: 'invoices',
        history: 'clock'
      } as const
    )[section];
  }
  formatDate(value: string | null | undefined): string {
    if (!value || !Number.isFinite(Date.parse(value)))
      return this.t('notAvailable');
    return new Intl.DateTimeFormat(
      this.i18n.currentLanguage() === 'en' ? 'en-CA' : 'fr-CA',
      { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }
    ).format(new Date(value));
  }
  checkLabel(check: AdminPreparationCheck): string {
    const known = [
      'payment_confirmed',
      'accepted_offer',
      'company',
      'consent',
      'consent_public',
      'website',
      'website_content',
      'publication_draft',
      'media',
      'publication_content',
      'source',
      'draft',
      'agreement',
      'content',
      'media_rights',
      'editorial_review',
      'public_consent',
      'sponsor_review',
      'moderation_review',
      'service_draft_identified',
      'draft_moderation_review'
    ];
    return this.t(
      `checks.${known.includes(check.code) ? check.code : 'other'}`
    );
  }
  checkState(check: AdminPreparationCheck): string {
    return this.t(`checkStates.${check.state}`);
  }
  blockerLabel(code: string): string {
    if (
      [
        'public_consent_missing',
        'sponsor_review_required',
        'moderation_review_required',
        'company_missing',
        'presentation_missing',
        'required_media_missing',
        'prepared_media_stale',
        'prepared_media_unavailable',
        'service_draft_missing',
        'obligation_blocked',
        'service_closed'
      ].includes(code)
    )
      return this.t('blockerReasons.' + code);
    const family = /payment|refund/.test(code)
      ? 'payment'
      : /consent/.test(code)
        ? 'consent'
        : /media|image|logo/.test(code)
          ? 'media'
          : /draft|content|preparation/.test(code)
            ? 'content'
            : /offer|commitment|agreement/.test(code)
              ? 'agreement'
              : /review|moderation/.test(code)
                ? 'review'
                : 'other';
    return this.t(`blockers.${family}`);
  }
  ownerUrl(url: string | null | undefined): string | null {
    return url &&
      /^\/admin\/fundraiser\/(?:sponsors|campaigns|publications)(?:[/?]|$)/.test(
        url
      ) &&
      !/[\\\x00-\x20]/.test(url)
      ? url
      : null;
  }
  ownerLink(raw: string | null): UrlTree | null {
    const owner = this.ownerUrl(raw);
    return owner ? this.router.parseUrl(owner) : null;
  }

  async load(
    acceptVersion = false,
    preserveMessage = false,
    focus = false
  ): Promise<void> {
    if (!this.browser || this.disposed || this.busy()) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const ticket = ++this.serial,
      key = this.selectionKey;
    this.state.set('loading');
    this.success.set(false);
    if (!preserveMessage) this.message.set(null);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(this.contributionId()) || !uuid.test(this.obligationId())) {
      this.receipt.set(null);
      this.state.set('not_found');
      return;
    }
    if (!this.admin.hasValidAdminSession()) {
      this.receipt.set(null);
      this.state.set('expired');
      return;
    }
    try {
      const receipt = await this.admin.preflightExamination.read(
        this.contributionId(),
        this.obligationId(),
        request.signal
      );
      if (!this.current(ticket, key)) return;
      const keepEditor = this.draftDirty();
      this.receipt.set(receipt);
      this.applyDraftReceipt(receipt, !keepEditor);
      await this.restoreCheckpoint(receipt);
      if (!this.current(ticket, key)) return;
      this.state.set('ready');
      this.stale.set(
        this.decisionUncertain() ||
          this.draftUncertain() ||
          this.draftSourceConflict()
      );
      if (
        !this.draftSourceConflict() &&
        (acceptVersion || !this.params()?.get('preparationVersion'))
      )
        await this.recordVersion(receipt.version);
      if (focus)
        afterNextRender(
          () => this.title()?.nativeElement.focus({ preventScroll: true }),
          { injector: this.injector }
        );
    } catch (error) {
      if (!this.current(ticket, key) || request.signal.aborted) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404)
        this.receipt.set(null);
      this.state.set(
        status === 401
          ? 'expired'
          : status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : 'unavailable'
      );
      this.stale.set(this.receipt() !== null);
    }
  }

  selectSection(section: Section): void {
    if (this.mediaBusy()) return;
    this.section.set(section);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('#examination-content-title')
          ?.focus(),
      { injector: this.injector }
    );
  }
  startDecision(kind: AdminServicePreparationDecisionKind): void {
    if (!this.canDecide() || (kind === 'approved' && !this.canApprove()))
      return;
    if (kind === 'approved') {
      void this.decide(kind);
      return;
    }
    this.pendingDecision.set(kind);
    this.reasonInvalid.set(false);
    afterNextRender(() => this.reasonInput()?.nativeElement.focus(), {
      injector: this.injector
    });
  }
  async submitReason(event: Event): Promise<void> {
    event.preventDefault();
    const kind = this.pendingDecision();
    if (!kind || !this.canDecide()) return;
    if (
      this.reason().trim().length < 10 ||
      this.reason().trim().length > 2000
    ) {
      this.reasonInvalid.set(true);
      this.reasonInput()?.nativeElement.focus();
      return;
    }
    await this.decide(kind);
  }
  setReason(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
    this.reasonInvalid.set(false);
  }
  cancelReason(): void {
    this.pendingDecision.set(null);
    this.reason.set('');
    this.reasonInvalid.set(false);
  }

  private async decide(
    kind: AdminServicePreparationDecisionKind,
    retry = false
  ): Promise<void> {
    const receipt = this.receipt();
    if (
      !receipt ||
      (!retry &&
        (!this.canDecide() || (kind === 'approved' && !this.canApprove()))) ||
      (retry &&
        (!this.decisionIntent ||
          this.busy() ||
          this.work.busy() ||
          this.work.unresolved() ||
          this.readOnly()))
    )
      return;
    const ticket = ++this.decisionSerial,
      key = this.selectionKey;
    const reason = this.reason().trim();
    this.busy.set(true);
    this.message.set(null);
    this.success.set(false);
    const accepted = await this.confirmation.confirm(
      this.t(`confirm.${kind}`, {
        reference: receipt.reference,
        channel: this.channel(),
        version: receipt.version.slice(0, 8)
      }),
      receipt.reference
    );
    if (
      !accepted ||
      this.disposed ||
      !this.sameSelection(key) ||
      ticket !== this.decisionSerial ||
      this.receipt() !== receipt ||
      this.versionMismatch()
    ) {
      if (ticket === this.decisionSerial) this.busy.set(false);
      return;
    }
    try {
      const intent: AdminServicePreparationDecisionRequest = retry
        ? this.decisionIntent!
        : {
            contributionId: receipt.contributionId,
            obligationId: receipt.service.id,
            expectedVersion: receipt.version,
            requestId: crypto.randomUUID(),
            confirmed: true,
            decision: kind,
            ...(kind === 'approved' ? {} : { reason })
          };
      this.decisionIntent = intent;
      this.decisionReconciled.set(false);
      if (
        !(await this.ensureSession(receipt)) ||
        !this.sameSelection(key) ||
        ticket !== this.decisionSerial
      )
        return;
      if (
        !retry &&
        !(await this.persistCheckpoint('checkpoint', receipt, {
          pendingDecision: kind,
          reason,
          decisionRequestId: intent.requestId,
          expectedPreparationVersion: intent.expectedVersion,
          view: this.section()
        }))
      )
        return;
      if (
        this.disposed ||
        !this.sameSelection(key) ||
        ticket !== this.decisionSerial
      )
        return;
      this.decisionUncertain.set(true);
      const result = await this.admin.preflightExamination.decide(intent);
      if (
        this.disposed ||
        !this.sameSelection(key) ||
        ticket !== this.decisionSerial
      )
        return;
      ++this.serial;
      this.request?.abort();
      this.receipt.set(result);
      this.decisionIntent = null;
      this.decisionUncertain.set(false);
      this.state.set('ready');
      this.stale.set(false);
      this.pendingDecision.set(null);
      this.reason.set('');
      this.message.set(`decided.${kind}`);
      this.success.set(true);
      this.workNotice.set('decisionConfirmed');
      await this.persistCheckpoint('checkpoint', result, {
        pendingDecision: null,
        reason: '',
        view: this.section()
      });
      await this.recordVersion(result.version);
    } catch (error) {
      if (
        this.disposed ||
        !this.sameSelection(key) ||
        ticket !== this.decisionSerial
      )
        return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.message.set(
        status === 409
          ? 'errors.conflict'
          : status === 401
            ? 'errors.expired'
            : status === 403
              ? 'errors.forbidden'
              : 'errors.uncertain'
      );
      this.stale.set(true);
      this.decisionUncertain.set(
        status !== 409 && status !== 401 && status !== 403
      );
      if (!this.decisionUncertain()) {
        this.decisionIntent = null;
        if (status === 409)
          await this.persistCheckpoint('checkpoint', receipt, {
            pendingDecision: this.pendingDecision(),
            reason: this.reason(),
            view: this.section()
          });
      }
      if (status === 401 || status === 403) {
        this.receipt.set(null);
        this.state.set(status === 401 ? 'expired' : 'forbidden');
      }
      // An uncertain write is reconciled by a human-triggered GET; never replayed automatically.
    } finally {
      if (ticket === this.decisionSerial) this.busy.set(false);
    }
  }
  async back(): Promise<void> {
    if (this.continuationBlocked() || !(await this.canLeave())) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: 'desk',
        sponsorshipId: null,
        obligationId: null,
        preparationVersion: null,
        reviewReturn: this.obligationId()
      },
      queryParamsHandling: 'merge'
    });
  }
  async next(offset: number, defer = false): Promise<void> {
    if (this.continuationBlocked() || !(await this.canLeave())) return;
    const receipt = this.receipt();
    if (!receipt) return;
    if (!this.readOnly() && this.work.current()?.status === 'active') {
      if (!(await this.ensureSession(receipt))) {
        this.departureAccepted = false;
        return;
      }
      if (
        !(await this.persistCheckpoint(defer ? 'defer' : 'checkpoint', receipt))
      ) {
        this.departureAccepted = false;
        return;
      }
      const session = this.work.current()!;
      const target =
        offset > 0 ? this.navigation().next : this.navigation().previous;
      if (!target) {
        this.departureAccepted = false;
        this.openFinish();
        return;
      }
      if (
        !(await this.work.command('visit', {
          contributionId: target.contributionId,
          obligationId: target.obligationId
        }))
      ) {
        this.departureAccepted = false;
        return;
      }
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          sponsorshipId: target.contributionId,
          obligationId: target.obligationId,
          preparationVersion: null,
          workSession: session.id
        },
        queryParamsHandling: 'merge'
      });
      return;
    }
    const item = receipt.siblings[this.position() - 1 + offset];
    if (!item) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sponsorshipId: item.contributionId,
        obligationId: item.id,
        preparationVersion: null
      },
      queryParamsHandling: 'merge'
    });
  }
  openEnlarged(): void {
    if (!this.browser) return;
    this.enlarged.set(true);
    afterNextRender(() => this.enlargedDialog()?.nativeElement.showModal(), {
      injector: this.injector
    });
  }
  closeEnlarged(): void {
    if (!this.browser) return;
    const dialog = this.enlargedDialog()?.nativeElement;
    if (dialog?.open) {
      dialog.close();
      this.enlargeButton()?.nativeElement.focus();
    }
    this.enlarged.set(false);
  }
  setDraft(field: 'title' | 'body' | 'disclosure', event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement)
      .value;
    ({
      title: this.draftTitle,
      body: this.draftBody,
      disclosure: this.draftDisclosure
    })[field].set(value);
    this.workNotice.set(null);
  }
  async startWork(): Promise<void> {
    const receipt = this.receipt();
    if (!receipt || this.continuationBlocked()) return;
    const key = this.selectionKey;
    const checkpoint = this.personalCheckpoint();
    const started =
      this.work.current()?.status === 'finished'
        ? await this.work.start(receipt, this.filters())
        : await this.ensureSession(receipt);
    if (started && this.sameSelection(key))
      await this.persistCheckpoint('checkpoint', receipt, checkpoint);
  }
  async resumeWork(): Promise<void> {
    if (this.continuationBlocked() || !(await this.work.command('resume')))
      return;
    this.workNotice.set('resumed');
    this.restoredCheckpoint = '';
    await this.load(true, true);
  }
  private filters(): AdminPreflightWorkSessionFilters {
    const params = this.params();
    const stage = params?.get('deskStatus');
    const page = Number(params?.get('deskPage') ?? '1');
    return {
      ...([
        'to_prepare',
        'to_review',
        'to_deliver',
        'delivered',
        'all'
      ].includes(stage ?? '')
        ? {
            deskStatus: stage as AdminPreflightWorkSessionFilters['deskStatus']
          }
        : {}),
      ...(params?.get('deskSearch')
        ? { deskSearch: params.get('deskSearch')!.slice(0, 120) }
        : {}),
      ...(Number.isSafeInteger(page) && page > 0 ? { deskPage: page } : {})
    };
  }
  private async ensureSession(
    receipt: AdminServicePreparationReceipt
  ): Promise<boolean> {
    const session = this.work.current();
    if (session && session.status !== 'active') return false;
    if (!session) return this.work.start(receipt, this.filters());
    if (this.work.item(receipt.contributionId, receipt.service.id)) return true;
    return this.work.command('visit', {
      contributionId: receipt.contributionId,
      obligationId: receipt.service.id,
      observedVersion: receipt.version
    });
  }
  private personalCheckpoint(): AdminPreflightWorkSessionCheckpoint {
    const reason = this.departureAccepted ? this.savedReason() : this.reason();
    const pending = this.departureAccepted
      ? this.savedPending()
      : this.pendingDecision();
    return {
      pendingDecision: this.decisionIntent?.decision ?? pending,
      reason,
      view: this.section(),
      ...(this.decisionIntent
        ? {
            decisionRequestId: this.decisionIntent.requestId,
            expectedPreparationVersion: this.decisionIntent.expectedVersion
          }
        : {})
    };
  }
  private async persistCheckpoint(
    action: 'checkpoint' | 'defer' | 'pause' | 'finish',
    receipt = this.receipt(),
    checkpoint = this.personalCheckpoint()
  ): Promise<boolean> {
    if (!receipt) return false;
    const key = this.selectionKey;
    const saved = await this.work.command(action, {
      contributionId: receipt.contributionId,
      obligationId: receipt.service.id,
      observedVersion: receipt.version,
      checkpoint,
      filters: this.filters()
    });
    if (!saved || !this.sameSelection(key)) return false;
    this.savedReason.set(checkpoint.reason);
    this.savedPending.set(
      checkpoint.pendingDecision === 'approved'
        ? null
        : checkpoint.pendingDecision
    );
    const session = this.work.current();
    if (
      session &&
      !this.leavePending() &&
      this.params()?.get('workSession') !== session.id
    ) {
      await this.normalizeUrl({ workSession: session.id });
    }
    return true;
  }
  private applyDraftReceipt(
    receipt: AdminServicePreparationReceipt,
    reset: boolean
  ): void {
    const draft = receipt.draft;
    if (this.pendingDraft && this.draftAcknowledged) {
      const matchesSavedInput =
        draft?.title === this.pendingDraft.title &&
        draft.body === this.pendingDraft.body &&
        draft.disclosureText === this.pendingDraft.disclosureText;
      this.pendingDraft = null;
      this.draftAcknowledged = false;
      this.draftUncertain.set(false);
      this.draftSourceConflict.set(!matchesSavedInput);
      if (!matchesSavedInput) this.sourceChanged.set(true);
      reset = matchesSavedInput;
      this.workNotice.set(matchesSavedInput ? 'draftSaved' : 'sourceChanged');
    }
    if (reset && !this.pendingDraft) {
      this.draftTitle.set(draft?.title ?? '');
      this.draftBody.set(draft?.body ?? '');
      this.draftDisclosure.set(draft?.disclosureText ?? '');
    }
  }
  private async restoreCheckpoint(
    receipt: AdminServicePreparationReceipt
  ): Promise<void> {
    const session = this.work.current();
    const item = this.work.item(receipt.contributionId, receipt.service.id);
    if (!session || !item) return;
    const key = `${session.id}:${receipt.contributionId}:${receipt.service.id}`;
    if (key !== this.restoredCheckpoint && !this.localDirty()) {
      this.restoredCheckpoint = key;
      const checkpoint = item.checkpoint;
      this.reason.set(checkpoint.reason);
      this.savedReason.set(checkpoint.reason);
      this.pendingDecision.set(
        checkpoint.pendingDecision === 'approved'
          ? null
          : checkpoint.pendingDecision
      );
      this.savedPending.set(
        checkpoint.pendingDecision === 'approved'
          ? null
          : checkpoint.pendingDecision
      );
      if (this.sections.includes(checkpoint.view as Section))
        this.section.set(checkpoint.view as Section);
      this.sourceChanged.set(
        !!item.observedVersion && item.observedVersion !== receipt.version
      );
      if (
        checkpoint.pendingDecision &&
        checkpoint.decisionRequestId &&
        checkpoint.expectedPreparationVersion
      ) {
        this.decisionIntent = {
          contributionId: receipt.contributionId,
          obligationId: receipt.service.id,
          expectedVersion: checkpoint.expectedPreparationVersion,
          requestId: checkpoint.decisionRequestId,
          confirmed: true,
          decision: checkpoint.pendingDecision,
          ...(checkpoint.pendingDecision === 'approved'
            ? {}
            : { reason: checkpoint.reason })
        };
        this.decisionUncertain.set(true);
      }
    }
    if (
      this.decisionIntent &&
      receipt.history.some(
        (decision) =>
          decision.requestId === this.decisionIntent!.requestId &&
          decision.decision === this.decisionIntent!.decision
      )
    ) {
      this.decisionIntent = null;
      this.decisionUncertain.set(false);
      this.pendingDecision.set(null);
      this.reason.set('');
      this.savedReason.set('');
      this.savedPending.set(null);
      this.workNotice.set('decisionConfirmed');
      this.sourceChanged.set(false);
      if (
        session.status === 'active' &&
        !this.work.busy() &&
        !this.work.unresolved()
      )
        await this.persistCheckpoint('checkpoint', receipt, {
          pendingDecision: null,
          reason: '',
          view: this.section()
        });
    }
  }
  async saveDraft(retry = false): Promise<boolean> {
    const receipt = this.receipt();
    if (
      !receipt ||
      (!retry &&
        (!this.socialEditable() ||
          this.state() !== 'ready' ||
          this.stale() ||
          this.versionMismatch() ||
          !this.draftDirty() ||
          this.continuationBlocked())) ||
      (retry &&
        (!this.pendingDraft ||
          this.busy() ||
          this.work.busy() ||
          this.work.unresolved() ||
          this.readOnly()))
    )
      return false;
    const key = this.selectionKey;
    if (
      !retry &&
      (!(await this.ensureSession(receipt)) || !this.sameSelection(key))
    )
      return false;
    const session = this.work.current()!;
    const input: AdminServicePreparationSaveDraftRequest = retry
      ? this.pendingDraft!
      : {
          contributionId: receipt.contributionId,
          obligationId: receipt.service.id,
          expectedVersion: receipt.version,
          requestId: crypto.randomUUID(),
          title: this.draftTitle(),
          body: this.draftBody(),
          disclosureText: this.draftDisclosure(),
          workSessionId: session.id,
          expectedSessionRevision: session.revision
        };
    this.pendingDraft = input;
    this.draftAcknowledged = false;
    this.busy.set(true);
    this.workNotice.set(null);
    try {
      const result = await this.admin.preflightWorkSessions.saveDraft(input);
      if (!this.sameSelection(key) || this.disposed) return false;
      this.pendingDraft = null;
      this.receipt.set(result.receipt);
      this.applyDraftReceipt(result.receipt, true);
      this.work.adopt(result.session);
      this.stale.set(false);
      this.draftUncertain.set(false);
      this.workNotice.set('draftSaved');
      await this.recordVersion(result.receipt.version);
      return true;
    } catch (error) {
      if (!this.sameSelection(key) || this.disposed) return false;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      this.stale.set(true);
      this.draftUncertain.set(![401, 403, 409].includes(status));
      if (!this.draftUncertain()) this.pendingDraft = null;
      this.message.set(
        status === 409
          ? 'errors.conflict'
          : status === 403
            ? 'errors.forbidden'
            : 'errors.uncertain'
      );
      if (status === 401 || status === 403) {
        this.receipt.set(null);
        this.draftTitle.set('');
        this.draftBody.set('');
        this.draftDisclosure.set('');
        this.state.set(status === 401 ? 'expired' : 'forbidden');
      }
      return false;
    } finally {
      if (this.sameSelection(key)) this.busy.set(false);
    }
  }
  async saveAll(): Promise<boolean> {
    if (this.continuationBlocked()) return false;
    if (this.draftDirty() && !(await this.saveDraft())) return false;
    const receipt = this.receipt();
    if (!receipt || !(await this.ensureSession(receipt))) return false;
    return this.persistCheckpoint('checkpoint', receipt);
  }
  async saveLater(): Promise<void> {
    if (!(await this.saveAll()) || !(await this.persistCheckpoint('pause')))
      return;
    this.workNotice.set('checkpointSaved');
    await this.back();
  }
  async reconcileWork(): Promise<void> {
    if (this.busy() || this.work.busy()) return;
    await this.work.load(
      this.work.current()?.id ?? this.params()?.get('workSession') ?? undefined,
      true,
      this.pendingDraft?.requestId
    );
    const command = this.work.checkedCommand();
    this.draftAcknowledged =
      !!this.pendingDraft &&
      command?.status === 'applied' &&
      command.requestId === this.pendingDraft.requestId;
    await this.load(true, true);
    this.decisionReconciled.set(
      this.state() === 'ready' &&
        this.decisionUncertain() &&
        this.decisionIntent !== null
    );
  }
  async retryDecision(): Promise<void> {
    if (this.decisionIntent && this.decisionReconciled())
      await this.decide(this.decisionIntent.decision, true);
  }
  async retryDraft(): Promise<void> {
    if (
      this.pendingDraft &&
      this.canRetryDraft() &&
      (await this.confirmation.confirm(this.work.t('retry')))
    )
      await this.saveDraft(true);
  }
  canRetryDraft(): boolean {
    const checked = this.work.checkedCommand();
    return (
      !!this.pendingDraft &&
      checked?.status === 'not_found' &&
      checked.requestId === this.pendingDraft.requestId
    );
  }
  async openOwner(kind: 'delivery' | 'evidence' | 'media'): Promise<void> {
    const receipt = this.receipt();
    const url =
      kind === 'media' && receipt
        ? `/admin/fundraiser/sponsors?sponsorshipId=${receipt.contributionId}&tab=media#dossier-media-gallery`
        : this.ownerUrl(receipt?.links[kind] ?? null);
    if (!url || this.continuationBlocked() || !(await this.canLeave())) return;
    if (
      this.work.current()?.status === 'active' &&
      !(await this.persistCheckpoint('checkpoint'))
    )
      return;
    await this.router.navigateByUrl(url);
  }
  mediaAccessLost(status: 401 | 403): void {
    this.request?.abort();
    ++this.serial;
    ++this.decisionSerial;
    this.busy.set(false);
    this.receipt.set(null);
    this.draftTitle.set('');
    this.draftBody.set('');
    this.draftDisclosure.set('');
    this.reason.set('');
    this.savedReason.set('');
    this.pendingDecision.set(null);
    this.savedPending.set(null);
    this.state.set(status === 401 ? 'expired' : 'forbidden');
  }
  openFinish(): void {
    if (!this.browser || this.busy() || this.work.busy() || this.mediaBusy())
      return;
    this.finishDialog()?.nativeElement.showModal();
  }
  closeFinish(): void {
    this.finishDialog()?.nativeElement.close();
  }
  async finishWork(discard = false): Promise<void> {
    if (this.continuationBlocked()) return;
    if (discard) {
      if (!(await this.confirmation.confirm(this.work.t('discardConfirm'))))
        return;
      this.departureAccepted = true;
    } else if (!(await this.saveAll())) return;
    if (!(await this.persistCheckpoint('finish'))) {
      this.departureAccepted = false;
      return;
    }
    this.closeFinish();
    await this.back();
  }
  canLeave(): boolean | Promise<boolean> {
    const navigation = this.router.currentNavigation();
    if (
      navigation &&
      [...this.urlNormalizations].some(
        (normalization) =>
          normalization.selection === this.selectionKey &&
          normalization.url ===
            this.router.serializeUrl(navigation.extractedUrl)
      )
    )
      return true;
    if (!this.admin.hasValidAdminSession()) return true;
    if (this.continuationBlocked()) return false;
    if (this.departureAccepted || !this.localDirty()) return true;
    if (this.leavePending()) return false;
    this.leavePending.set(true);
    const result = new Promise<boolean>((resolve) => {
      this.leaveResolve = resolve;
    });
    this.leaveDialog()?.nativeElement.showModal();
    return result;
  }
  async leaveWithSave(): Promise<void> {
    if (await this.saveAll()) this.answerLeave(true);
  }
  answerLeave(accepted: boolean): void {
    if (accepted) this.departureAccepted = true;
    this.leaveDialog()?.nativeElement.close();
    this.leavePending.set(false);
    const resolve = this.leaveResolve;
    this.leaveResolve = null;
    resolve?.(accepted);
  }
  cancelDeparture(): void {
    this.departureAccepted = false;
    this.answerLeave(false);
  }
  private async recordVersion(version: string): Promise<void> {
    // Saving from a departure dialog must let its original navigation finish.
    if (this.leavePending()) return;
    await this.normalizeUrl({ preparationVersion: version });
  }
  private async normalizeUrl(params: Record<string, string>): Promise<void> {
    const tree = this.router.createUrlTree([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge'
    });
    const normalization = {
      url: this.router.serializeUrl(tree),
      selection: this.selectionKey,
      navigationId: null as number | null
    };
    this.urlNormalizations.add(normalization);
    try {
      await this.router.navigateByUrl(tree, { replaceUrl: true });
    } finally {
      this.urlNormalizations.delete(normalization);
    }
  }
  private current(ticket: number, key: string): boolean {
    return !this.disposed && ticket === this.serial && this.sameSelection(key);
  }
  private sameSelection(key: string): boolean {
    const params = this.params();
    return (
      key === this.selectionKey &&
      key ===
        `${this.work.identityKey()}:${params?.get('sponsorshipId') ?? ''}:${params?.get('obligationId') ?? ''}`
    );
  }
}
