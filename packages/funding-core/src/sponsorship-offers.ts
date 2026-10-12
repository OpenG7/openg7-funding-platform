import type { SponsorshipPricingConfig } from '@openg7/funding-models';

import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from './sponsorship-pricing.js';

export const SPONSORSHIP_OFFER_VERSION = 'sponsorship-v1';
export type SponsorshipObligationChannel = 'website' | 'facebook' | 'linkedin';
export type SponsorshipObligationTarget = 'openg7' | 'openg20';
export interface SponsorshipOfferedBenefit {
  /** In sponsorship-v1 and historical-qualification-v1, *_batch means collective recognition. */
  readonly id: SponsorshipBenefitId;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly quantity: number;
  readonly requiredElements: readonly (
    'company_name' | 'approved_logo' | 'approved_presentation'
  )[];
  /** Null explicitly means that this offer promises no fixed deadline/duration. */
  readonly deadlineDays: number | null;
  readonly durationDays: number | null;
}
export interface SponsorshipOfferSnapshot {
  readonly version: string;
  readonly amountMinor: number;
  readonly currency: 'CAD';
  readonly benefits: readonly SponsorshipOfferedBenefit[];
}
export interface SponsorshipOfferQuote extends SponsorshipOfferSnapshot {
  readonly fingerprint: string;
}
export interface SponsorshipOfferAcceptance {
  readonly version: string;
  readonly fingerprint: string;
}

/** Resolve the currently offered terms once; persisted snapshots never call this again. */
export const createSponsorshipOfferSnapshot = (
  amountMinor: number,
  currency: string,
  pricing: SponsorshipPricingConfig = DEFAULT_SPONSORSHIP_PRICING_CONFIG
): SponsorshipOfferSnapshot => {
  if (
    currency !== 'CAD' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  )
    throw new Error('Invalid sponsorship offer amount or currency.');
  const minor = (major: number): number => {
    const value = Math.round(major * 100);
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      Math.abs(value / 100 - major) > 1e-9
    )
      throw new Error('Invalid sponsorship pricing threshold.');
    return value;
  };
  if (amountMinor < minor(pricing.minimumAmount))
    throw new Error('Sponsorship amount is below the minimum.');
  const definitions: readonly [
    SponsorshipBenefitId,
    SponsorshipObligationChannel,
    number
  ][] = [
    [
      'website_mention',
      'website',
      minor(pricing.benefits.websiteMention.minimumAmount)
    ],
    [
      'facebook_batch',
      'facebook',
      minor(pricing.benefits.facebookBatch.minimumAmount)
    ],
    [
      'linkedin_batch',
      'linkedin',
      minor(pricing.benefits.linkedinBatch.minimumAmount)
    ]
  ];
  return {
    version: SPONSORSHIP_OFFER_VERSION,
    amountMinor,
    currency: 'CAD',
    benefits: definitions
      .filter(([, , threshold]) => amountMinor >= threshold)
      .map(([id, channel]) => ({
        id,
        channel,
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name', 'approved_presentation'],
        deadlineDays: null,
        durationDays: null
      }))
  };
};

/** Stable serialization also rejects unknown fields/terms in historical qualifications. */
export const normalizeSponsorshipOfferSnapshot = (
  value: unknown
): SponsorshipOfferSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid sponsorship offer.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['version', 'amountMinor', 'currency', 'benefits'].includes(key)
    ) ||
    typeof input.version !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(input.version) ||
    !Number.isSafeInteger(input.amountMinor) ||
    (input.amountMinor as number) <= 0 ||
    input.currency !== 'CAD' ||
    !Array.isArray(input.benefits) ||
    input.benefits.length === 0 ||
    input.benefits.length > 3
  )
    throw new Error('Invalid sponsorship offer.');
  const channels: Record<string, SponsorshipObligationChannel> = {
    website_mention: 'website',
    facebook_batch: 'facebook',
    linkedin_batch: 'linkedin'
  };
  const seen = new Set<string>();
  const benefits = input.benefits.map((value): SponsorshipOfferedBenefit => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid offered benefit.');
    const b = value as Record<string, unknown>;
    if (
      Object.keys(b).some(
        (key) =>
          ![
            'id',
            'channel',
            'target',
            'quantity',
            'requiredElements',
            'deadlineDays',
            'durationDays'
          ].includes(key)
      ) ||
      typeof b.id !== 'string' ||
      !Object.hasOwn(channels, b.id) ||
      seen.has(b.id) ||
      b.channel !== channels[b.id] ||
      !['openg7', 'openg20'].includes(String(b.target)) ||
      typeof b.target !== 'string' ||
      !Number.isSafeInteger(b.quantity) ||
      (b.quantity as number) < 1 ||
      (b.quantity as number) > 100 ||
      !Array.isArray(b.requiredElements) ||
      b.requiredElements.length === 0 ||
      b.requiredElements.length > 3 ||
      b.requiredElements.some(
        (e) =>
          typeof e !== 'string' ||
          !['company_name', 'approved_logo', 'approved_presentation'].includes(
            e
          )
      ) ||
      new Set(b.requiredElements).size !== b.requiredElements.length ||
      [b.deadlineDays, b.durationDays].some(
        (n) =>
          n !== null &&
          (!Number.isSafeInteger(n) ||
            (n as number) < 1 ||
            (n as number) > 3650)
      )
    )
      throw new Error('Invalid offered benefit.');
    seen.add(b.id);
    return {
      id: b.id as SponsorshipBenefitId,
      channel: channels[b.id]!,
      target: b.target as SponsorshipObligationTarget,
      quantity: b.quantity as number,
      requiredElements: [
        ...(b.requiredElements as SponsorshipOfferedBenefit['requiredElements'])
      ],
      deadlineDays: b.deadlineDays as number | null,
      durationDays: b.durationDays as number | null
    };
  });
  return {
    version: input.version,
    amountMinor: input.amountMinor as number,
    currency: 'CAD',
    benefits
  };
};
