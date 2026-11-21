/** Explicit synthetic agreement facts, independent of any current pricing rules. */
export function recordedLegacySponsorshipOffer(amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 5000)
    throw new Error('The synthetic historical agreement starts at 50 CAD.');
  // Fixed pre-v4 contracts used by historical regression scenarios. This table
  // deliberately never calls the active pricing resolver or upgrades an offer.
  return {
    version: 'sponsorship-v3',
    amountMinor,
    currency: 'CAD',
    benefits: [
      ['website_mention', 'website', 5000],
      ['facebook_batch', 'facebook', 25000],
      ['linkedin_batch', 'linkedin', 50000]
    ]
      .filter(([, , threshold]) => amountMinor >= threshold)
      .map(([id, channel]) => ({
        id,
        channel,
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name'],
        deadlineDays: null,
        durationDays: null,
        ...(channel === 'website' ? {} : { format: 'collective_text' })
      }))
  };
}

/** Explicit synthetic agreement facts, independent of any current pricing rules. */
export function recordedSponsorshipCommitment(
  benefitIds,
  { target = 'openg7' } = {}
) {
  const benefits = benefitIds.map((id) => ({
    id,
    channel:
      id === 'website_mention'
        ? 'website'
        : id.startsWith('facebook_')
          ? 'facebook'
          : 'linkedin',
    target,
    quantity: 1,
    requiredElements: ['company_name'],
    deadlineDays: null,
    durationDays: null
  }));
  return {
    id: 'synthetic-commitment',
    contributionId: 'synthetic-sponsor',
    offerId: 'synthetic-offer',
    provenance: 'accepted_offer',
    state: 'active',
    qualificationReason: null,
    version: 1,
    offer: {
      version: 'synthetic-recorded-offer',
      amountMinor: 50000,
      currency: 'CAD',
      benefits
    },
    obligations: benefits.map((b, index) => ({
      id: `synthetic-obligation-${index}`,
      commitmentId: 'synthetic-commitment',
      contributionId: 'synthetic-sponsor',
      benefitId: b.id,
      channel: b.channel,
      target: b.target,
      ordinal: 1,
      state: 'pending',
      blockedReason: null,
      version: 1,
      fulfilmentEvidenceId: null
    }))
  };
}
