import {
  resolveSponsorshipBenefits,
  type SponsorshipBenefitId,
  type SponsorshipOfferSnapshot,
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

/** Recorded terms are descriptive snapshots; never re-resolve their amount against today's pricing. */
export const formatRecordedSponsorshipBenefits = (
  snapshot: SponsorshipOfferSnapshot | null
): readonly string[] => {
  if (!snapshot)
    return [
      'Engagements à qualifier : aucune offre enregistrée pour ce dossier.'
    ];
  return snapshot.benefits.map((b) => {
    const platform = b.channel === 'facebook' ? 'Facebook' : 'LinkedIn';
    const label =
      b.id === 'website_mention' && b.target === 'openg20'
        ? 'Mention de votre entreprise sur OpenG20.org'
        : b.format === 'individual_portrait'
          ? `Publication de reconnaissance avec portrait individuel sur ${platform}`
          : b.format === 'collective_composite'
            ? `Inclusion dans une publication de reconnaissance avec image collective sur ${platform}`
            : b.format === 'image_collection'
              ? `Inclusion dans une collection d’images de reconnaissance sur ${platform}`
              : benefitLabels[b.id];
    return `${b.quantity} × ${label} (${b.target === 'openg7' ? 'OpenG7' : 'OpenG20'})`;
  });
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
