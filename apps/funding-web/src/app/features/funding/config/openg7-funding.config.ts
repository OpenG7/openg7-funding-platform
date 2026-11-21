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
  // Keep aligned with DEFAULT_SPONSORSHIP_PRICING_CONFIG in funding-core;
  // the accepted services are documented in docs/technical/sponsorship-commitments.md.
  sponsorship: {
    presetAmounts: [5, 10, 15],
    minimumAmount: 5,
    benefits: {
      websiteMention: { minimumAmount: 5 },
      facebookBatch: { minimumAmount: 5 },
      linkedinBatch: { minimumAmount: 5 },
      facebookIndividual: { minimumAmount: 10 },
      linkedinIndividual: { minimumAmount: 15 }
    }
  }
} as const;
