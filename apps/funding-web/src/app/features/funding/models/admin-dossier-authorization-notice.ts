import type {
  AdminSponsorshipProgress,
  SponsorMediaAsset
} from '@openg7/funding-core';

export interface DossierAuthorizationNotice {
  readonly publicConsentRequired: boolean;
  readonly mediaConsentRequiredCount: number;
  readonly missingAltCount: number;
  readonly canReview: boolean;
}

/** Explains recorded dependencies without declaring the whole dossier unactionable. */
export function projectDossierAuthorizationNotice(input: {
  readonly contributionId: string;
  readonly dossier: AdminSponsorshipProgress | null;
  /** Complete current read; unavailable or stale media are represented by null. */
  readonly media: readonly SponsorMediaAsset[] | null;
  readonly canManage: boolean;
  readonly canReview: boolean;
}): DossierAuthorizationNotice | null {
  if (
    !input.canManage ||
    !input.dossier ||
    input.dossier.contributionId !== input.contributionId ||
    input.dossier.paymentStatus !== 'paid' ||
    ['rejected', 'refused'].includes(input.dossier.reviewStatus)
  )
    return null;

  const media = input.media?.every(
    (asset) => asset.contributionId === input.contributionId
  )
    ? input.media
    : null;
  const pending = media?.filter(
    (asset) => asset.reviewStatus === 'pending_review'
  );
  const publicConsentRequired = input.dossier.publicConsent === false;
  // Missing optional usage on an older response is unknown, not a consent fact.
  const mediaConsentRequiredCount =
    pending?.filter((asset) => asset.usage?.state === 'needs_confirmation')
      .length ?? 0;
  if (!publicConsentRequired && !mediaConsentRequiredCount) return null;
  return {
    publicConsentRequired,
    mediaConsentRequiredCount,
    missingAltCount:
      pending?.filter((asset) => !asset.altText?.trim()).length ?? 0,
    canReview: input.canReview
  };
}
