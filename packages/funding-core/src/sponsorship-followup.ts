/** Incomplete private text; never a published profile or a payment fact. */
export interface SponsorshipDraftValues {
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
  readonly logoUrl: string;
  readonly message: string;
}

export interface SponsorshipDraftSnapshot {
  readonly revision: number;
  readonly data: SponsorshipDraftValues | null;
  readonly updatedAt: string | null;
}

export interface SponsorshipDraftRequest {
  readonly token: string;
  readonly expectedRevision: number;
  readonly data: SponsorshipDraftValues | null;
}

export interface SponsorshipAccessRecoveryRequest {
  readonly email: string;
  readonly locale: 'fr-CA' | 'en';
}

export interface AdminSponsorshipAccessRequest {
  readonly contributionId: string;
  readonly recipient: string;
  readonly requestId: string;
  readonly confirmed: true;
  readonly locale: 'fr-CA' | 'en';
}

export interface AdminSponsorshipAccessResult {
  readonly status:
    'queued' | 'already_queued' | 'already_sent' | 'delivery_failed';
}
