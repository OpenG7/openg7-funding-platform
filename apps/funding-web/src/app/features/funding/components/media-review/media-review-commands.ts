import { computed, signal } from '@angular/core';
import {
  MODERATION_REASONS,
  type MediaRuleScope,
  type SponsorMediaBatchAction,
  type SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import type { SponsorMediaUsageSubmission } from '../sponsor-media-usage/sponsor-media-usage-editor.component.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

/** Form state and exact-manifest confirmation for this workspace's existing commands. */
export class MediaReviewCommands {
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
  readonly reasons = MODERATION_REASONS.filter((reason) =>
    reason.allowedLevels.includes('N3')
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
}
