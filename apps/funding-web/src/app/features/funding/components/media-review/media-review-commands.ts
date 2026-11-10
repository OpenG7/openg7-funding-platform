import { computed, signal } from '@angular/core';
import {
  MODERATION_REASONS,
  MODERATION_EDITORIAL_PROVISIONS,
  SPONSOR_MEDIA_USAGE_CHANNELS,
  SPONSOR_MEDIA_USAGE_TARGETS,
  type MediaRuleScope,
  type SponsorMediaBatchAction,
  type SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import type {
  SponsorMediaUsageScope,
  SponsorMediaUsageSubmission
} from '../sponsor-media-usage/sponsor-media-usage-editor.component.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

interface MediaReviewPermissions {
  readonly id: string;
  readonly contributionId: string;
  readonly version: string;
  readonly revision: string;
  readonly originalFilename: string;
}

interface MediaAcceptanceReviewContext {
  readonly id: string;
  readonly contributionId: string;
  readonly version: string;
  readonly revision: string;
  readonly acceptanceId: string;
}

/** Form state and exact-manifest confirmation for this workspace's existing commands. */
export class MediaReviewCommands {
  readonly form = signal<
    'plan' | 'rules' | 'batch' | 'reject' | 'review' | null
  >(null);
  readonly reviewPermissions = signal<MediaReviewPermissions | null>(null);
  readonly acceptedReview = signal<MediaAcceptanceReviewContext | null>(null);
  readonly reviewSubmitting = signal(false);
  private reviewSerial = 0;
  readonly acceptedReviewAsset = computed(() => {
    const target = this.acceptedReview(),
      data = this.c.data();
    return target &&
      this.c.inspected()?.id === target.id &&
      data?.contributionId === target.contributionId &&
      data.revision === target.revision
      ? (data.assets.find(
          (asset) =>
            asset.id === target.id &&
            asset.version === target.version &&
            asset.usageAcceptance?.id === target.acceptanceId &&
            asset.usage?.state === 'confirmed'
        ) ?? null)
      : null;
  });
  readonly canApproveAcceptedReview = computed(() => {
    const asset = this.acceptedReviewAsset();
    if (
      this.form() !== 'review' ||
      !asset ||
      !this.c.canWrite() ||
      this.reviewSubmitting()
    )
      return false;
    const draft = this.c.draft(asset);
    return (
      asset.readiness.state !== 'blocked' &&
      !!draft.altText.trim() &&
      draft.altText.trim().length <= 300 &&
      (!asset.usage?.restrictions ||
        asset.usageRestrictionsReviewed ||
        draft.restrictions)
    );
  });
  readonly humanReviewed = signal(false);
  readonly inheritRequested = signal(false);
  readonly includesFutureUploads = signal(false);
  readonly rulesScope = signal<MediaRuleScope>('dossier');
  readonly rulesSuggestedScope = signal<SponsorMediaUsageScope | null>(null);
  readonly rulesBatch = signal('');
  readonly targetBatch = signal('');
  readonly batchName = signal('');
  readonly rejectReason = signal('');
  readonly rejectExplanation = signal('');
  readonly rejectInternalReason = signal('');
  readonly rejectSingleId = signal<string | null>(null);
  readonly editorialProvision = signal('');
  readonly provisions = MODERATION_EDITORIAL_PROVISIONS;
  readonly decisionAction = signal<'reject' | 'request_correction'>('reject');
  readonly reasons = computed(() =>
    MODERATION_REASONS.filter((reason) =>
      reason.allowedLevels.includes(
        this.decisionAction() === 'request_correction' ? 'N1' : 'N3'
      )
    )
  );
  constructor(
    readonly c: MediaReviewWorkspaceController,
    private readonly contributionId: () => string,
    private readonly reviewReady?: (
      asset: Pick<SponsorMediaWorkspaceAsset, 'id' | 'contributionId'>
    ) => void
  ) {}
  changeScope(event: Event): void {
    if (this.reviewPermissions()) return;
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'dossier' || value === 'batch' || value === 'media')
      this.rulesScope.set(value);
  }
  reset(): void {
    this.form.set(null);
    this.reviewPermissions.set(null);
    this.clearAcceptedReview();
  }
  private clearAcceptedReview(): void {
    ++this.reviewSerial;
    this.acceptedReview.set(null);
    this.reviewSubmitting.set(false);
  }
  openAcceptedReview(asset: SponsorMediaWorkspaceAsset): void {
    const data = this.c.data(),
      current = this.c.inspected();
    if (
      !data ||
      !this.c.canWrite() ||
      current?.id !== asset.id ||
      current.version !== asset.version ||
      asset.contributionId !== data.contributionId ||
      data.contributionId !== this.contributionId() ||
      asset.usage?.state !== 'confirmed' ||
      asset.usageAcceptance?.source !== 'platform_acceptance' ||
      asset.readiness.state === 'blocked'
    )
      return;
    this.reset();
    this.c.plan.set(null);
    this.humanReviewed.set(false);
    this.acceptedReview.set({
      id: asset.id,
      contributionId: data.contributionId,
      version: asset.version,
      revision: data.revision,
      acceptanceId: asset.usageAcceptance.id
    });
    this.form.set('review');
  }
  async approveAcceptedReview(): Promise<void> {
    const target = this.acceptedReview(),
      asset = this.acceptedReviewAsset();
    if (!target || !asset || !this.canApproveAcceptedReview()) return;
    const ticket = ++this.reviewSerial;
    const altText = this.c.draft(asset).altText.trim();
    const restrictions = this.c.draft(asset).restrictions;
    this.reviewSubmitting.set(true);
    try {
      await this.c.prepare('approve', {}, asset);
      const plan = this.c.plan(),
        candidate = plan?.assets[0];
      if (ticket !== this.reviewSerial || this.acceptedReview() !== target)
        return;
      if (!this.acceptedReviewAsset()) {
        this.c.plan.set(null);
        if (!this.c.error()) this.c.error.set('changed');
        return;
      }
      if (!plan) return;
      if (
        !this.c.canWrite() ||
        plan.action !== 'approve' ||
        plan.contributionId !== target.contributionId ||
        plan.revision !== target.revision ||
        plan.assets.length !== 1 ||
        candidate?.id !== target.id ||
        candidate.version !== target.version ||
        candidate.altText !== altText ||
        candidate.usageAcceptance?.id !== target.acceptanceId ||
        this.c.draft(asset).altText.trim() !== altText ||
        JSON.stringify(candidate.usage) !== JSON.stringify(asset.usage) ||
        this.c.draft(asset).restrictions !== restrictions
      ) {
        this.c.plan.set(null);
        this.c.error.set('changed');
        return;
      }
      if (plan.blocked.length) return;
      // The explicit review-panel button confirms this displayed file and its exact metadata.
      this.humanReviewed.set(true);
      await this.c.execute();
      if (
        ticket === this.reviewSerial &&
        this.acceptedReview() === target &&
        !this.c.plan()
      )
        this.reset();
    } finally {
      if (ticket === this.reviewSerial) this.reviewSubmitting.set(false);
    }
  }
  async prepare(
    action: SponsorMediaBatchAction,
    single?: SponsorMediaWorkspaceAsset
  ): Promise<void> {
    this.clearAcceptedReview();
    this.reviewPermissions.set(null);
    this.humanReviewed.set(false);
    await this.c.prepare(
      action,
      action === 'move' ? { targetBatchId: this.targetBatch() || null } : {},
      single
    );
    if (this.c.plan()) this.form.set('plan');
  }
  openReject(single?: SponsorMediaWorkspaceAsset): void {
    this.openDecision('reject', single);
  }
  openCorrection(single?: SponsorMediaWorkspaceAsset): void {
    this.openDecision('request_correction', single);
  }
  private openDecision(
    action: 'reject' | 'request_correction',
    single?: SponsorMediaWorkspaceAsset
  ): void {
    this.clearAcceptedReview();
    this.reviewPermissions.set(null);
    this.decisionAction.set(action);
    this.rejectSingleId.set(single?.id ?? null);
    this.rejectReason.set('');
    this.rejectExplanation.set('');
    this.rejectInternalReason.set('');
    this.editorialProvision.set('');
    this.form.set('reject');
  }
  async prepareReject(): Promise<void> {
    if (
      !this.rejectReason() ||
      !this.rejectExplanation().trim() ||
      !this.rejectInternalReason().trim()
    )
      return;
    const single = this.c
      .assets()
      .find((asset) => asset.id === this.rejectSingleId());
    const reason = this.reasons().find(
      (reason) => reason.code === this.rejectReason()
    );
    if (
      !reason ||
      (reason.code === 'EDITORIAL_INCOMPATIBILITY' &&
        !this.provisions.some(
          (provision) => provision.id === this.editorialProvision()
        ))
    )
      return;
    await this.c.prepare(
      this.decisionAction(),
      {
        reason: reason.code,
        sponsorExplanation: this.rejectExplanation().trim(),
        internalReason: this.rejectInternalReason().trim(),
        ...(reason.code === 'EDITORIAL_INCOMPATIBILITY'
          ? { editorialProvision: this.editorialProvision() }
          : {})
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
    if (this.c.busy() || this.reviewSubmitting()) return;
    this.clearAcceptedReview();
    this.form.set(null);
    this.reviewPermissions.set(null);
    this.c.plan.set(null);
    this.humanReviewed.set(false);
  }
  openRules(scope: MediaRuleScope = 'dossier'): void {
    this.clearAcceptedReview();
    this.reviewPermissions.set(null);
    this.inheritRequested.set(false);
    this.includesFutureUploads.set(false);
    this.rulesScope.set(scope);
    // Keep suggestions stable if the service projection refreshes while editing.
    const obligations = (this.c.data()?.preparationObligations ?? []).filter(
      (obligation) => obligation.acceptsMedia
    );
    this.rulesSuggestedScope.set(
      obligations.length
        ? {
            channels: SPONSOR_MEDIA_USAGE_CHANNELS.filter((channel) =>
              obligations.some((obligation) => obligation.channel === channel)
            ),
            targets: SPONSOR_MEDIA_USAGE_TARGETS.filter((target) =>
              obligations.some((obligation) => obligation.target === target)
            )
          }
        : null
    );
    this.rulesBatch.set(
      this.c.inspected()?.batchId ?? this.c.data()?.batches[0]?.id ?? ''
    );
    this.form.set('rules');
  }
  openReviewPermissions(asset: SponsorMediaWorkspaceAsset): void {
    const data = this.c.data(),
      current = this.c.inspected();
    if (
      !data ||
      !this.c.canWrite() ||
      data.contributionId !== this.contributionId() ||
      current?.id !== asset.id ||
      current.contributionId !== data.contributionId ||
      current.version !== asset.version ||
      current.reviewStatus === 'rejected' ||
      current.usage?.state === 'withdrawn' ||
      current.readiness.state !== 'blocked' ||
      !current.readiness.reasons.length ||
      !current.readiness.reasons.every(
        (reason) => reason === 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
      )
    )
      return;
    this.openRules('media');
    this.humanReviewed.set(false);
    this.reviewPermissions.set({
      id: current.id,
      contributionId: current.contributionId,
      version: current.version,
      revision: data.revision,
      originalFilename: current.originalFilename
    });
  }
  restoreInheritance(asset: SponsorMediaWorkspaceAsset): void {
    this.c.inspectedId.set(asset.id);
    this.openRules('media');
    this.rulesSuggestedScope.set(null);
    this.inheritRequested.set(true);
  }
  readonly rulesScopeId = computed(
    () =>
      this.reviewPermissions()?.id ??
      (this.rulesScope() === 'dossier'
        ? this.contributionId()
        : this.rulesScope() === 'batch'
          ? this.rulesBatch()
          : (this.c.inspectedId() ?? ''))
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
      (this.reviewPermissions()
        ? (this.coveredAssets()[0]?.usage ?? null)
        : this.rulesScope() === 'media'
          ? (this.c.inspected()?.usage ?? null)
          : null)
  );
  readonly coveredAssets = computed(() => {
    const review = this.reviewPermissions();
    if (review)
      return this.c
        .assets()
        .filter(
          (asset) =>
            asset.id === review.id &&
            asset.contributionId === review.contributionId
        );
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
      scopeId = this.rulesScopeId(),
      review = this.reviewPermissions();
    if (
      review &&
      (!this.currentReviewPermissions(review) ||
        data?.revision !== review.revision ||
        this.c.inspected()?.version !== review.version ||
        inherit)
    ) {
      this.c.error.set('changed');
      return;
    }
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
    if (!saved) return;
    const continueReview =
      review !== null && this.currentReviewPermissions(review);
    if (review && this.reviewPermissions() !== review) return;
    this.form.set(null);
    this.reviewPermissions.set(null);
    // The view waits for the parent refresh to finish before restoring focus.
    if (continueReview)
      this.reviewReady?.({
        id: review.id,
        contributionId: review.contributionId
      });
  }
  private currentReviewPermissions(review: MediaReviewPermissions): boolean {
    const asset = this.c.inspected();
    return (
      this.reviewPermissions() === review &&
      this.form() === 'rules' &&
      this.rulesScope() === 'media' &&
      !this.inheritRequested() &&
      !this.includesFutureUploads() &&
      this.contributionId() === review.contributionId &&
      this.c.data()?.contributionId === review.contributionId &&
      asset?.id === review.id &&
      asset.contributionId === review.contributionId
    );
  }
  async createBatch(): Promise<void> {
    this.clearAcceptedReview();
    this.reviewPermissions.set(null);
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
}
