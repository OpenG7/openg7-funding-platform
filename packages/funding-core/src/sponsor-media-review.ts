import type {
  ModerationCaseState,
  ModerationLevel,
  ModerationReasonCode
} from './moderation.js';
import type { SponsorMediaAsset } from './sponsor-media.js';
import type { SponsorMediaUsageRights } from './sponsor-media-usage.js';

export const MEDIA_REVIEW_MAX_SELECTION = 100;
export type MediaReadiness = 'ready' | 'needs_review' | 'blocked';
export type MediaRuleScope = 'dossier' | 'batch' | 'media';
export interface MediaReadinessResult {
  readonly state: MediaReadiness;
  readonly reasons: readonly string[];
}
export interface SponsorMediaRule {
  readonly id: string;
  readonly scope: MediaRuleScope;
  readonly scopeId: string;
  readonly revision: number;
  readonly usage: SponsorMediaUsageRights;
  /** Evidence remains private; the public and sponsor projections omit it. */
  readonly evidenceReference?: string;
  readonly coveredAssetIds: readonly string[];
  readonly includesFutureUploads?: boolean;
}
export interface SponsorMediaBatch {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}
export interface SponsorMediaWorkspaceAsset extends SponsorMediaAsset {
  readonly batchId: string | null;
  readonly usageSource: MediaRuleScope;
  readonly ruleId: string | null;
  readonly readiness: MediaReadinessResult;
  readonly moderation: {
    readonly state: ModerationCaseState | null;
    readonly level: ModerationLevel | null;
    readonly contentVersion: number;
    readonly fingerprint: string;
    readonly currentDecisionId: string | null;
  };
  readonly websiteSelected: boolean;
}
export interface SponsorMediaWorkspace {
  readonly contributionId: string;
  readonly revision: string;
  readonly assets: readonly SponsorMediaWorkspaceAsset[];
  readonly rules: readonly SponsorMediaRule[];
  readonly batches: readonly SponsorMediaBatch[];
  readonly writable: boolean;
}
export interface SponsorMediaRuleRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedRevision: string;
  readonly scope: MediaRuleScope;
  readonly scopeId: string;
  /** null explicitly restores inheritance; withdrawal is a separate, sticky fact. */
  readonly usage: SponsorMediaUsageRights | null;
  readonly evidenceReference: string;
  readonly coveredAssetIds: readonly string[];
  readonly includesFutureUploads?: boolean;
  readonly confirmation: string;
}
export interface SponsorMediaBatchRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedRevision: string;
  readonly name: string;
  readonly confirmation: string;
}
export type SponsorMediaBatchAction =
  | 'approve'
  | 'reject'
  | 'delete'
  | 'move'
  | 'rules'
  | 'website_select'
  | 'website_deselect';
export interface SponsorMediaBatchPlanRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedRevision: string;
  readonly action: SponsorMediaBatchAction;
  readonly assets: readonly {
    readonly id: string;
    readonly version: string;
    readonly altText?: string | null;
    readonly usageRestrictionsConfirmed?: true;
  }[];
  readonly targetBatchId?: string | null;
  readonly ruleId?: string | null;
  readonly reason?: ModerationReasonCode;
  readonly internalReason?: string;
  readonly sponsorExplanation?: string;
}
export interface SponsorMediaBatchPlan {
  readonly id: string;
  readonly contributionId: string;
  readonly action: SponsorMediaBatchAction;
  readonly revision: string;
  readonly expiresAt: string;
  readonly assets: readonly SponsorMediaWorkspaceAsset[];
  readonly blocked: readonly {
    readonly id: string;
    readonly reasons: readonly string[];
  }[];
  readonly effects: readonly string[];
}
export interface SponsorMediaBatchExecuteRequest {
  readonly requestId: string;
  readonly planId: string;
  readonly confirmation: string;
  /** The human reviewed the manifest and exact candidate content, including restrictions. */
  readonly humanReviewed: true;
}
export interface SponsorMediaBatchReceipt {
  readonly requestId: string;
  readonly planId: string;
  readonly status: 'completed';
  readonly action: SponsorMediaBatchAction;
  readonly items: readonly {
    readonly id: string;
    readonly version: string;
    readonly result: string;
  }[];
}

/** Review preparation is independent of authorization to publish or website selection. */
export function classifySponsorMedia(input: {
  readonly usage?: SponsorMediaUsageRights;
  readonly restrictionsReviewed?: boolean;
  readonly reviewStatus: SponsorMediaAsset['reviewStatus'];
  readonly altText?: string | null;
  readonly moderationState?: ModerationCaseState | null;
  readonly moderationLevel?: ModerationLevel | null;
  readonly technicalValid?: boolean;
  readonly analysis?: 'complete' | 'unavailable' | 'uncertain' | 'failed';
  readonly humanReviewed?: boolean;
}): MediaReadinessResult {
  const blocked: string[] = [];
  const review: string[] = [];
  if (input.technicalValid === false) blocked.push('MEDIA_INVALID');
  if (
    input.usage?.state !== 'confirmed' ||
    !input.usage.channels.length ||
    !input.usage.targets.length ||
    !input.usage.transformations.includes('technical')
  )
    blocked.push(
      input.usage?.state === 'withdrawn'
        ? 'MEDIA_USAGE_WITHDRAWN'
        : 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
    );
  if (input.reviewStatus === 'rejected') blocked.push('MEDIA_REJECTED');
  if (input.moderationLevel && input.moderationLevel !== 'N0')
    blocked.push('MODERATION_DECISION_REQUIRED');
  if (
    [
      'correction_requested',
      'on_hold',
      'pending_independent_review',
      'rejected',
      'removed'
    ].includes(input.moderationState ?? '')
  )
    blocked.push('MODERATION_RESTRICTED');
  if (input.usage?.restrictions && !input.restrictionsReviewed)
    review.push('MEDIA_RESTRICTIONS_REVIEW_REQUIRED');
  if (!input.altText?.trim()) review.push('MEDIA_ALT_TEXT_REQUIRED');
  if (!input.humanReviewed && input.analysis !== 'complete')
    review.push(
      input.analysis === 'failed'
        ? 'MEDIA_ANALYSIS_FAILED'
        : 'MEDIA_HUMAN_REVIEW_REQUIRED'
    );
  return blocked.length
    ? { state: 'blocked', reasons: blocked }
    : review.length
      ? { state: 'needs_review', reasons: review }
      : { state: 'ready', reasons: [] };
}

/** References avoid copying inherited values; an explicit withdrawal never falls back. */
export function resolveSponsorMediaRules(input: {
  readonly own: SponsorMediaUsageRights | null;
  readonly batch: SponsorMediaUsageRights | null;
  readonly dossier: SponsorMediaUsageRights | null;
}): {
  readonly usage: SponsorMediaUsageRights | null;
  readonly source: MediaRuleScope;
} {
  if (input.own !== null) return { usage: input.own, source: 'media' };
  if (input.batch !== null) return { usage: input.batch, source: 'batch' };
  return { usage: input.dossier, source: 'dossier' };
}
