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
        : id === 'facebook_batch'
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
