import type {
  AdminAssistantMode,
  SponsorFeedChannel,
  SponsorshipReviewStatus
} from './index.js';

export type AdminAssistantNextStep =
  | 'check_payment'
  | 'check_refund'
  | 'review_rejection'
  | 'complete_information'
  | 'review_media'
  | 'review_sponsorship'
  | 'confirm_consent'
  | 'prepare_publication'
  | 'monitor_publication'
  | 'complete';

export interface AdminAssistantContext {
  readonly contributionId: string;
  readonly reference: string;
  readonly version: string;
  readonly paymentStatus: string;
  readonly refundStatus: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly feedStatus: string;
  readonly publicConsent: boolean;
  readonly missingFields: readonly string[];
  readonly media: {
    readonly total: number;
    readonly approved: number;
    readonly pending: number;
    readonly rejected: number;
  };
  readonly promisedChannels: readonly SponsorFeedChannel[];
  readonly coveredChannels: readonly SponsorFeedChannel[];
  readonly nextStep: AdminAssistantNextStep;
  readonly adminUrl: string;
  readonly canRequestInformation: boolean;
}

export interface AdminAssistantContextResponse {
  readonly status: 'ok' | 'empty' | 'not_found' | 'unavailable';
  readonly generatedAt: string;
  readonly context: AdminAssistantContext | null;
  readonly conversationMode: AdminAssistantMode;
}

/** Private, admin-only preview. Never supplied to a model provider. */
export interface AdminInformationRequestPreview {
  readonly contributionId: string;
  readonly contextVersion: string;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
}

export interface AdminInformationRequest extends AdminInformationRequestPreview {
  readonly confirmed: true;
}

export interface AdminInformationRequestResult {
  readonly status:
    'queued' | 'already_queued' | 'already_sent' | 'delivery_failed';
  readonly messageId: string;
}
