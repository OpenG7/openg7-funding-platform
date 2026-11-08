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

/** Form state and exact-manifest confirmation for this workspace's existing commands. */
export class MediaReviewCommands {
  readonly form = signal<'plan' | 'rules' | 'batch' | 'reject' | null>(null);
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
    private readonly contributionId: () => string
  ) {}
  changeScope(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'dossier' || value === 'batch' || value === 'media')
      this.rulesScope.set(value);
  }
  reset(): void {
    this.form.set(null);
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
    this.openDecision('reject', single);
  }
  openCorrection(single?: SponsorMediaWorkspaceAsset): void {
    this.openDecision('request_correction', single);
  }
  private openDecision(
    action: 'reject' | 'request_correction',
    single?: SponsorMediaWorkspaceAsset
  ): void {
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
    if (this.c.busy()) return;
    this.form.set(null);
    this.c.plan.set(null);
    this.humanReviewed.set(false);
  }
  openRules(scope: MediaRuleScope = 'dossier'): void {
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
  restoreInheritance(asset: SponsorMediaWorkspaceAsset): void {
    this.c.inspectedId.set(asset.id);
    this.openRules('media');
    this.rulesSuggestedScope.set(null);
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
}
