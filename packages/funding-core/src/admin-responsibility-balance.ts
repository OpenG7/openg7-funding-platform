import type { AdminPaymentJourney } from './admin-payment-journey.js';
import type { ContributionType } from './contribution-contracts.js';
import type {
  SponsorshipObligation,
  SponsorshipObligationState
} from './sponsorship-commitments.js';
import type { SponsorshipFulfilmentEvidence } from './sponsorship-fulfilment.js';
import type { SponsorshipOfferedBenefit } from './sponsorship-offers.js';

/** A qualified, immutable delivery fact; current visibility remains a separate observation. */
export interface ResponsibilityBalanceEvidence {
  readonly id: string;
  readonly obligationId: string;
  readonly contributionId: string;
  readonly obligationVersion: number;
  readonly channel: SponsorshipObligation['channel'];
  readonly target: SponsorshipObligation['target'];
  readonly provenance: SponsorshipFulfilmentEvidence['provenance'];
  readonly deliveredAt: string;
  readonly externalPostUrl: string | null;
}

export interface ResponsibilityBalanceObligation {
  readonly id: string;
  readonly benefitId: SponsorshipObligation['benefitId'];
  readonly channel: SponsorshipObligation['channel'];
  readonly target: SponsorshipObligation['target'];
  readonly ordinal: number;
  readonly format?: SponsorshipObligation['format'];
  readonly state: SponsorshipObligationState;
  readonly version: number;
  readonly timing?: SponsorshipObligation['timing'];
  readonly evidence?: ResponsibilityBalanceEvidence;
}

/** Counts describe promised benefits, never a conversion between money and prestations. */
export interface ResponsibilityBalance {
  readonly contributionId: string;
  readonly reference: string;
  readonly contributionType: ContributionType;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly version: string;
  readonly status:
    'balanced' | 'action_required' | 'waiting' | 'blocked' | 'unknown';
  readonly expected: number;
  readonly fulfilled: number;
  /** Explicitly audited dispensations remain separate from delivered benefits. */
  readonly waived: number;
  readonly outstanding: number;
  readonly unknown: number;
  readonly reasons: readonly string[];
  /** Accepted immutable promises, including benefits whose obligation rows are missing. */
  readonly promisedBenefits: readonly SponsorshipOfferedBenefit[];
  readonly obligations: readonly ResponsibilityBalanceObligation[];
  readonly next: AdminPaymentJourney['next'];
}
