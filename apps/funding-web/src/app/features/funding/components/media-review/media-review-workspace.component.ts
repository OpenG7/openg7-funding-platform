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
  getSponsorMediaActions
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
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
import { MediaReviewAnalysis } from './media-review-analysis.js';
import { MediaReviewUpload } from './media-review-upload.js';
import { MediaReviewHistory } from './media-review-history.js';
import { MediaReviewCommands } from './media-review-commands.js';
import { MediaReviewCommandsComponent } from './media-review-commands.component.js';
import { MediaReviewAnalysisComponent } from './media-review-analysis.component.js';
import { MediaReviewHistoryComponent } from './media-review-history.component.js';

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
    ContextControllerActionComponent
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
  readonly headingLevel = input<3 | 4>(3);
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
  readonly workspaceVisible = signal(false);
  readonly documentVisible = signal(true);
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
  readonly thumbnails = new MediaPreviewCollection((id) =>
    this.admin.mediaThumbnail(id)
  );
  private readonly fullPreview = new BlobPreviewResource();
  readonly previewUrl = this.fullPreview.url;
  readonly previewFailed = signal(false);
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
        const authenticated = this.browser && this.admin.hasValidAdminSession();
        this.c.setScope('');
        if (authenticated) this.c.setScope(id);
        this.thumbnails.clear();
        this.fullPreview.clear();
        this.commands.reset();
        this.analysis.reset();
        this.history.reset();
        this.upload.reset();
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
        this.c.busy() || this.analysis.busy() || this.upload.busy()
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
      busy: this.c.busy() || this.analysis.busy() || this.upload.busy()
    }).some((action) => action.id === id && action.enabled);
  }
  async reconcile(): Promise<void> {
    if (this.analysis.receiptRequest()) {
      await this.analysis.reconcile();
      return;
    }
    await this.c.reconcile();
    if (!this.c.uncertain()) this.commands.form.set(null);
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
    if (request.actionId === 'approve')
      void this.commands.prepare('approve', asset);
    else if (request.actionId === 'reject') this.commands.openReject(asset);
    else if (request.actionId === 'permissions')
      this.commands.openRules('media');
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
