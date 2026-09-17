export type SponsorshipDossierTab =
  | 'overview'
  | 'identity'
  | 'media'
  | 'publication'
  | 'billing'
  | 'refund'
  | 'audit';
export type SponsorshipMilestoneId =
  'payment' | 'identity' | 'media' | 'review' | 'billing' | 'publication';
export type SponsorshipProgressState =
  | 'complete'
  | 'pending'
  | 'blocked'
  | 'error'
  | 'partial'
  | 'cancelled'
  | 'not_required';

export interface SponsorshipMilestone {
  readonly id: SponsorshipMilestoneId;
  readonly state: SponsorshipProgressState;
  readonly reason: string;
  readonly tab: SponsorshipDossierTab;
}
export interface SponsorshipProgressDocument {
  readonly id: string;
  readonly number: string;
  readonly kind: 'invoice' | 'credit_note';
  readonly amountMinor: number;
  readonly currency: string;
  readonly issuedAt: string;
}
export interface SponsorshipProgressPublication {
  readonly id: string;
  readonly channel: string;
  readonly target: string;
  readonly status: string;
  readonly batchStatus: string | null;
  readonly slotStatus: string | null;
  readonly deliveryStatus: string | null;
  readonly deliveryMode: 'mock' | 'live' | null;
  readonly scheduledAt: string | null;
  readonly publishedAt: string | null;
}
export interface AdminSponsorshipProgress {
  readonly contributionId: string;
  readonly reference: string;
  readonly companyName: string | null;
  readonly version: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly reviewStatus: string;
  readonly publicConsent: boolean;
  readonly publicEligible: boolean;
  readonly feedStatus: string;
  readonly milestones: readonly SponsorshipMilestone[];
  readonly next: {
    readonly reason: string;
    readonly tab: SponsorshipDossierTab;
    readonly adminUrl: string;
  };
  readonly documents: readonly SponsorshipProgressDocument[];
  readonly publications: readonly SponsorshipProgressPublication[];
  readonly refund: {
    readonly workflow: string;
    readonly state: SponsorshipProgressState;
    readonly confirmedAmountMinor: number;
    readonly creditMissing: boolean;
    readonly hasError: boolean;
  };
  readonly failedEmails: readonly {
    readonly id: string;
    readonly template: string;
  }[];
  readonly failedStripeEvents: readonly {
    readonly id: string;
    readonly type: string;
  }[];
}
export interface AdminSponsorshipProgressResponse {
  readonly status: 'ok' | 'empty' | 'not_found' | 'unavailable';
  readonly generatedAt: string;
  readonly dossier: AdminSponsorshipProgress | null;
}
