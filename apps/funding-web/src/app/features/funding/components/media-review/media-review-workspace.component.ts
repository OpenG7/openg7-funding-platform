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
  MODERATION_REASONS,
  SPONSOR_MEDIA_CLASSIFICATIONS,
  type SponsorMediaWorkspaceAsset,
  type MediaRuleScope,
  type SponsorMediaBatchAction,
  type SponsorMediaAnalysisRun,
  type SponsorMediaAnalysisResponse,
  type SponsorMediaClassification,
  type SponsorMediaKind,
  sponsorMediaAnalysisPrefill,
  getSponsorMediaActions
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type { MediaReviewHistoryResponse } from '../../services/funding-admin-media-review.client.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import {
  SponsorMediaUsageEditorComponent,
  type SponsorMediaUsageSubmission
} from '../sponsor-media-usage/sponsor-media-usage-editor.component.js';
import { FundingModerationActionsComponent } from '../admin-moderation/funding-moderation-actions.component.js';
import { ContextControllerComponent } from '../admin-context-controller/context-controller.component.js';
import { ContextControllerActionComponent } from '../admin-context-controller/context-controller-action.component.js';
import type {
  ControllerAction,
  ControllerActionRequest
} from '../../models/context-controller.models.js';

import {
  MediaReviewWorkspaceController,
  type MediaReviewFilter
} from './media-review-workspace.controller.js';
import { MediaPreviewCollection } from './media-preview-collection.js';
import { MediaReviewThumbnailComponent } from './media-review-thumbnail.component.js';

/** Funding organism: paged gallery, one inspector and server-planned, explicitly confirmed commands. */
@Component({
  selector: 'openg7-media-review-workspace',
  standalone: true,
  imports: [
    AdminDrawerComponent,
    SponsorMediaUsageEditorComponent,
    FundingModerationActionsComponent,
    MediaReviewThumbnailComponent,
    ContextControllerComponent,
    ContextControllerActionComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-review-workspace.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './media-review-workspace.component.css'
  ]
})
export class MediaReviewWorkspaceComponent {
  readonly contributionId = input.required<string>();
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly busyChange = output<boolean>();
  readonly i18n = inject(FundingI18nService);
  readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly inspector = viewChild<ElementRef<HTMLElement>>('inspector');
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  readonly form = signal<'plan' | 'rules' | 'batch' | 'reject' | null>(null);
  readonly humanReviewed = signal(false);
  readonly inheritRequested = signal(false);
  readonly includesFutureUploads = signal(false);
  readonly rulesScope = signal<MediaRuleScope>('dossier');
  readonly rulesBatch = signal('');
  readonly targetBatch = signal('');
  readonly batchName = signal('');
  readonly rejectReason = signal('');
  readonly rejectExplanation = signal('');
  readonly rejectInternalReason = signal('');
  readonly rejectSingleId = signal<string | null>(null);
  readonly analysisBusy = signal(false);
  readonly analysisReadLoading = signal(false);
  readonly analysisReceiptRequest = signal<{
    contributionId: string;
    requestId: string;
  } | null>(null);
  readonly analysisStop = signal(false);
  readonly analysisProgress = signal<{
    completed: number;
    total: number;
  } | null>(null);
  readonly workspaceVisible = signal(false);
  readonly documentVisible = signal(true);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly analysisPolls = signal(0);
  readonly analysisError = signal(false);
  readonly analysisRuns = signal<readonly SponsorMediaAnalysisRun[]>([]);
  readonly analysisCapabilities = signal('not_configured');
  readonly uploading = signal(false);
  readonly uploadKind = signal<SponsorMediaKind>('supporting_image');
  readonly uploadResult = signal<{ received: number; failed: number } | null>(
    null
  );
  readonly history = signal<MediaReviewHistoryResponse | null>(null);
  readonly historyLoading = signal(false);
  readonly historyError = signal(false);
  readonly classifications = SPONSOR_MEDIA_CLASSIFICATIONS;
  readonly reasons = MODERATION_REASONS.filter((reason) =>
    reason.allowedLevels.includes('N3')
  );
  readonly filters: readonly MediaReviewFilter[] = [
    'all',
    'ready',
    'needs_review',
    'blocked',
    'approved',
    'rejected'
  ];
  readonly c = new MediaReviewWorkspaceController({
    admin: this.admin,
    permitted: () =>
      !this.disabled() &&
      !this.analysisBusy() &&
      !this.uploading() &&
      this.admin.identity()?.role !== 'reader',
    changed: () => this.changed.emit(),
    unauthorized: () => {
      this.admin.clearAdminSession();
      void this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
      });
    }
  });
  readonly thumbnails = new MediaPreviewCollection((id) =>
    this.admin.mediaThumbnail(id)
  );
  private readonly fullPreview = new BlobPreviewResource();
  readonly previewUrl = this.fullPreview.url;
  readonly previewFailed = signal(false);
  readonly run = computed(
    () =>
      this.analysisRuns().find((run) => run.assetId === this.c.inspectedId()) ??
      null
  );
  readonly classification = computed(() => {
    const asset = this.c.inspected();
    return asset ? this.c.draft(asset).classification : 'unknown';
  });
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
        this.c.inspected() && this.c.inspected()?.readiness.state !== 'blocked'
          ? 1
          : 0,
      canReview: this.c.canWrite(),
      busy: this.c.busy() || this.analysisBusy()
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
  private generation = 0;
  private analysisEpoch = 0;
  private analysisRead = 0;
  private languageGeneration = 0;
  private destroyed = false;

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() => {
        void this.loadLanguage(language);
      });
    });
    effect(() => {
      const id = this.contributionId(),
        session = this.admin.sessionGeneration();
      untracked(() => {
        void session;
        this.generation++;
        this.analysisEpoch++;
        this.analysisRead++;
        this.c.setScope('');
        this.c.setScope(id);
        this.thumbnails.clear();
        this.fullPreview.clear();
        this.form.set(null);
        this.analysisRuns.set([]);
        this.analysisReceiptRequest.set(null);
        this.analysisStop.set(false);
        this.analysisProgress.set(null);
        this.analysisPolls.set(0);
        this.analysisReadLoading.set(false);
        this.history.set(null);
        this.historyError.set(false);
        this.uploading.set(false);
        this.analysisBusy.set(false);
        this.uploadResult.set(null);
        if (this.browser) {
          void this.c.load();
          void this.loadAnalyses();
        }
      });
    });
    effect(() => {
      const asset = this.c.inspected(),
        id = asset?.id,
        version = asset?.version;
      untracked(() => {
        this.history.set(null);
        this.historyError.set(false);
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
        run = this.run();
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
        this.c.busy() || this.analysisBusy() || this.uploading()
      )
    );
    effect((cleanup) => {
      const processing = this.analysisRuns().some(
        (run) => run.state === 'queued' || run.state === 'processing'
      );
      if (
        !this.browser ||
        !processing ||
        !this.workspaceVisible() ||
        !this.documentVisible() ||
        this.analysisPolls() >= 30 ||
        this.analysisReadLoading() ||
        this.analysisBusy()
      )
        return;
      const timer = setTimeout(() => {
        this.analysisPolls.update((count) => count + 1);
        if (!this.c.busy()) void this.loadAnalyses();
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
      this.generation++;
      this.c.dispose();
      this.thumbnails.dispose();
      this.fullPreview.dispose();
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
      'MEDIA_HUMAN_REVIEW_REQUIRED'
    ];
    return this.t('reasons.' + (known.includes(reason) ? reason : 'other'));
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
  rulesSummary(): string {
    const rule = this.c.data()?.rules.find((rule) => rule.scope === 'dossier');
    return rule
      ? this.usageSummary({ usage: rule.usage })
      : this.t('noDefaults');
  }
  analysisFor(id: string): SponsorMediaAnalysisRun | undefined {
    return this.analysisRuns().find((run) => run.assetId === id);
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
      reviewableCount: assets.filter(
        (asset) => asset.readiness.state !== 'blocked'
      ).length,
      canReview: this.c.canWrite(),
      busy: this.c.busy() || this.analysisBusy() || this.uploading()
    }).some((action) => action.id === id && action.enabled);
  }
  changeClassification(event: Event): void {
    const value = this.value(event);
    if (this.classifications.includes(value as SponsorMediaClassification)) {
      const asset = this.c.inspected();
      if (asset)
        this.c.edit(asset, {
          classification: value as SponsorMediaClassification
        });
    }
  }
  changeScope(event: Event): void {
    const value = this.value(event);
    if (value === 'dossier' || value === 'batch' || value === 'media')
      this.rulesScope.set(value);
  }
  async reconcile(): Promise<void> {
    const pending = this.analysisReceiptRequest(),
      generation = this.generation;
    if (pending) {
      if (this.analysisBusy()) return;
      this.analysisBusy.set(true);
      try {
        const receipt = await this.admin.getSponsorMediaAnalysisReceipt(
          pending.contributionId,
          pending.requestId
        );
        if (this.destroyed || generation !== this.generation) return;
        if (!receipt.found) {
          this.c.notice.set('noReceipt');
          return;
        }
        this.analysisReceiptRequest.set(null);
        this.c.uncertain.set(false);
        this.c.error.set('');
        this.c.notice.set('reconciled');
        await this.refresh();
        this.changed.emit();
      } catch {
        if (!this.destroyed && generation === this.generation)
          this.analysisError.set(true);
      } finally {
        if (!this.destroyed && generation === this.generation)
          this.analysisBusy.set(false);
      }
      return;
    }
    await this.c.reconcile();
    if (!this.c.uncertain()) this.form.set(null);
  }
  setFilter(filter: MediaReviewFilter): void {
    this.c.filter.set(filter);
    this.c.page.set(1);
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
    await Promise.all([this.c.load(), this.loadAnalyses()]);
  }
  async prepare(
    action: SponsorMediaBatchAction,
    single?: SponsorMediaWorkspaceAsset
  ): Promise<void> {
    this.humanReviewed.set(false);
    await this.c.prepare(
      action,
      action === 'move' ? { targetBatchId: this.targetBatch() || null } : {},
      single
    );
    if (this.c.plan()) this.form.set('plan');
  }
  openReject(single?: SponsorMediaWorkspaceAsset): void {
    this.rejectSingleId.set(single?.id ?? null);
    this.rejectReason.set('');
    this.rejectExplanation.set('');
    this.rejectInternalReason.set('');
    this.form.set('reject');
  }
  async prepareReject(): Promise<void> {
    if (!this.rejectReason() || !this.rejectExplanation().trim()) return;
    const single = this.c
      .assets()
      .find((asset) => asset.id === this.rejectSingleId());
    const reason = this.reasons.find(
      (reason) => reason.code === this.rejectReason()
    );
    if (!reason) return;
    await this.c.prepare(
      'reject',
      {
        reason: reason.code,
        sponsorExplanation: this.rejectExplanation().trim(),
        internalReason: this.rejectInternalReason().trim()
      },
      single
    );
    this.humanReviewed.set(false);
    if (this.c.plan()) this.form.set('plan');
  }
  async execute(): Promise<void> {
    if (!this.humanReviewed()) return;
    await this.c.execute();
    if (!this.c.plan()) this.form.set(null);
  }
  closeForm(): void {
    if (this.c.busy()) return;
    this.form.set(null);
    this.c.plan.set(null);
    this.humanReviewed.set(false);
  }
  openRules(scope: MediaRuleScope = 'dossier'): void {
    this.inheritRequested.set(false);
    this.includesFutureUploads.set(false);
    this.rulesScope.set(scope);
    this.rulesBatch.set(
      this.c.inspected()?.batchId ?? this.c.data()?.batches[0]?.id ?? ''
    );
    this.form.set('rules');
  }
  restoreInheritance(asset: SponsorMediaWorkspaceAsset): void {
    this.c.inspectedId.set(asset.id);
    this.openRules('media');
    this.inheritRequested.set(true);
  }
  readonly rulesScopeId = computed(() =>
    this.rulesScope() === 'dossier'
      ? this.contributionId()
      : this.rulesScope() === 'batch'
        ? this.rulesBatch()
        : (this.c.inspectedId() ?? '')
  );
  readonly existingRule = computed(
    () =>
      this.c
        .data()
        ?.rules.find(
          (rule) =>
            rule.scope === this.rulesScope() &&
            rule.scopeId === this.rulesScopeId()
        ) ?? null
  );
  readonly rulesValue = computed(
    () =>
      this.existingRule()?.usage ??
      (this.rulesScope() === 'media'
        ? (this.c.inspected()?.usage ?? null)
        : null)
  );
  readonly coveredAssets = computed(() => {
    if (this.rulesScope() === 'media')
      return this.c.inspected() ? [this.c.inspected()!] : [];
    const assets = this.c.selected().length
      ? this.c.selected()
      : this.c.assets();
    return this.rulesScope() === 'batch'
      ? assets.filter((asset) => asset.batchId === this.rulesBatch())
      : assets;
  });
  async saveRules(
    submission: SponsorMediaUsageSubmission,
    inherit = false
  ): Promise<void> {
    const data = this.c.data(),
      scopeId = this.rulesScopeId();
    if (
      !data ||
      !scopeId ||
      !submission.evidenceReference ||
      (!this.coveredAssets().length && !this.includesFutureUploads())
    )
      return;
    const saved = await this.c.saveRules({
      requestId: crypto.randomUUID(),
      contributionId: data.contributionId,
      expectedRevision: data.revision,
      scope: this.rulesScope(),
      scopeId,
      usage: inherit ? null : submission.usage,
      evidenceReference: submission.evidenceReference,
      coveredAssetIds: this.coveredAssets().map((asset) => asset.id),
      ...(this.includesFutureUploads() && this.rulesScope() !== 'media'
        ? { includesFutureUploads: true }
        : {}),
      confirmation: scopeId
    });
    if (saved) this.form.set(null);
  }
  async createBatch(): Promise<void> {
    const data = this.c.data();
    if (!data || !this.batchName().trim()) return;
    if (
      await this.c.createBatch({
        requestId: crypto.randomUUID(),
        contributionId: data.contributionId,
        expectedRevision: data.revision,
        name: this.batchName().trim(),
        confirmation: data.contributionId
      })
    ) {
      this.form.set(null);
      this.batchName.set('');
    }
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
    if (request.actionId === 'approve') void this.prepare('approve', asset);
    else if (request.actionId === 'reject') this.openReject(asset);
    else if (request.actionId === 'permissions') this.openRules('media');
    else if (request.actionId === 'preview')
      this.inspector()
        ?.nativeElement.querySelector<HTMLElement>(
          '[data-og7="media-full-preview"]'
        )
        ?.focus();
  }
  async loadAnalyses(): Promise<void> {
    const generation = this.generation,
      epoch = this.analysisEpoch,
      read = ++this.analysisRead,
      id = this.contributionId();
    this.analysisReadLoading.set(true);
    try {
      const response = await this.admin.getSponsorMediaAnalyses(id);
      if (
        this.destroyed ||
        generation !== this.generation ||
        epoch !== this.analysisEpoch ||
        read !== this.analysisRead
      )
        return;
      this.analysisRuns.set(response.runs);
      this.analysisCapabilities.set(response.capabilities.vision);
      this.analysisError.set(false);
    } catch {
      if (
        !this.destroyed &&
        generation === this.generation &&
        epoch === this.analysisEpoch &&
        read === this.analysisRead
      )
        this.analysisError.set(true);
    } finally {
      if (
        !this.destroyed &&
        generation === this.generation &&
        read === this.analysisRead
      )
        this.analysisReadLoading.set(false);
    }
  }
  private applyAnalysisMutation(response: SponsorMediaAnalysisResponse): void {
    // A read started before this mutation cannot replace its confirmed response.
    this.analysisEpoch++;
    this.analysisRuns.set(response.runs);
    this.analysisCapabilities.set(response.capabilities.vision);
    this.analysisError.set(false);
  }
  async analyze(): Promise<void> {
    const asset = this.c.inspected();
    if (asset) await this.startAnalyses([asset]);
  }
  async analyzeSelection(): Promise<void> {
    await this.startAnalyses(this.c.selected());
  }
  private async startAnalyses(
    assets: readonly SponsorMediaWorkspaceAsset[]
  ): Promise<void> {
    if (!assets.length || !this.c.canWrite()) return;
    const generation = this.generation;
    this.analysisBusy.set(true);
    this.analysisError.set(false);
    this.analysisStop.set(false);
    this.analysisPolls.set(0);
    this.analysisProgress.set({ completed: 0, total: assets.length });
    try {
      for (const asset of assets) {
        if (
          this.destroyed ||
          generation !== this.generation ||
          this.analysisStop()
        )
          break;
        const request = {
          requestId: crypto.randomUUID(),
          contributionId: asset.contributionId,
          assetId: asset.id,
          expectedVersion: asset.version,
          rerun: !!this.analysisFor(asset.id)
        };
        try {
          this.analysisEpoch++;
          const response = await this.admin.startSponsorMediaAnalysis(request);
          if (this.destroyed || generation !== this.generation) return;
          this.applyAnalysisMutation(response);
          this.analysisProgress.update((progress) =>
            progress ? { ...progress, completed: progress.completed + 1 } : null
          );
        } catch (error) {
          if (this.destroyed || generation !== this.generation) return;
          this.analysisError.set(true);
          if (
            !(error instanceof AdminDashboardRequestError) ||
            error.status >= 500
          ) {
            this.analysisReceiptRequest.set({
              contributionId: asset.contributionId,
              requestId: request.requestId
            });
            this.c.uncertain.set(true);
            this.c.error.set('uncertain');
            await this.loadAnalyses();
            break;
          }
          if (
            error.status === 401 ||
            error.status === 403 ||
            error.status === 429
          )
            break;
        }
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.analysisBusy.set(false);
    }
  }
  prefill(): void {
    const asset = this.c.inspected();
    if (!asset || !this.c.canWrite()) return;
    const draft = sponsorMediaAnalysisPrefill(
      this.run(),
      !this.c.drafts()[asset.id]
    );
    if (draft) {
      this.c.edit(asset, {
        altText: draft.altText ?? this.c.draft(asset).altText,
        classification: draft.classification
      });
    }
  }
  async reviewAnalysis(decision: 'save' | 'reject' | 'accept'): Promise<void> {
    const asset = this.c.inspected(),
      run = this.run(),
      generation = this.generation;
    if (
      !asset ||
      !run ||
      !this.c.canWrite() ||
      run.stale ||
      run.state !== 'succeeded' ||
      (run.review && run.review.decision !== 'saved')
    )
      return;
    this.analysisBusy.set(true);
    this.analysisError.set(false);
    const requestId = crypto.randomUUID();
    try {
      this.analysisEpoch++;
      const response = await this.admin.reviewSponsorMediaAnalysis({
        requestId,
        contributionId: asset.contributionId,
        runId: run.id,
        expectedVersion: asset.version,
        expectedReviewVersion: run.review?.version ?? 0,
        decision,
        confirmation: asset.id,
        draft: {
          altText: this.c.draft(asset).altText.trim() || null,
          classification: this.classification()
        }
      });
      if (!this.destroyed && generation === this.generation) {
        this.applyAnalysisMutation(response);
        await this.refresh();
        this.changed.emit();
      }
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.analysisError.set(true);
        if (
          !(error instanceof AdminDashboardRequestError) ||
          error.status >= 500
        ) {
          this.analysisReceiptRequest.set({
            contributionId: asset.contributionId,
            requestId
          });
          this.c.uncertain.set(true);
          this.c.error.set('uncertain');
        }
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.analysisBusy.set(false);
    }
  }
  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      files = Array.from(input.files ?? []).slice(0, 100);
    input.value = '';
    if (!files.length || !this.c.canWrite()) return;
    const generation = this.generation,
      contributionId = this.contributionId(),
      kind = this.uploadKind();
    this.uploading.set(true);
    this.uploadResult.set(null);
    let received = 0,
      failed = 0;
    try {
      for (const file of files) {
        if (this.destroyed || generation !== this.generation) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          failed++;
          continue;
        }
        const requestId = crypto.randomUUID();
        try {
          const result = await this.admin.mediaUpload(
            contributionId,
            kind,
            file,
            requestId
          );
          if (!result.uploaded) throw new Error('Unconfirmed upload.');
          received++;
        } catch (error) {
          failed++;
          if (
            !this.destroyed &&
            generation === this.generation &&
            (!(error instanceof AdminDashboardRequestError) ||
              error.status >= 500)
          ) {
            this.c.uncertainRequest.set(requestId);
            this.c.uncertain.set(true);
            this.c.error.set('uncertain');
            break;
          }
          if (
            error instanceof AdminDashboardRequestError &&
            (error.status === 401 || error.status === 403)
          )
            break;
        }
      }
      if (!this.destroyed && generation === this.generation) {
        this.uploadResult.set({ received, failed });
        await this.refresh();
        this.changed.emit();
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.uploading.set(false);
    }
  }
  historyOpened(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.history())
      void this.loadHistory();
  }
  async loadHistory(more = false): Promise<void> {
    const asset = this.c.inspected(),
      generation = this.generation,
      cursor = more ? this.history()?.nextCursor : null;
    if (
      !asset ||
      this.historyLoading() ||
      this.admin.identity()?.role === 'reader'
    )
      return;
    this.historyLoading.set(true);
    this.historyError.set(false);
    try {
      const history = await this.admin.mediaHistory(
        asset.contributionId,
        asset.id,
        cursor ?? undefined
      );
      if (
        !this.destroyed &&
        generation === this.generation &&
        this.c.inspectedId() === asset.id
      )
        this.history.set(
          more
            ? {
                ...history,
                entries: [
                  ...(this.history()?.entries ?? []),
                  ...history.entries
                ]
              }
            : history
        );
    } catch {
      if (!this.destroyed && generation === this.generation)
        this.historyError.set(true);
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.historyLoading.set(false);
    }
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
