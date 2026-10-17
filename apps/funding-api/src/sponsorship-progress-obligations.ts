import type {
  SponsorMediaAsset,
  SponsorshipCommitmentRecord,
  SponsorshipObligation
} from '@openg7/funding-core';

import { hasQualifiedSponsorshipFulfilment } from './sponsorship-progress-evidence.js';

interface ObligationProgressFacts {
  readonly qualifiedFulfilmentEvidenceIds: readonly string[];
  readonly commitment: SponsorshipCommitmentRecord | null | undefined;
  readonly amountMinor: number;
  readonly currency: string;
  readonly hasCompanyName: boolean;
  readonly media: readonly Pick<SponsorMediaAsset, 'kind' | 'reviewStatus'>[];
}

const obligationBlockers = (
  obligation: SponsorshipObligation,
  facts: ObligationProgressFacts
): readonly string[] => {
  const reason = obligation.blockedReason ?? '';
  if (reason === 'consent_missing') return ['consent'];
  if (reason.startsWith('payment_')) return ['payment'];
  if (reason.startsWith('refund_')) return ['refund'];
  if (reason.startsWith('review_') || reason === 'moderation_review_required')
    return ['review'];
  if (reason === 'required_elements_missing') {
    const requirements =
      facts.commitment?.offer?.benefits.find(
        (benefit) => benefit.id === obligation.benefitId
      )?.requiredElements ?? [];
    const blockers: string[] = [];
    if (requirements.includes('company_name') && !facts.hasCompanyName)
      blockers.push('identity');
    if (
      (requirements.includes('approved_logo') &&
        !facts.media.some(
          (asset) => asset.kind === 'logo' && asset.reviewStatus === 'approved'
        )) ||
      (requirements.includes('approved_presentation') &&
        !facts.media.some(
          (asset) =>
            asset.kind === 'supporting_image' &&
            asset.reviewStatus === 'approved'
        ))
    )
      blockers.push('media');
    if (blockers.length) return blockers;
  }
  // Repository eligibility includes moderation and facts absent from this
  // projection. An apparently present requirement cannot clear its block.
  return ['commitment_blocked'];
};

/** Read recorded promises and current blocks; observations never create fulfilment. */
export const projectSponsorshipObligationProgress = (
  facts: ObligationProgressFacts
) => {
  const commitment = facts.commitment;
  const qualified =
    commitment?.state === 'active' &&
    commitment.offer?.amountMinor === facts.amountMinor &&
    commitment.offer?.currency === facts.currency;
  const obligations = commitment?.obligations ?? [];
  const blocked = obligations.filter(
    (obligation) => obligation.state === 'blocked'
  );
  return {
    qualified,
    websiteRequired: obligations.some(
      (obligation) => obligation.channel === 'website'
    ),
    completion: {
      total: obligations.filter((obligation) => obligation.state !== 'adjusted')
        .length,
      done: obligations.filter((obligation) =>
        hasQualifiedSponsorshipFulfilment(
          obligation,
          facts.qualifiedFulfilmentEvidenceIds
        )
      ).length
    },
    complete:
      qualified &&
      obligations.length > 0 &&
      obligations.every(
        (obligation) =>
          obligation.state === 'adjusted' ||
          hasQualifiedSponsorshipFulfilment(
            obligation,
            facts.qualifiedFulfilmentEvidenceIds
          )
      ),
    blockers: qualified
      ? [
          ...new Set(
            blocked.flatMap((obligation) =>
              obligationBlockers(obligation, facts)
            )
          )
        ]
      : ['commitment_needs_confirmation']
  };
};
