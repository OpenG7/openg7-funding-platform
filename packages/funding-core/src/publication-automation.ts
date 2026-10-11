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
  id: string;
  feedId: PublicationFeedId;
  kind: 'sponsorship' | 'news' | 'achievement' | 'campaign';
  batchId: string | null;
  message: string;
  scheduledAt: string;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
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
  approvedAt: string | null;
  publishedAt: string | null;
}
export interface PublicationAutomationState {
  workerEnabled: boolean;
  workerVersion: number;
  feeds: PublicationFeed[];
  deliveries: PublicationDelivery[];
  /** Private preparation facts; absent on older API responses. Never authorizes sending. */
  queue?: PublicationPreparationQueue;
  summary: {
    awaitingApproval: number;
    scheduled: number;
    exceptions: number;
    publishedToday: number;
  };
}
export type PublicationPreparationReason =
  | 'AWAITING_PREPARATION'
  | 'NO_SLOT_IN_HORIZON'
  | 'INDIVIDUAL_TEXT_TOO_LONG'
  | 'INVALID_SOURCE_CONTENT'
  | 'EXISTING_BATCH_INVALID'
  | 'MANUAL_RESERVATION'
  | 'PREPARATION_FAILED'
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
      feedId: PublicationFeedId;
      kind: PublicationDelivery['kind'];
      batchId?: string;
      message?: string;
      scheduledAt?: string;
      mediaId?: string | null;
    }
  | {
      action: 'edit';
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
