import type { ResponsibilityBalance } from './admin-responsibility-balance.js';
import type { SponsorshipOfferSnapshot } from './sponsorship-offers.js';

export interface AdminPreparationApproval {
  readonly id: string;
  readonly runId: string | null;
  readonly contributionId: string;
  readonly version: string;
  readonly actor: string;
  readonly approvedAt: string;
  readonly requestId: string;
  readonly auditReference: string;
}

export interface AdminPreparationCheck {
  readonly code: string;
  readonly state: 'complete' | 'missing' | 'not_required';
}

/** Exact private content being reviewed; this grants no publication authority. */
export interface AdminPreparationDraft {
  readonly id: string;
  readonly kind: 'website' | 'publication';
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly channel: 'website' | 'facebook' | 'linkedin';
  readonly target: 'openg7' | 'openg20';
  readonly status: string;
  readonly adminUrl: string;
}

/** Common private preparation facts, independent from batch navigation. */
export interface AdminPreparationReceiptData {
  readonly contributionId: string;
  readonly reference: string;
  /** Digest of current determining facts, exact content and authorizations. */
  readonly version: string;
  readonly status: 'ready' | 'incomplete' | 'approved' | 'review_required';
  readonly payment: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly status: string;
    readonly confirmedAt: string | null;
  };
  readonly acceptedOffer: SponsorshipOfferSnapshot | null;
  readonly balance: ResponsibilityBalance | null;
  readonly checks: readonly AdminPreparationCheck[];
  readonly authorizations: readonly AdminPreparationCheck[];
  readonly drafts: readonly AdminPreparationDraft[];
  readonly blockers: readonly {
    readonly code: string;
    readonly adminUrl: string | null;
  }[];
  readonly canApprove: boolean;
  readonly approval: AdminPreparationApproval | null;
  readonly approvalHistory: readonly AdminPreparationApproval[];
}

export interface AdminPreparationReceipt extends AdminPreparationReceiptData {
  readonly runId: string;
  /** Frozen manifest position; independent from processing progress. */
  readonly position: number;
  readonly totalCount: number;
  readonly processedCount: number;
}

/** A dossier read never creates or advances a batch. */
export interface AdminDossierPreparationReceipt extends AdminPreparationReceiptData {
  readonly context: 'dossier';
}

export interface AdminPreparationApproveRequest {
  readonly runId: string;
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly requestId: string;
  readonly confirmed: true;
}

export type AdminDossierPreparationApproveRequest = Omit<
  AdminPreparationApproveRequest,
  'runId'
>;
