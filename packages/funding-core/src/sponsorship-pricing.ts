import type { SponsorshipPricingConfig } from '@openg7/funding-models';

export const DEFAULT_SPONSORSHIP_PRICING_CONFIG: SponsorshipPricingConfig = {
  presetAmounts: [5, 10, 15],
  minimumAmount: 5,
  benefits: {
    websiteMention: { minimumAmount: 5 },
    facebookBatch: { minimumAmount: 5 },
    linkedinBatch: { minimumAmount: 5 },
    facebookIndividual: { minimumAmount: 10 },
    linkedinIndividual: { minimumAmount: 15 }
  }
};
