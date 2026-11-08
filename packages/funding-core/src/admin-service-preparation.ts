import type { AdminCampaignItem } from './admin-campaigns.js';
import type {
  AdminDossierPreparationReceipt,
  AdminPreparationCheck,
  AdminPreparationDraft
} from './admin-preparation.js';

export type AdminServicePreparationDecisionKind =
  'approved' | 'correction_requested' | 'rejected';

/** A private preparation decision, never a delivery authorization. */
export interface AdminServicePreparationDecision {
  readonly id: string;
  readonly contributionId: string;
  readonly obligationId: string;
  readonly draftId: string;
  readonly draftVersion: string;
  readonly contentVersion: string;
  readonly decision: AdminServicePreparationDecisionKind;
  readonly reason: string | null;
  readonly actor: string;
  readonly createdAt: string;
  readonly requestId: string;
  readonly auditReference: string;
}

export interface AdminServicePreparationReceipt {
  readonly context: 'service';
  readonly generatedAt: string;
  readonly contributionId: string;
  readonly reference: string;
  readonly companyName: string | null;
  /** Includes the latest decision identity to protect concurrent human decisions. */
  readonly version: string;
  readonly contentVersion: string;
  readonly status:
    | 'not_ready'
    | 'ready'
    | 'blocked'
    | 'approved'
    | 'correction_requested'
    | 'rejected'
    | 'review_required';
  readonly service: AdminCampaignItem;
  readonly siblings: readonly AdminCampaignItem[];
  readonly draft: AdminPreparationDraft | null;
  readonly dossier: AdminDossierPreparationReceipt;
  readonly checks: readonly AdminPreparationCheck[];
  readonly blockers: readonly string[];
  readonly canApprove: boolean;
  readonly canDecide: boolean;
  readonly decision: AdminServicePreparationDecision | null;
  readonly history: readonly AdminServicePreparationDecision[];
  readonly provenance: {
    readonly origin: 'funding';
    readonly preflightLink: 'unverified';
    readonly preparedAt: string | null;
  };
  readonly links: {
    readonly dossier: string;
    readonly media: string;
    readonly edit: string | null;
    readonly delivery: string | null;
    readonly evidence: string;
  };
}

export interface AdminServicePreparationDecisionRequest {
  readonly contributionId: string;
  readonly obligationId: string;
  readonly expectedVersion: string;
  readonly requestId: string;
  readonly confirmed: true;
  readonly decision: AdminServicePreparationDecisionKind;
  readonly reason?: string;
}
