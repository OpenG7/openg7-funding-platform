import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { Router } from '@angular/router';
import {
  type SponsorMediaWorkspaceAsset,
  type SponsorMediaPreparationObligation,
  type SponsorMediaExportRequest,
  getSponsorMediaActions
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import { adminDocumentDeliveryBrowser } from '../../services/admin-document-delivery-browser.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminAssistantContextComponent } from '../admin-assistant/admin-assistant-context.component.js';
import { FundingModerationActionsComponent } from '../admin-moderation/funding-moderation-actions.component.js';
import { ContextControllerComponent } from '../admin-context-controller/context-controller.component.js';
import { ContextControllerActionComponent } from '../admin-context-controller/context-controller-action.component.js';
import type {
  ControllerAction,
  ControllerActionRequest
} from '../../models/context-controller.models.js';

import {
  MediaReviewWorkspaceController,
  type MediaReviewFilter,
  type MediaLibraryView
} from './media-review-workspace.controller.js';
import { MediaPreviewCollection } from './media-preview-collection.js';
import { MediaReviewThumbnailComponent } from './media-review-thumbnail.component.js';
import { MediaReviewAnalysis } from './media-review-analysis.js';
import { MediaReviewUpload } from './media-review-upload.js';
import { MediaReviewHistory } from './media-review-history.js';
import { MediaReviewCommands } from './media-review-commands.js';
import { MediaReviewCommandsComponent } from './media-review-commands.component.js';
import { MediaReviewAnalysisComponent } from './media-review-analysis.component.js';
import { MediaReviewHistoryComponent } from './media-review-history.component.js';
import { MediaReviewApproveAll } from './media-review-approve-all.js';

/** Funding organism: paged gallery, one inspector and server-planned, explicitly confirmed commands. */
@Component({
  selector: 'openg7-media-review-workspace',
  standalone: true,
  imports: [
    MediaReviewCommandsComponent,
    MediaReviewAnalysisComponent,
    MediaReviewHistoryComponent,
    FundingModerationActionsComponent,
    MediaReviewThumbnailComponent,
    ContextControllerComponent,
    ContextControllerActionComponent,
    AdminDrawerComponent,
    AdminAssistantContextComponent,
    AdminIconComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-review-workspace.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './media-review-common.css',
    './media-review-workspace.component.css'
  ]
})
export class MediaReviewWorkspaceComponent {
  readonly contributionId = input.required<string>();
  readonly libraryView = input<MediaLibraryView>('media');
  readonly headingLevel = input<3 | 4>(3);
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly busyChange = output<boolean>();
  readonly inspectRequested = output<void>();
  readonly i18n = inject(FundingI18nService);
  readonly admin = inject(FundingAdminService);
  private readonly scopeIdentity = computed(
    () => this.admin.identity()?.id ?? ''
  );
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly inspector = viewChild<ElementRef<HTMLElement>>('inspector');
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  readonly workspaceVisible = signal(false);
  readonly documentVisible = signal(true);
  readonly layout = signal<'grid' | 'list'>('grid');
  readonly targetObligationId = signal('');
  readonly consentRequestOpened = signal(false);
  readonly consentRequestBusy = signal(false);
  private consentRequestOpener: HTMLElement | null = null;
  private approveAllOpener: HTMLElement | null = null;
  private approveAllPreviewOpener: HTMLElement | null = null;
  readonly exportOpen = signal(false);
  readonly exportConfirmed = signal(false);
  readonly exportBusy = signal(false);
  readonly exportStarted = signal(false);
  readonly exportManifest = signal<readonly SponsorMediaWorkspaceAsset[]>([]);
  readonly exportItems = signal<
    readonly {
      id: string;
      name: string;
      state: 'waiting' | 'received' | 'failed' | 'uncertain' | 'not_processed';
    }[]
  >([]);
  readonly pendingExport = signal<SponsorMediaExportRequest | null>(null);
  readonly recoverableExport = signal<SponsorMediaExportRequest | null>(null);
  private exportEpoch = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly filters: readonly MediaReviewFilter[] = [
    'all',
    'ready',
    'needs_review',
    'blocked',
    'approved',
    'rejected'
  ];
  readonly c: MediaReviewWorkspaceController =
    new MediaReviewWorkspaceController({
      admin: this.admin,
      permitted: (): boolean =>
        !this.disabled() &&
        !this.analysis.busy() &&
        !this.upload.busy() &&
        !this.exportBusy() &&
        !this.consentRequestBusy() &&
        !this.approveAll.busy() &&
        !this.approveAll.unresolved() &&
        this.admin.identity()?.role !== 'reader',
      changed: () => this.changed.emit(),
      unauthorized: () => {
        this.admin.clearAdminSession();
        void this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
        });
      }
    });
  readonly analysis: MediaReviewAnalysis = new MediaReviewAnalysis({
    admin: this.admin,
    controller: this.c,
    contributionId: () => this.contributionId(),
    refresh: () => this.refresh(),
    changed: () => this.changed.emit()
  });
  readonly upload: MediaReviewUpload = new MediaReviewUpload({
    admin: this.admin,
    controller: this.c,
    contributionId: () => this.contributionId(),
    refresh: () => this.refresh(),
    changed: () => this.changed.emit()
  });
  readonly history = new MediaReviewHistory({
    admin: this.admin,
    controller: this.c
  });
  readonly commands = new MediaReviewCommands(this.c, () =>
    this.contributionId()
  );
  readonly approveAll = new MediaReviewApproveAll({
    admin: this.admin,
    controller: this.c,
    permitted: () =>
      this.browser &&
      this.admin.hasValidAdminSession() &&
      this.c.data()?.writable === true &&
      this.admin.identity()?.role !== 'reader' &&
      !this.disabled() &&
      !this.c.busy() &&
      !this.c.uncertain() &&
      !this.analysis.busy() &&
      !this.upload.busy() &&
      !this.exportBusy() &&
      !this.consentRequestBusy() &&
      !this.commands.reviewSubmitting(),
    refresh: () => this.refresh(),
    changed: () => this.changed.emit(),
    unauthorized: () => {
      this.admin.clearAdminSession();
      void this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
      });
    },
    storage: () => adminDocumentDeliveryBrowser()?.storage() ?? null
  });
  readonly mediaHeroCounts = computed(() => {
    const assets = this.c.assets();
    return {
      total: assets.length,
      toReview: assets.filter(
        (asset) => asset.reviewStatus === 'pending_review'
      ).length,
      approved: assets.filter((asset) => asset.reviewStatus === 'approved')
        .length,
      authorizationRequired: assets.filter(
        (asset) =>
          asset.reviewStatus !== 'rejected' &&
          asset.usage?.state !== 'confirmed'
      ).length
    };
  });
  readonly hasPendingMediaConsent = computed(() =>
    this.c
      .assets()
      .some(
        (asset) =>
          asset.kind === 'supporting_image' &&
          asset.reviewStatus !== 'rejected' &&
          (!asset.usage || asset.usage.state === 'needs_confirmation')
      )
  );
  readonly canRequestMediaConsent = computed(
    () =>
      this.hasPendingMediaConsent() &&
      this.c.canWrite() &&
      !this.commands.reviewSubmitting() &&
      !this.consentRequestBusy()
  );
  readonly thumbnails = new MediaPreviewCollection((id) =>
    this.admin.mediaThumbnail(id)
  );
  private readonly fullPreview = new BlobPreviewResource();
  readonly previewUrl = this.fullPreview.url;
  readonly previewFailed = signal(false);
  readonly preparationObligations = computed(
    () => this.c.data()?.preparationObligations ?? []
  );
  readonly targetObligation = computed(
    () =>
      this.preparationObligations().find(
        (item) => item.id === this.targetObligationId()
      ) ?? null
  );
  readonly analysisSummary = computed(() => {
    const runs = this.analysis
      .runs()
      .filter((run) =>
        this.c.assets().some((asset) => asset.id === run.assetId)
      );
    const current = runs.filter(
      (run) => !run.stale && run.state === 'succeeded'
    );
    return {
      complete: current.length,
      proposals: current.filter(
        (run) => !!run.suggestion && run.review?.decision !== 'rejected'
      ).length,
      stale: runs.filter((run) => run.stale).length,
      processing: runs.filter(
        (run) =>
          !run.stale && (run.state === 'queued' || run.state === 'processing')
      ).length,
      signals: current.reduce(
        (count, run) => count + (run.suggestion?.signals.length ?? 0),
        0
      )
    };
  });
  readonly logoCount = computed(
    () => this.c.assets().filter((asset) => asset.kind === 'logo').length
  );
  readonly issueCount = computed(
    () => this.c.counts().blocked + this.c.counts().needs_review
  );
  readonly assignmentCount = computed(
    () =>
      this.c
        .data()
        ?.preparationAssignments?.filter((assignment) => !assignment.stale)
        .length ?? 0
  );
  readonly context = computed(() => {
    const asset = this.c.inspected(),
      data = this.c.data();
    return asset && data
      ? {
          key: 'media:' + asset.id,
          targetId: asset.id,
          revision: data.revision + ':' + asset.version
        }
      : null;
  });
  readonly actions = computed<readonly ControllerAction[]>(() =>
    getSponsorMediaActions({
      selectionCount: this.c.inspected() ? 1 : 0,
      readyCount: this.c.inspected()?.readiness.state === 'ready' ? 1 : 0,
      reviewableCount:
        this.c.inspected() && this.canReviewSingle(this.c.inspected()!) ? 1 : 0,
      canReview: this.c.canWrite(),
      busy: this.c.busy() || this.analysis.busy()
    })
      .filter((action) =>
        ['preview', 'approve', 'reject', 'permissions'].includes(action.id)
      )
      .map((action) => ({
        id: action.id,
        label: this.t('actions.' + action.id),
        icon:
          action.id === 'preview'
            ? 'search'
            : action.id === 'permissions'
              ? 'settings'
              : action.id === 'approve'
                ? 'check'
                : 'close',
        zone: 'radial',
        scope: 'selection',
        tone: action.id === 'reject' ? 'danger' : 'default',
        enabled: action.enabled,
        visible: true,
        busy: this.c.busy(),
        requiresConfirmation: action.requiresConfirmation,
        shortcut: {
          label: (
            {
              approve: 'A',
              preview: 'X',
              permissions: 'Y',
              reject: 'B'
            } as Record<string, string>
          )[action.id],
          tone: (
            {
              approve: 'a',
              preview: 'x',
              permissions: 'y',
              reject: 'b'
            } as const
          )[action.id as 'approve' | 'preview' | 'permissions' | 'reject']
        }
      }))
  );
  private languageGeneration = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      const view = this.libraryView();
      untracked(() => {
        this.c.libraryView.set(view);
        this.c.page.set(1);
      });
    });
    effect(() => {
      const runs = this.analysis.runs();
      untracked(() =>
        this.c.classifications.set(
          Object.fromEntries(
            runs
              .filter(
                (run) =>
                  !run.stale && run.state === 'succeeded' && !!run.suggestion
              )
              .map((run) => [
                run.assetId,
                run.review?.draft.classification ??
                  run.suggestion!.classification
              ])
          )
        )
      );
    });
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() => {
        void this.loadLanguage(language);
      });
    });
    effect(() => {
      const id = this.contributionId(),
        session = this.admin.sessionGeneration(),
        identity = this.scopeIdentity();
      untracked(() => {
        void session;
        const authenticated = this.browser && this.admin.hasValidAdminSession();
        this.c.setScope('');
        if (authenticated) this.c.setScope(id);
        this.approveAll.setScope(
          authenticated ? id : '',
          identity + ':' + session
        );
        this.approveAllOpener = null;
        this.approveAllPreviewOpener = null;
        this.thumbnails.clear();
        this.fullPreview.clear();
        this.commands.reset();
        this.consentRequestOpened.set(false);
        this.consentRequestBusy.set(false);
        this.consentRequestOpener = null;
        this.analysis.reset();
        this.history.reset();
        this.upload.reset();
        this.targetObligationId.set('');
        this.layout.set('grid');
        this.exportEpoch++;
        this.exportOpen.set(false);
        this.exportBusy.set(false);
        this.exportConfirmed.set(false);
        this.exportStarted.set(false);
        this.exportManifest.set([]);
        this.exportItems.set([]);
        this.pendingExport.set(null);
        this.recoverableExport.set(null);
        if (authenticated) {
          void this.c.load();
          void this.analysis.loadAnalyses();
        }
      });
    });
    effect(() => {
      const asset = this.c.inspected(),
        id = asset?.id,
        version = asset?.version;
      untracked(() => {
        this.history.clear();
        this.previewFailed.set(false);
        if (this.browser)
          void this.fullPreview.load(
            id && version
              ? () =>
                  this.admin.getSponsorMediaPreview(
                    this.admin.getSavedAdminToken(),
                    id
                  )
              : null,
            () => this.previewFailed.set(true)
          );
      });
    });
    effect(() => {
      const asset = this.c.inspected(),
        run = this.analysis.run();
      if (asset) untracked(() => this.c.restoreSavedAnalysisDraft(asset, run));
    });
    effect(() => {
      const assets = [...this.c.visible(), ...(this.c.plan()?.assets ?? [])];
      untracked(() =>
        this.thumbnails.retain(
          assets.map((asset) => this.thumbnails.key(asset.id, asset.version))
        )
      );
    });
    effect(() =>
      this.busyChange.emit(
        this.c.busy() ||
          this.analysis.busy() ||
          this.upload.busy() ||
          this.exportBusy() ||
          this.consentRequestBusy() ||
          this.approveAll.busy()
      )
    );
    effect((cleanup) => {
      const processing = this.analysis
        .runs()
        .some((run) => run.state === 'queued' || run.state === 'processing');
      if (
        !this.browser ||
        !processing ||
        !this.workspaceVisible() ||
        !this.documentVisible() ||
        this.analysis.polls() >= 30 ||
        this.analysis.readLoading() ||
        this.analysis.busy()
      )
        return;
      const timer = setTimeout(() => {
        this.analysis.polls.update((count) => count + 1);
        if (!this.c.busy()) void this.analysis.loadAnalyses();
      }, 2000);
      cleanup(() => clearTimeout(timer));
    });
    const visibility = () =>
      this.documentVisible.set(this.document.visibilityState !== 'hidden');
    this.document.addEventListener('visibilitychange', visibility);
    let observer: IntersectionObserver | null = null;
    afterNextRender(() => {
      if (!this.browser) return;
      if (typeof IntersectionObserver === 'undefined') {
        this.workspaceVisible.set(true);
        return;
      }
      observer = new IntersectionObserver((entries) =>
        this.workspaceVisible.set(entries.some((entry) => entry.isIntersecting))
      );
      observer.observe(this.host.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.analysis.dispose();
      this.upload.dispose();
      this.history.dispose();
      this.c.dispose();
      this.thumbnails.dispose();
      this.fullPreview.dispose();
      this.approveAll.dispose();
      observer?.disconnect();
      this.document.removeEventListener('visibilitychange', visibility);
    });
  }
  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.mediaReview.' + key, params);
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  count(filter: string): number {
    return this.c.counts()[filter as MediaReviewFilter] ?? 0;
  }
  status(asset: SponsorMediaWorkspaceAsset): string {
    return this.t(
      'filters.' +
        (asset.reviewStatus === 'approved' || asset.reviewStatus === 'rejected'
          ? asset.reviewStatus
          : asset.readiness.state)
    );
  }
  assetName(id: string): string {
    return (
      this.c.assets().find((asset) => asset.id === id)?.originalFilename ??
      this.t('inspector')
    );
  }
  size(bytes: number): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'unit',
      unit: 'kilobyte',
      maximumFractionDigits: 0
    }).format(bytes / 1024);
  }
  obligationLabel(obligation: SponsorMediaPreparationObligation): string {
    return this.t('library.obligation', {
      channel: this.i18n.t('funding.offer.channels.' + obligation.channel),
      target: obligation.target === 'openg7' ? 'OpenG7' : 'OpenG20',
      ordinal: obligation.ordinal
    });
  }
  assignmentLabel(obligationId: string): string {
    const obligation = this.preparationObligations().find(
      (item) => item.id === obligationId
    );
    return obligation
      ? this.obligationLabel(obligation)
      : this.t('library.assignmentUnavailable');
  }
  async prepareAssignment(remove = false): Promise<void> {
    const target = this.targetObligation();
    if (!target || !this.c.canWrite() || (!remove && !target.acceptsMedia))
      return;
    this.commands.reset();
    this.commands.humanReviewed.set(false);
    await this.c.prepare(
      remove ? 'preparation_unassign' : 'preparation_assign',
      { targetObligationId: target.id, targetObligationVersion: target.version }
    );
    if (this.c.plan()) this.commands.form.set('plan');
  }
  setPageSize(event: Event): void {
    const size = Number(this.value(event));
    if ([8, 16, 25].includes(size)) {
      this.c.pageSize.set(size);
      this.c.page.set(1);
    }
  }
  openUpload(): void {
    this.host.nativeElement
      .querySelector<HTMLInputElement>('[data-og7="media-upload-files"]')
      ?.click();
  }
  reviewIssues(): void {
    this.setFilter(this.c.counts().blocked ? 'blocked' : 'needs_review');
    const asset = this.c.filtered()[0];
    if (asset) this.inspect(asset);
  }
  inspectSuggestion(): void {
    const run = this.analysis
      .runs()
      .find(
        (item) =>
          !item.stale &&
          item.state === 'succeeded' &&
          !!item.suggestion &&
          item.review?.decision !== 'rejected'
      );
    const asset = this.c.assets().find((item) => item.id === run?.assetId);
    if (asset) this.inspect(asset);
  }
  reasonLabel(reason: string): string {
    const known = [
      'MEDIA_INVALID',
      'MEDIA_USAGE_WITHDRAWN',
      'MEDIA_USAGE_CONFIRMATION_REQUIRED',
      'MEDIA_REJECTED',
      'MODERATION_DECISION_REQUIRED',
      'MODERATION_RESTRICTED',
      'MEDIA_RESTRICTIONS_REVIEW_REQUIRED',
      'MEDIA_ALT_TEXT_REQUIRED',
      'MEDIA_ANALYSIS_FAILED',
      'MEDIA_HUMAN_REVIEW_REQUIRED',
      'MEDIA_ALREADY_APPROVED',
      'MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED',
      'MEDIA_CONTENT_UNAVAILABLE',
      'MEDIA_NOT_FOUND',
      'MEDIA_KIND_UNSUPPORTED',
      'MEDIA_PLAN_STALE',
      'MEDIA_VERSION_CONFLICT',
      'MODERATION_CONTENT_CHANGED',
      'MODERATION_DECISION_CONFLICT',
      'MODERATION_RECONSIDERATION_OPEN',
      'MEDIA_PREPARATION_DOSSIER_INELIGIBLE',
      'MEDIA_PREPARATION_FORMAT_UNSUPPORTED',
      'MEDIA_PREPARATION_KIND_UNSUPPORTED',
      'MEDIA_PREPARATION_REVIEW_RESTRICTED',
      'MEDIA_PREPARATION_ASSIGNMENT_NOT_FOUND',
      'MEDIA_PREPARATION_TARGET_CHANGED',
      'MEDIA_PREPARATION_VERSION_CONFLICT',
      'MEDIA_PREPARATION_SCOPE_MISMATCH',
      'MEDIA_PREPARATION_SCHEMA_REQUIRED',
      'MEDIA_CHANNEL_NOT_AUTHORIZED',
      'MEDIA_TARGET_NOT_AUTHORIZED',
      'MEDIA_TRANSFORMATION_NOT_AUTHORIZED'
    ];
    return this.t('reasons.' + (known.includes(reason) ? reason : 'other'));
  }
  effectLabel(effect: string): string {
    const known = [
      'ACCEPT_MEDIA_ONLY',
      'NO_SOCIAL_PUBLICATION',
      'WEBSITE_SELECTION_SEPARATE',
      'PRIVATE_MEDIA_PREPARATION_ONLY',
      'NO_PUBLICATION_AUTHORIZATION',
      'WEBSITE_SELECTION_UNCHANGED',
      'MEDIA_CORRECTION_REQUESTED',
      'INVALIDATE_AFFECTED_APPROVALS',
      'NO_OUTBOUND_MESSAGE',
      'REVOKE_MEDIA',
      'DURABLE_STORAGE_CLEANUP',
      'SELECT_FOR_ELIGIBLE_PUBLIC_WEBSITE'
    ];
    return this.t(
      'library.effects.' + (known.includes(effect) ? effect : 'other')
    );
  }
  usageSummary(asset: Pick<SponsorMediaWorkspaceAsset, 'usage'>): string {
    const usage = asset.usage;
    if (!usage || usage.state !== 'confirmed')
      return this.reasonLabel('MEDIA_USAGE_CONFIRMATION_REQUIRED');
    return [
      ...usage.channels.map((channel) =>
        this.i18n.t('funding.offer.channels.' + channel)
      ),
      ...usage.targets.map((target) =>
        target === 'openg7' ? 'OpenG7' : 'OpenG20'
      ),
      ...usage.transformations.map((kind) =>
        this.i18n.t('funding.followup.media.usage.transforms.' + kind)
      )
    ].join(' · ');
  }
  canAction(id: string, single = false): boolean {
    const assets = single
      ? this.c.inspected()
        ? [this.c.inspected()!]
        : []
      : this.c.selected();
    return getSponsorMediaActions({
      selectionCount: assets.length,
      readyCount: assets.filter((asset) => asset.readiness.state === 'ready')
        .length,
      reviewableCount: assets.filter((asset) =>
        single
          ? this.canReviewSingle(asset)
          : asset.readiness.state !== 'blocked'
      ).length,
      canReview: this.c.canWrite(),
      busy: this.c.busy() || this.analysis.busy() || this.upload.busy()
    }).some((action) => action.id === id && action.enabled);
  }
  private canReviewSingle(asset: SponsorMediaWorkspaceAsset): boolean {
    return asset.reviewStatus !== 'rejected';
  }
  startMediaReview(asset: SponsorMediaWorkspaceAsset): void {
    const current = this.c.inspected();
    if (
      !this.canAction('approve', true) ||
      current?.id !== asset.id ||
      current.version !== asset.version
    )
      return;
    this.commands.openAcceptedReview(current);
  }
  async openApproveAll(): Promise<void> {
    if (!this.approveAll.canOpen()) return;
    this.approveAllOpener = this.document.activeElement as HTMLElement | null;
    await this.approveAll.prepare();
  }
  closeApproveAll(): void {
    if (this.approveAll.busy()) return;
    const opener = this.approveAllOpener,
      id = this.contributionId(),
      session = this.admin.sessionGeneration();
    this.approveAllOpener = null;
    this.approveAll.close();
    if (!this.browser || !opener) return;
    afterNextRender(
      {
        read: () => {
          if (
            !this.destroyed &&
            !this.approveAll.opened() &&
            this.contributionId() === id &&
            this.admin.sessionGeneration() === session &&
            opener.isConnected &&
            !opener.matches(':disabled')
          )
            opener.focus();
        }
      },
      { injector: this.injector }
    );
  }
  openApproveAllPreview(asset: SponsorMediaWorkspaceAsset): void {
    this.approveAllPreviewOpener = this.document
      .activeElement as HTMLElement | null;
    this.approveAll.openPreview(asset);
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-og7="media-approve-all-preview"]')
          ?.focus();
      },
      { injector: this.injector }
    );
  }
  closeApproveAllPreview(): void {
    const opener = this.approveAllPreviewOpener;
    this.approveAllPreviewOpener = null;
    this.approveAll.closePreview();
    afterNextRender(
      () => {
        if (
          !this.destroyed &&
          opener?.isConnected &&
          !opener.matches(':disabled')
        )
          opener.focus();
      },
      { injector: this.injector }
    );
  }
  openMediaConsentRequest(): void {
    if (!this.canRequestMediaConsent()) return;
    // Preparing the message disables its opener before the drawer captures focus.
    this.consentRequestOpener = this.browser
      ? (this.document.activeElement as HTMLElement | null)
      : null;
    this.consentRequestOpened.set(true);
  }
  closeMediaConsentRequest(): void {
    if (this.consentRequestBusy()) return;
    const opener = this.consentRequestOpener,
      contributionId = this.contributionId(),
      session = this.admin.sessionGeneration();
    this.consentRequestOpener = null;
    this.consentRequestOpened.set(false);
    if (!this.browser || !opener) return;
    afterNextRender(
      {
        read: () => {
          if (
            !this.destroyed &&
            !this.consentRequestOpened() &&
            this.contributionId() === contributionId &&
            this.admin.sessionGeneration() === session &&
            opener.isConnected &&
            !opener.matches(':disabled') &&
            !opener.closest('[hidden],[inert],[aria-hidden="true"]') &&
            opener.getClientRects().length > 0
          )
            opener.focus();
        }
      },
      { injector: this.injector }
    );
  }
  async reconcile(): Promise<void> {
    const exportRequest = this.pendingExport();
    if (exportRequest) {
      await this.c.reconcile();
      if (
        !this.c.uncertain() &&
        exportRequest.contributionId === this.contributionId()
      ) {
        this.pendingExport.set(null);
        this.recoverableExport.set(exportRequest);
        this.exportOpen.set(true);
      }
      return;
    }
    if (this.analysis.receiptRequest()) {
      await this.analysis.reconcile();
      return;
    }
    await this.c.reconcile();
    if (!this.c.uncertain()) this.commands.reset();
  }
  openExport(): void {
    if (this.pendingExport() || this.recoverableExport()) {
      this.exportOpen.set(true);
      return;
    }
    if (!this.c.canWrite() || !this.c.selected().length) return;
    this.exportManifest.set([...this.c.selected()]);
    this.exportItems.set(
      this.c.selected().map((asset) => ({
        id: asset.id,
        name: asset.originalFilename,
        state: 'waiting'
      }))
    );
    this.exportConfirmed.set(false);
    this.exportStarted.set(false);
    this.exportOpen.set(true);
  }
  async exportFiles(): Promise<void> {
    if (
      !this.browser ||
      !this.c.canWrite() ||
      !this.exportConfirmed() ||
      this.exportStarted() ||
      this.pendingExport() ||
      this.recoverableExport()
    )
      return;
    const epoch = this.exportEpoch,
      scope = this.contributionId();
    this.exportBusy.set(true);
    this.exportStarted.set(true);
    try {
      for (const asset of this.exportManifest()) {
        if (this.destroyed || epoch !== this.exportEpoch) return;
        const result = await this.exportOne(
          {
            requestId: crypto.randomUUID(),
            contributionId: scope,
            assetId: asset.id,
            expectedVersion: asset.version,
            confirmation: asset.id
          },
          epoch
        );
        if (this.destroyed || epoch !== this.exportEpoch) return;
        this.exportItems.update((items) =>
          items.map((item) =>
            item.id === asset.id ? { ...item, state: result } : item
          )
        );
        if (result !== 'received') {
          this.exportItems.update((items) =>
            items.map((item) =>
              item.state === 'waiting'
                ? { ...item, state: 'not_processed' }
                : item
            )
          );
          break;
        }
      }
    } finally {
      if (!this.destroyed && epoch === this.exportEpoch)
        this.exportBusy.set(false);
    }
  }
  async recoverExport(): Promise<void> {
    const request = this.recoverableExport();
    if (
      !request ||
      !this.c.canWrite() ||
      request.contributionId !== this.contributionId()
    )
      return;
    const epoch = this.exportEpoch;
    this.exportBusy.set(true);
    try {
      const result = await this.exportOne(request, epoch);
      if (this.destroyed || epoch !== this.exportEpoch) return;
      this.exportItems.update((items) =>
        items.map((item) =>
          item.id === request.assetId ? { ...item, state: result } : item
        )
      );
      if (result !== 'uncertain') this.recoverableExport.set(null);
    } finally {
      if (!this.destroyed && epoch === this.exportEpoch)
        this.exportBusy.set(false);
    }
  }
  private async exportOne(
    request: SponsorMediaExportRequest,
    epoch: number
  ): Promise<'received' | 'failed' | 'uncertain'> {
    try {
      const blob = await this.admin.mediaExport(request);
      if (
        this.destroyed ||
        epoch !== this.exportEpoch ||
        request.contributionId !== this.contributionId()
      )
        return 'failed';
      adminDocumentDeliveryBrowser()?.saveBlob(
        blob,
        'media-' + request.assetId.replace(/[^a-zA-Z0-9-]/g, '') + '.webp'
      );
      return 'received';
    } catch (error) {
      if (this.destroyed || epoch !== this.exportEpoch) return 'failed';
      if (
        !(error instanceof AdminDashboardRequestError) ||
        error.status >= 500
      ) {
        this.pendingExport.set(request);
        this.recoverableExport.set(null);
        this.c.uncertainRequest.set(request.requestId);
        this.c.uncertain.set(true);
        this.c.error.set('uncertain');
        return 'uncertain';
      }
      this.c.error.set(
        error.status === 401
          ? 'unauthorized'
          : error.status === 403
            ? 'forbidden'
            : 'changed'
      );
      if (error.status === 401 || error.status === 409) await this.c.load();
      return 'failed';
    }
  }
  setFilter(filter: MediaReviewFilter): void {
    this.c.filter.set(filter);
    this.c.page.set(1);
  }
  setReviewFilter(event: Event): void {
    const filter = this.value(event);
    if (this.filters.includes(filter as MediaReviewFilter))
      this.setFilter(filter as MediaReviewFilter);
  }
  setSearch(event: Event): void {
    this.c.search.set(this.value(event));
    this.c.page.set(1);
  }
  inspect(asset: SponsorMediaWorkspaceAsset): void {
    this.c.inspectedId.set(asset.id);
    afterNextRender(() => this.inspector()?.nativeElement.focus(), {
      injector: this.injector
    });
  }
  async refresh(): Promise<void> {
    await Promise.all([this.c.load(), this.analysis.loadAnalyses()]);
  }
  request(request: ControllerActionRequest): void {
    const context = this.context(),
      asset = this.c.inspected();
    if (
      !context ||
      !asset ||
      context.key !== request.context.key ||
      context.targetId !== request.context.targetId ||
      context.revision !== request.context.revision
    )
      return;
    if (request.actionId === 'approve') this.startMediaReview(asset);
    else if (request.actionId === 'reject') this.commands.openReject(asset);
    else if (request.actionId === 'permissions')
      this.commands.openAcceptedReview(asset);
    else if (request.actionId === 'preview')
      this.inspector()
        ?.nativeElement.querySelector<HTMLElement>(
          '[data-og7="media-full-preview"]'
        )
        ?.focus();
  }
  private async loadLanguage(language: 'fr-CA' | 'en'): Promise<void> {
    const generation = ++this.languageGeneration;
    try {
      const messages =
        language === 'en'
          ? await import('../../../../../assets/i18n/admin-media-review.en.json')
          : await import('../../../../../assets/i18n/admin-media-review.fr-CA.json');
      if (this.destroyed || generation !== this.languageGeneration) return;
      this.i18n.mergeTranslations(language, messages.default);
      this.languageReady.set(true);
    } catch {
      if (!this.destroyed) this.languageError.set(true);
    }
  }
}
