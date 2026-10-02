import type { SponsorshipPricingConfig } from '@openg7/funding-models';

import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from './sponsorship-pricing.js';

export type SponsorshipBenefitId =
  'website_mention' | 'facebook_batch' | 'linkedin_batch';

export type SponsorshipTierId =
  'website_only' | 'website_facebook' | 'website_facebook_linkedin';

export interface SponsorshipBenefitStatus {
  readonly id: SponsorshipBenefitId;
  readonly minimumAmount: number;
}

export interface SponsorshipBenefitsResult {
  readonly tier: SponsorshipTierId | null;
  readonly achievedBenefits: readonly SponsorshipBenefitId[];
  readonly upcomingBenefits: readonly SponsorshipBenefitStatus[];
}

const sponsorshipTierByAchievedCount: readonly (SponsorshipTierId | null)[] = [
  null,
  'website_only',
  'website_facebook',
  'website_facebook_linkedin'
];

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
  const benefitThresholds: readonly SponsorshipBenefitStatus[] = [
    {
      id: 'website_mention',
      minimumAmount: pricing.benefits.websiteMention.minimumAmount
    },
    {
      id: 'facebook_batch',
      minimumAmount: pricing.benefits.facebookBatch.minimumAmount
    },
    {
      id: 'linkedin_batch',
      minimumAmount: pricing.benefits.linkedinBatch.minimumAmount
    }
  ];

  const achievedBenefits = benefitThresholds
    .filter((benefit) => amount >= benefit.minimumAmount)
    .map((benefit) => benefit.id);

  const upcomingBenefits = benefitThresholds.filter(
    (benefit) => amount < benefit.minimumAmount
  );

  return {
    tier: sponsorshipTierByAchievedCount[achievedBenefits.length] ?? null,
    achievedBenefits,
    upcomingBenefits
  };
};
