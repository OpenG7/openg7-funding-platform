import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import type {
  SponsorshipOfferSnapshot,
  SponsorshipObligationChannel,
  SponsorshipObligationTarget
} from './sponsorship-offers.js';
import type { SponsorshipPublicationFormat } from './sponsorship-publication-formats.js';
import type { SponsorshipObligationTiming } from './sponsorship-obligation-timing.js';

export type SponsorshipCommitmentProvenance =
  'accepted_offer' | 'historical_unverified' | 'qualified_historical';
export type SponsorshipObligationState =
  'pending' | 'blocked' | 'fulfilled' | 'adjusted';
export interface SponsorshipObligation {
  readonly timing?: SponsorshipObligationTiming | null;
  readonly format?: SponsorshipPublicationFormat | null;
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

/** Sponsor-facing current work; internal reasons and agreement evidence stay private. */
export interface SponsorshipPublicObligation {
  readonly timing?: SponsorshipObligationTiming | null;
  readonly id: string;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly ordinal: number;
  readonly state: SponsorshipObligationState;
  readonly format: SponsorshipPublicationFormat | null;
  readonly version: number;
  readonly fulfilmentEvidenceId: string | null;
  readonly blockedReason: string | null;
}

const publicBlockingCodes = new Set([
  'payment_pending',
  'payment_refunded',
  'payment_disputed',
  'payment_cancelled',
  'payment_expired',
  'payment_failed',
  'refund_requested',
  'refund_processing',
  'refund_completed',
  'refund_failed',
  'consent_missing',
  'review_pending_review',
  'review_rejected',
  'moderation_review_required',
  'required_elements_missing',
  'duration_unsupported'
]);
export const publicSponsorshipObligations = (
  obligations: readonly (SponsorshipObligation | SponsorshipPublicObligation)[]
): readonly SponsorshipPublicObligation[] =>
  obligations.map((o) => ({
    id: o.id,
    channel: o.channel,
    target: o.target,
    ordinal: o.ordinal,
    state: o.state,
    format: o.format ?? null,
    version: o.version,
    fulfilmentEvidenceId: o.fulfilmentEvidenceId,
    ...(o.timing ? { timing: o.timing } : {}),
    blockedReason:
      o.blockedReason && publicBlockingCodes.has(o.blockedReason)
        ? o.blockedReason
        : null
  }));
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
  readonly kind: 'destination' | 'waiver' | 'format';
  readonly target?: SponsorshipObligationTarget;
  readonly format?: SponsorshipPublicationFormat;
}

/** Owner-only adoption inventory; observations grant no acceptance, evidence or authorization. */
export interface SponsorshipCommitmentAdoptionItem {
  readonly contributionId: string;
  readonly reference: string | null;
  readonly paymentStatus: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly commitmentId: string | null;
  readonly classification:
    | 'accepted_snapshot'
    | 'qualified_historical'
    | 'legacy_declarations'
    | 'unqualified';
  readonly offerVersion: string | null;
  readonly obligationCount: number;
  readonly fulfilledWithEvidenceCount: number;
  readonly historicalDeclarationCount: number;
}
export interface SponsorshipCommitmentAdoptionPreview {
  readonly items: readonly SponsorshipCommitmentAdoptionItem[];
  readonly pageSize: number;
  readonly nextCursor: string | null;
}

/** Preparation channels come from outstanding recorded obligations, never today's amount thresholds. */
export const pendingSponsorshipSocialChannels = (
  commitment: SponsorshipCommitmentRecord | null | undefined,
  target?: SponsorshipObligationTarget
): readonly ('facebook' | 'linkedin')[] => {
  if (commitment?.state !== 'active') return [];
  return [
    ...new Set(
      commitment.obligations
        .filter(
          (o) =>
            ['pending', 'blocked'].includes(o.state) &&
            (target === undefined || o.target === target)
        )
        .flatMap((o) => (o.channel === 'website' ? [] : [o.channel]))
    )
  ];
};
