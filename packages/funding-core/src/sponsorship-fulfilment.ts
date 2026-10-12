import type {
  SponsorshipObligationChannel,
  SponsorshipObligationTarget
} from './sponsorship-offers.js';

/** Public facts belong to the authenticated dossier; internal notes and credentials are excluded. */
export interface SponsorshipFulfilmentEvidence {
  readonly id: string;
  readonly obligationId: string;
  readonly deliveryId: string | null;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly provenance:
    'provider_acknowledged' | 'provider_verified' | 'website_verified';
  readonly deliveredAt: string;
  readonly externalPostUrl: string | null;
  readonly visibility: 'visible' | 'missing' | 'changed' | 'unknown';
  readonly visibilityObservedAt: string | null;
}

/** Captured only by a human approval; editing a draft grants no publication right. */
export interface PublicationObligationSnapshot {
  readonly format?: import('./sponsorship-publication-formats.js').SponsorshipPublicationFormat;
  readonly id: string;
  readonly contributionId: string;
  readonly version: number;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly ordinal: number;
}
