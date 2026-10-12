import type { SponsorshipPublicationFormat } from './sponsorship-publication-formats.js';

export interface PublicationPhotoSelection {
  readonly contributionId: string;
  readonly assetId: string;
  readonly assetVersion: string;
}

export type PublicationFeedId =
  | 'openg7:facebook'
  | 'openg7:linkedin'
  | 'openg20:facebook'
  | 'openg20:linkedin';
export type PublicationDeliveryStatus =
  | 'draft'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'blocked'
  | 'uncertain'
  | 'rejected'
  | 'cancelled';
export interface PublicationFeedSettings {
  id: PublicationFeedId;
  paused: boolean;
  autoPrepare: boolean;
  timezone: string;
  weekdays: number[];
  localTime: string;
  capacity: number;
  horizonDays: number;
}
export interface PublicationFeed extends PublicationFeedSettings {
  mode: 'disabled' | 'mock' | 'live';
  accountId: string | null;
  configured: boolean;
  expiresAt: string | null;
  connection: 'unchecked' | 'ready' | 'expired' | 'error';
  checkedAt: string | null;
}
export interface PublicationDelivery {
  readonly publicationFormat?: SponsorshipPublicationFormat;
  readonly photoSelections?: readonly PublicationPhotoSelection[];
  id: string;
  feedId: PublicationFeedId;
  kind: 'sponsorship' | 'news' | 'achievement' | 'campaign';
  batchId: string | null;
  message: string;
  scheduledAt: string;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
  readonly mediaDerivedHash?: string | null;
  readonly mediaTransform?: string | null;
  accountId: string;
  mode: 'disabled' | 'mock' | 'live';
  autoManaged: boolean;
  sponsors: {
    id: string;
    name: string;
    version: string;
    reviewStatus: 'pending_review' | 'approved' | 'rejected';
    /** Current payment fact; optional for compatibility with older API responses. */
    paymentStatus?: string;
    presentationApproved: boolean;
  }[];
  version: number;
  status: PublicationDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  externalPostId: string | null;
  externalPostUrl: string | null;
  errorCode: string | null;
  /** Private admin diagnostic: an account outcome still requires human reconciliation. */
  accountRecoveryRequired?: boolean;
  approvedAt: string | null;
  publishedAt: string | null;
}
/** Private, scoped image catalogue. No storage keys or authorization evidence. */
export interface PublicationMediaOption {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly company: string;
  readonly credit?: string | null;
  readonly contributionId?: string;
  readonly version?: string;
  readonly kind?: string;
  readonly transformations?: readonly string[];
}
export interface PublicationAutomationState {
  workerEnabled: boolean;
  workerVersion: number;
  feeds: PublicationFeed[];
  deliveries: PublicationDelivery[];
  /** Private preparation facts; absent on older API responses. Never authorizes sending. */
  queue?: PublicationPreparationQueue;
  /** Complete persisted scope, independent of filters/pages; no publication authorization. */
  reliability?: PublicationReliability;
  summary: {
    awaitingApproval: number;
    scheduled: number;
    exceptions: number;
    publishedToday: number;
  };
}
export type PublicationReliabilityIncidentCode =
  | 'FULFILMENT_EVIDENCE_MISMATCH'
  | 'ORPHAN_FULFILMENT_EVIDENCE'
  | 'OBLIGATION_RESERVATION_MISMATCH'
  | 'ACCOUNT_RESERVATION_MISMATCH'
  | 'ACCOUNT_LEASE_MISMATCH'
  | 'ACCOUNT_RESULT_UNCERTAIN'
  | 'ACCOUNT_SCHEDULE_CONFLICT'
  | 'BATCH_CAPACITY_EXCEEDED'
  | 'SLOT_CAPACITY_EXCEEDED';
export interface PublicationReliabilityIncident {
  readonly code: PublicationReliabilityIncidentCode;
  readonly subjectType: 'obligation' | 'delivery' | 'batch' | 'slot';
  readonly subjectId: string;
}
export interface PublicationReliability {
  readonly scope: 'global';
  readonly evaluatedAt: string;
  readonly obligations: {
    readonly open: number;
    readonly undatedSocial: number;
    readonly oldestOpenAt: string | null;
    readonly oldestUndatedAt: string | null;
    readonly fulfilledWithEvidence: number;
    readonly waived: number;
    readonly unqualifiedDossiers: number;
  };
  readonly capacity: {
    readonly saturatedBatches: number;
    readonly saturatedSlots: number;
    readonly accountConflicts: number;
  };
  readonly deliveries: {
    readonly publishing: number;
    readonly uncertain: number;
    readonly uncertainAccounts: number;
    readonly oldestUncertainAccountAt: string | null;
    readonly overdueApproved: number;
  };
  readonly discrepancies: {
    readonly proof: number;
    readonly orphanProof: number;
    readonly obligationReservation: number;
    readonly accountReservation: number;
    readonly accountLease: number;
    readonly batchCapacity: number;
    readonly slotCapacity: number;
  };
  readonly incidents: readonly PublicationReliabilityIncident[];
  readonly incidentTotal: number;
  readonly correlationLimit: number;
}
export type PublicationPreparationReason =
  | 'AWAITING_PREPARATION'
  | 'NO_SLOT_IN_HORIZON'
  | 'INDIVIDUAL_TEXT_TOO_LONG'
  | 'INVALID_SOURCE_CONTENT'
  | 'EXISTING_BATCH_INVALID'
  | 'MANUAL_RESERVATION'
  | 'PREPARATION_FAILED'
  | 'MODERATION_REVIEW_REQUIRED'
  | 'AWAITING_APPROVAL';
export interface PublicationPreparationEntry {
  draftId: string;
  sponsorshipId: string;
  name: string;
  feedId: PublicationFeedId;
  status: 'retained' | 'deferred' | 'needs_correction';
  reason: PublicationPreparationReason;
  /** Length of the complete individual recognition block, in UTF-16 code units. */
  renderedLength: number;
  budget: number;
  createdAt: string;
  scheduledAt: string | null;
  batchId: string | null;
  deliveryId: string | null;
  deliveryStatus: PublicationDeliveryStatus | null;
}
export interface PublicationPreparationQueue {
  entries: PublicationPreparationEntry[];
  /** Counts cover the entire confirmed scope, independently of this page. */
  summary: { retained: number; deferred: number; needsCorrection: number };
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  scope: 'global' | 'filtered';
  evaluatedAt: string;
}
export interface PublicationAutomationFilter {
  readonly sponsorshipId?: string;
  readonly deliveryId?: string;
  /** Offset for the preparation queue only; pages are current facts, not a frozen snapshot. */
  readonly queueOffset?: number;
}
export type PublicationAutomationCommand =
  | {
      action: 'check-visibility';
      id: string;
      version: number;
      confirmation: string;
      requestId: string;
    }
  | {
      action: 'worker';
      enabled: boolean;
      version: number;
      confirmation: 'enable-worker' | 'disable-worker';
    }
  | { action: 'settings'; settings: PublicationFeedSettings }
  | { action: 'pause-all' }
  | { action: 'check'; feedId: PublicationFeedId }
  | { action: 'prepare'; feedId: PublicationFeedId }
  | {
      action: 'compose';
      publicationFormat?: SponsorshipPublicationFormat;
      photoSelections?: readonly PublicationPhotoSelection[];
      feedId: PublicationFeedId;
      kind: PublicationDelivery['kind'];
      batchId?: string;
      message?: string;
      scheduledAt?: string;
      mediaId?: string | null;
    }
  | {
      action: 'edit';
      publicationFormat?: SponsorshipPublicationFormat;
      photoSelections?: readonly PublicationPhotoSelection[];
      id: string;
      version: number;
      message: string;
      scheduledAt: string;
      mediaId: string | null;
    }
  | {
      action: 'approve';
      id: string;
      version: number;
      confirmation: string;
      moderationDecision?: import('./moderation.js').ModerationDecisionInput;
      approveSponsors?: {
        id: string;
        version: string;
        moderationDecision?: import('./moderation.js').ModerationDecisionInput;
      }[];
    }
  | {
      action: 'reject' | 'cancel';
      id: string;
      version: number;
      confirmation: string;
      moderationDecision?: import('./moderation.js').ModerationDecisionInput;
    }
  | {
      action: 'reconcile';
      id: string;
      version: number;
      confirmation: string;
      externalPostId: string;
    }
  | {
      action: 'confirm-absent';
      id: string;
      version: number;
      confirmation: string;
      reason: string;
    };
