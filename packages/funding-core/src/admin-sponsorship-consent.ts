/** This documented agreement covers the public profile only; it authorizes no send. */
export const SPONSORSHIP_PUBLIC_CONSENT_SCOPE =
  'public_profile_name_and_presentation' as const;

export type SponsorshipPublicConsentScope =
  typeof SPONSORSHIP_PUBLIC_CONSENT_SCOPE;

export type SponsorshipConsentRecordBlocker =
  | 'already_granted'
  | 'permission_required'
  | 'operation_processing'
  | 'operation_uncertain';

export interface AdminSponsorshipConsentRecord {
  readonly id: string;
  /** Civil date YYYY-MM-DD, interpreted in America/Toronto. */
  readonly agreedOn: string;
  /** Private reference only. Funding never downloads this reference. */
  readonly evidenceReference: string;
  readonly recordedAt: string;
  readonly actor: string;
}

export interface AdminSponsorshipConsent {
  readonly contributionId: string;
  readonly version: string;
  readonly effectiveConsent: boolean;
  readonly source: 'checkout' | 'documented_agreement' | 'none';
  readonly scope: SponsorshipPublicConsentScope;
  readonly canRecord: boolean;
  readonly recordBlockers: readonly SponsorshipConsentRecordBlocker[];
  /** These private fields are omitted for a reader. At most 50 recent records. */
  readonly recordingActor?: string;
  readonly history?: readonly AdminSponsorshipConsentRecord[];
}

export interface AdminSponsorshipConsentRecordRequest {
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly requestId: string;
  readonly agreementReceived: true;
  readonly scope: SponsorshipPublicConsentScope;
  readonly agreedOn: string;
  readonly evidenceReference: string;
  readonly confirmed: true;
}

/** Immutable command receipt. Reconciling a receipt never applies the command again. */
export interface AdminSponsorshipConsentRecordReceipt {
  readonly requestId: string;
  readonly contributionId: string;
  readonly recordId: string;
  readonly outcome: 'recorded';
  readonly version: string;
  readonly effectiveConsent: true;
  readonly publicVisibilityHeld: true;
  readonly invalidatedDeliveryCount: number;
  readonly recordedAt: string;
  readonly actor: string;
}

export type AdminSponsorshipConsentReceiptResponse =
  | {
      readonly state: 'recorded';
      readonly receipt: AdminSponsorshipConsentRecordReceipt;
    }
  | { readonly state: 'not_found' };
