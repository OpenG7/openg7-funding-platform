import type {
  SponsorshipApprovalFeedback,
  SponsorshipPublicationChannel,
  SponsorshipPublicationTextField
} from './admin-sponsor-workflow.ports.js';

export interface AdminSponsorPublicationFieldChange {
  readonly field: SponsorshipPublicationTextField;
  readonly event: Event;
}

export interface AdminSponsorPublicationChannelChange {
  readonly channel: SponsorshipPublicationChannel;
  readonly event: Event;
}

export interface AdminSponsorRejectionFieldChange {
  readonly field: 'sponsorMessage' | 'recipientEmail' | 'refundNote';
  readonly event: Event;
}

export interface AdminSponsorRefundFieldChange {
  readonly field:
    | 'confirmationText'
    | 'refundAmount'
    | 'recipientEmail'
    | 'sponsorMessage'
    | 'refundNote';
  readonly event: Event;
}

export type AdminSponsorApprovalState =
  SponsorshipApprovalFeedback['phase'] | 'idle';
