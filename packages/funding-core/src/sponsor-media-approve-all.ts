import type { SponsorMediaWorkspaceAsset } from './sponsor-media-review.js';

/** Full native dossier inventory; this operation never consumes a filtered UI selection. */
export interface SponsorMediaApproveAllPlanRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedRevision: string;
}

export type SponsorMediaApproveAllClassification =
  'eligible' | 'blocked' | 'already_approved' | 'not_processable';

export interface SponsorMediaApproveAllCandidate {
  readonly asset: SponsorMediaWorkspaceAsset;
  readonly classification: SponsorMediaApproveAllClassification;
  readonly reasons: readonly string[];
}

export interface SponsorMediaApproveAllPlan {
  readonly kind: 'approve_all';
  readonly id: string;
  readonly contributionId: string;
  readonly revision: string;
  readonly expiresAt: string;
  readonly candidates: readonly SponsorMediaApproveAllCandidate[];
  readonly summary: {
    readonly total: number;
    readonly eligible: number;
    readonly blocked: number;
    readonly alreadyApproved: number;
    readonly notProcessable: number;
    readonly authorizationRequired: number;
    readonly consentRequestable: number;
  };
  readonly effects: readonly string[];
}

export interface SponsorMediaApproveAllExecuteRequest {
  readonly requestId: string;
  readonly planId: string;
  readonly confirmation: string;
  /** One explicit human confirmation covers the displayed images, descriptions and restrictions. */
  readonly humanReviewed: true;
}

export interface SponsorMediaApproveAllItemResult {
  readonly id: string;
  readonly originalFilename: string;
  readonly version: string;
  readonly result:
    | 'approved'
    | 'already_approved'
    | 'blocked'
    | 'not_processable'
    | 'failed'
    | 'pending';
  readonly reasons: readonly string[];
}

/** A terminal partial result is distinct from an interrupted operation with unresolved items. */
export interface SponsorMediaApproveAllReceipt {
  readonly kind: 'approve_all';
  readonly requestId: string;
  readonly planId: string;
  readonly contributionId: string;
  readonly status: 'in_progress' | 'completed' | 'partial';
  readonly items: readonly SponsorMediaApproveAllItemResult[];
  readonly summary: {
    readonly total: number;
    readonly approved: number;
    readonly alreadyApproved: number;
    readonly blocked: number;
    readonly notProcessable: number;
    readonly failed: number;
    readonly pending: number;
  };
}

export interface SponsorMediaApproveAllReceiptRequest {
  readonly contributionId: string;
  readonly requestId: string;
}

export type SponsorMediaApproveAllReceiptResponse =
  | { readonly found: false }
  | { readonly found: true; readonly result: SponsorMediaApproveAllReceipt };
