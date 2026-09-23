import type { SponsorshipPricingConfig } from '@openg7/funding-models';

export const DEFAULT_SPONSORSHIP_PRICING_CONFIG: SponsorshipPricingConfig = {
  presetAmounts: [50, 100, 250, 500],
  minimumAmount: 50,
  benefits: {
    websiteMention: { minimumAmount: 50 },
    facebookBatch: { minimumAmount: 250 },
    linkedinBatch: { minimumAmount: 500 }
  }
};
