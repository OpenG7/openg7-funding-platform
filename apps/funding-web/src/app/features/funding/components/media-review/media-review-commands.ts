import { computed, signal } from '@angular/core';
import {
  MODERATION_REASONS,
  MODERATION_EDITORIAL_PROVISIONS,
  type SponsorMediaBatchAction,
  type SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

interface MediaAcceptanceReviewContext {
  readonly id: string;
  readonly contributionId: string;
  readonly version: string;
  readonly revision: string;
  readonly acceptanceId: string | null;
}

/** Form state and exact-manifest confirmation for this workspace's existing commands. */
export class MediaReviewCommands {
  readonly form = signal<'plan' | 'batch' | 'reject' | 'review' | null>(null);
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
            (asset.usageAcceptance?.id ?? null) === target.acceptanceId
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
      asset.usage?.state === 'confirmed' &&
      asset.readiness.state !== 'blocked' &&
      !!draft.altText.trim() &&
      draft.altText.trim().length <= 300 &&
      (!asset.usage?.restrictions ||
        asset.usageRestrictionsReviewed ||
        draft.restrictions)
    );
  });
  readonly humanReviewed = signal(false);
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
    private readonly contributionId: () => string
  ) {}
  reset(): void {
    this.form.set(null);
    this.clearAcceptedReview();
  }
  private clearAcceptedReview(): void {
    ++this.reviewSerial;
    this.acceptedReview.set(null);
    this.reviewSubmitting.set(false);
  }
  openAcceptedReview(asset: SponsorMediaWorkspaceAsset): void {
    if (this.reviewSubmitting()) return;
    const data = this.c.data(),
      current = this.c.inspected();
    if (
      !data ||
      current?.id !== asset.id ||
      current.version !== asset.version ||
      asset.contributionId !== data.contributionId ||
      data.contributionId !== this.contributionId()
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
      acceptanceId: asset.usageAcceptance?.id ?? null
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
        (candidate.usageAcceptance?.id ?? null) !== target.acceptanceId ||
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
    this.c.plan.set(null);
    this.humanReviewed.set(false);
  }
  async createBatch(): Promise<void> {
    this.clearAcceptedReview();
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
