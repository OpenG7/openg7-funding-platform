import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import type {
  SponsorshipOfferSnapshot,
  SponsorshipObligationChannel,
  SponsorshipObligationTarget
} from './sponsorship-offers.js';

export type SponsorshipCommitmentProvenance =
  'accepted_offer' | 'historical_unverified' | 'qualified_historical';
export type SponsorshipObligationState =
  'pending' | 'blocked' | 'fulfilled' | 'adjusted';
export interface SponsorshipObligation {
  readonly id: string;
  readonly commitmentId: string;
  readonly contributionId: string;
  readonly benefitId: SponsorshipBenefitId;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly ordinal: number;
  readonly state: SponsorshipObligationState;
  readonly blockedReason: string | null;
  readonly version: number;
  readonly fulfilmentEvidenceId: string | null;
}
export interface SponsorshipCommitmentRecord {
  readonly id: string;
  readonly contributionId: string;
  readonly offerId: string | null;
  readonly provenance: SponsorshipCommitmentProvenance;
  readonly state: 'active' | 'needs_confirmation';
  readonly qualificationReason: string | null;
  readonly version: number;
  readonly offer: SponsorshipOfferSnapshot | null;
  readonly obligations: readonly SponsorshipObligation[];
}

export interface SponsorshipCommitmentQualificationRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedVersion: number;
  readonly confirmation: string;
  readonly reason: string;
  readonly evidenceReference: string;
  readonly offer: SponsorshipOfferSnapshot;
}
export interface SponsorshipObligationAdjustmentRequest {
  readonly requestId: string;
  readonly obligationId: string;
  readonly expectedVersion: number;
  readonly confirmation: string;
  readonly reason: string;
  readonly kind: 'destination' | 'waiver';
  readonly target?: SponsorshipObligationTarget;
}
