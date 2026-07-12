import { FundingProjectConfig } from '@openg7/funding-models';

export const OPENG7_FUNDING_CONFIG: FundingProjectConfig = {
  projectId: 'openg7',
  projectName: 'OpenG7',
  campaignTitle: 'Le Fonds des Bâtisseurs',
  campaignDescription:
    'Chaque contribution maintient une lumière allumée, une province connectée et une nouvelle possibilité ouverte.',
  currency: 'CAD',
  locale: 'fr-CA',
  monthlyGoal: 270,
  contributionAmounts: [5, 10, 25, 50],
  guardianAsset: 'assets/gardien-fonds-batisseurs-openg7.png',
  theme: 'dark-civic-tech',
  transparencyEnabled: true,
  publicContributorsEnabled: true,
  economicFlowMapEnabled: true,
  // Kept in sync by hand with FUNDING_ALLOWED_AMOUNTS-style server-side
  // sponsorship validation in apps/funding-api (see docs/fundraiser-mvp-status.md).
  sponsorship: {
    presetAmounts: [5, 10, 25, 50],
    minimumAmount: 5,
    benefits: {
      websiteMention: { minimumAmount: 5 },
      facebookBatch: { minimumAmount: 25 },
      linkedinBatch: { minimumAmount: 50 }
    }
  }
} as const;
