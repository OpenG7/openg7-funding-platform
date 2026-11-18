import type { SponsorMediaWorkspaceAsset } from '@openg7/funding-core';

export interface MediaApprovalAvailability {
  readonly pendingCount: number;
  /** Potential candidates from current workspace facts; the server plan still verifies content. */
  readonly eligibleCount: number | null;
  readonly consentRequiredCount: number;
  readonly withdrawnCount: number;
  readonly missingAltCount: number;
  readonly allAwaitingConsent: boolean;
}

/** A missing, loading or failed inventory must never be presented as zero work. */
export function projectMediaApprovalAvailability(
  assets: readonly SponsorMediaWorkspaceAsset[] | null
): MediaApprovalAvailability {
  const pending =
    assets?.filter((asset) => asset.reviewStatus === 'pending_review') ?? [];
  const known =
    assets !== null &&
    pending.every(
      (asset) =>
        !!asset.readiness &&
        ['ready', 'needs_review', 'blocked'].includes(asset.readiness.state) &&
        Array.isArray(asset.readiness.reasons) &&
        !!asset.usage &&
        ['confirmed', 'needs_confirmation', 'withdrawn'].includes(
          asset.usage.state
        )
    );
  return {
    pendingCount: pending.length,
    eligibleCount: known
      ? pending.filter(
          (asset) =>
            !asset.websiteSelected &&
            asset.usage?.state === 'confirmed' &&
            asset.readiness.state !== 'blocked' &&
            !!asset.altText?.trim()
        ).length
      : null,
    consentRequiredCount: pending.filter(
      (asset) => asset.usage?.state === 'needs_confirmation'
    ).length,
    withdrawnCount: pending.filter(
      (asset) => asset.usage?.state === 'withdrawn'
    ).length,
    // Blocked readiness lists can hide this independently actionable preparation.
    missingAltCount: pending.filter((asset) => !asset.altText?.trim()).length,
    allAwaitingConsent:
      known &&
      pending.length > 0 &&
      pending.every(
        (asset) =>
          asset.usage?.state === 'needs_confirmation' &&
          !asset.websiteSelected &&
          asset.readiness.state === 'blocked' &&
          asset.readiness.reasons.includes(
            'MEDIA_USAGE_CONFIRMATION_REQUIRED'
          ) &&
          asset.readiness.reasons.every(
            (reason) => reason === 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
          )
      )
  };
}
