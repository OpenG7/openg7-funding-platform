import {
  resolveSponsorshipBenefits,
  type SponsorshipBenefitId
} from '../../../packages/funding-core/src/index.js';

const benefitLabels: Record<SponsorshipBenefitId, string> = {
  website_mention: 'Mention de votre entreprise sur OpenG7.org',
  facebook_batch:
    'Inclusion dans une publication collective de reconnaissance sur Facebook',
  linkedin_batch:
    'Inclusion dans une publication collective de reconnaissance sur LinkedIn'
};

export const formatSponsorshipBenefitList = (
  amount: number,
  currency: string
): readonly string[] => {
  if (currency.toUpperCase() !== 'CAD') {
    return ['Avantages de visibilité à confirmer pour cette devise.'];
  }

  const { achievedBenefits } = resolveSponsorshipBenefits(amount);
  return achievedBenefits.length
    ? achievedBenefits.map((benefit) => benefitLabels[benefit])
    : ['Aucun avantage de visibilité associé à ce montant.'];
};
