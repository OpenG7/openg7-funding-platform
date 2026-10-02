import {
  resolveSponsorshipBenefits,
  type SponsorshipBenefitId,
  type SponsorFeedChannel
} from '../../../packages/funding-core/src/index.js';

const benefitLabels: Record<SponsorshipBenefitId, string> = {
  website_mention: 'Mention de votre entreprise sur OpenG7.org',
  facebook_batch:
    'Inclusion dans une publication collective de reconnaissance sur Facebook',
  linkedin_batch:
    'Inclusion dans une publication collective de reconnaissance sur LinkedIn'
};

const socialChannelByBenefit: Partial<
  Record<SponsorshipBenefitId, SponsorFeedChannel>
> = {
  facebook_batch: 'facebook',
  linkedin_batch: 'linkedin'
};

export const resolveSponsorshipSocialChannels = (
  amount: number
): readonly SponsorFeedChannel[] =>
  resolveSponsorshipBenefits(amount).achievedBenefits.flatMap((benefit) => {
    const channel = socialChannelByBenefit[benefit];
    return channel ? [channel] : [];
  });

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
