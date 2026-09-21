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
  feeds: PublicationFeed[];
  deliveries: PublicationDelivery[];
  summary: {
    awaitingApproval: number;
    scheduled: number;
    exceptions: number;
    publishedToday: number;
  };
}
export type PublicationAutomationCommand =
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
      approveSponsors?: { id: string; version: string }[];
    }
  | {
      action: 'reject' | 'cancel';
      id: string;
      version: number;
      confirmation: string;
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
