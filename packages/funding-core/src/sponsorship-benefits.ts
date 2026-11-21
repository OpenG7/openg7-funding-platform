import type { SponsorshipPricingConfig } from '@openg7/funding-models';

import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from './sponsorship-pricing.js';
import type { SponsorshipOfferSnapshot } from './sponsorship-offers.js';

export type SponsorshipBenefitId =
  | 'website_mention'
  | 'facebook_batch'
  | 'linkedin_batch'
  | 'facebook_individual'
  | 'linkedin_individual';

/** Internal catalog shared by amount projections and immutable offer snapshots. */
export const SPONSORSHIP_BENEFIT_DEFINITIONS = [
  {
    id: 'website_mention',
    channel: 'website',
    pricingKey: 'websiteMention'
  },
  {
    id: 'facebook_batch',
    channel: 'facebook',
    pricingKey: 'facebookBatch'
  },
  {
    id: 'linkedin_batch',
    channel: 'linkedin',
    pricingKey: 'linkedinBatch'
  },
  {
    id: 'facebook_individual',
    channel: 'facebook',
    pricingKey: 'facebookIndividual'
  },
  {
    id: 'linkedin_individual',
    channel: 'linkedin',
    pricingKey: 'linkedinIndividual'
  }
] as const satisfies readonly {
  readonly id: SponsorshipBenefitId;
  readonly channel: 'website' | 'facebook' | 'linkedin';
  readonly pricingKey: keyof SponsorshipPricingConfig['benefits'];
}[];

export type SponsorshipTierId =
  | 'website_only'
  | 'website_facebook'
  | 'website_facebook_linkedin'
  | 'collective'
  | 'facebook_individual'
  | 'facebook_linkedin_individual';

export interface SponsorshipBenefitStatus {
  readonly id: SponsorshipBenefitId;
  readonly minimumAmount: number;
}

export interface SponsorshipBenefitsResult {
  readonly tier: SponsorshipTierId | null;
  readonly achievedBenefits: readonly SponsorshipBenefitId[];
  readonly upcomingBenefits: readonly SponsorshipBenefitStatus[];
}

const tierFromBenefits = (
  ids: readonly SponsorshipBenefitId[],
  current: boolean
): SponsorshipTierId | null => {
  if (!ids.length) return null;
  if (current) {
    if (ids.includes('linkedin_individual'))
      return 'facebook_linkedin_individual';
    if (ids.includes('facebook_individual')) return 'facebook_individual';
    return 'collective';
  }
  if (ids.includes('linkedin_batch')) return 'website_facebook_linkedin';
  if (ids.includes('facebook_batch')) return 'website_facebook';
  return ids.includes('website_mention') ? 'website_only' : null;
};

/** Classify recorded terms without consulting the current price list. */
export const resolveSponsorshipTierFromOffer = (
  snapshot: SponsorshipOfferSnapshot | null | undefined
): SponsorshipTierId | null =>
  snapshot
    ? tierFromBenefits(
        snapshot.benefits.map((benefit) => benefit.id),
        snapshot.version === 'sponsorship-v4' ||
          snapshot.benefits.some(
            (benefit) =>
              benefit.id === 'facebook_individual' ||
              benefit.id === 'linkedin_individual'
          )
      )
    : null;

export const isValidSponsorshipAmount = (
  amount: number,
  pricing: SponsorshipPricingConfig = DEFAULT_SPONSORSHIP_PRICING_CONFIG
): boolean => Number.isFinite(amount) && amount >= pricing.minimumAmount;

/**
 * Pure amount -> tier/benefits resolution. Both the web app and the API
 * import this so the sponsorship benefits a company sees are always derived
 * from the paid amount, never trusted from client-submitted data.
 * Amounts and pricing thresholds use major units.
 */
export const resolveSponsorshipBenefits = (
  amount: number,
  pricing: SponsorshipPricingConfig = DEFAULT_SPONSORSHIP_PRICING_CONFIG
): SponsorshipBenefitsResult => {
  const benefitThresholds: readonly SponsorshipBenefitStatus[] =
    SPONSORSHIP_BENEFIT_DEFINITIONS.flatMap(({ id, pricingKey }) => {
      const threshold = pricing.benefits[pricingKey];
      return threshold ? [{ id, minimumAmount: threshold.minimumAmount }] : [];
    });

  const achievedBenefits = benefitThresholds
    .filter((benefit) => amount >= benefit.minimumAmount)
    .map((benefit) => benefit.id);

  const upcomingBenefits = benefitThresholds.filter(
    (benefit) => amount < benefit.minimumAmount
  );

  return {
    tier: tierFromBenefits(achievedBenefits, true),
    achievedBenefits,
    upcomingBenefits
  };
};
