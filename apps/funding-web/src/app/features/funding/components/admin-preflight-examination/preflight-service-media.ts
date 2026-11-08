import type {
  SponsorMediaPreparationAssignment,
  SponsorMediaWorkspace,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

export interface PreparedServiceMedia {
  readonly assignment: SponsorMediaPreparationAssignment;
  readonly asset: SponsorMediaWorkspaceAsset | null;
  readonly stale: boolean;
  readonly eligible: boolean;
}

/** The library owns assignments; previews never select, approve or publish a file. */
export function projectServiceMedia(
  workspace: SponsorMediaWorkspace,
  contributionId: string,
  obligationId: string,
  channel: 'website' | 'facebook' | 'linkedin',
  target: 'openg7' | 'openg20'
): {
  readonly prepared: readonly PreparedServiceMedia[];
  readonly previewAssets: readonly SponsorMediaWorkspaceAsset[];
  readonly usesPreparation: boolean;
} {
  if (workspace.contributionId !== contributionId)
    throw new Error('MEDIA_SCOPE_MISMATCH');
  const assets = workspace.assets.filter(
    (asset) => asset.contributionId === contributionId
  );
  const obligation = workspace.preparationObligations?.find(
    (item) => item.id === obligationId
  );
  const eligible = (asset: SponsorMediaWorkspaceAsset) =>
    asset.reviewStatus === 'approved' &&
    asset.readiness.state === 'ready' &&
    asset.usage?.state === 'confirmed' &&
    asset.usage.channels.includes(channel) &&
    asset.usage.targets.includes(target) &&
    asset.usage.transformations.includes('technical') &&
    (!asset.usage.restrictions || asset.usageRestrictionsReviewed === true);
  const prepared = (workspace.preparationAssignments ?? [])
    .filter((item) => item.obligationId === obligationId)
    .map((assignment) => {
      const asset =
        assets.find((item) => item.id === assignment.assetId) ?? null;
      const stale =
        assignment.stale ||
        !obligation ||
        obligation.version !== assignment.obligationVersion ||
        obligation.channel !== channel ||
        obligation.target !== target ||
        !asset ||
        asset.version !== assignment.assetVersion;
      return {
        assignment,
        asset,
        stale,
        eligible: !stale && !!asset && eligible(asset)
      };
    });
  const usesPreparation = prepared.length > 0;
  return {
    prepared,
    usesPreparation,
    previewAssets: (usesPreparation
      ? prepared.flatMap((item) =>
          item.eligible && item.asset ? [item.asset] : []
        )
      : channel === 'website'
        ? assets.filter(
            (asset) =>
              asset.websiteSelected && !!asset.publicUrl && eligible(asset)
          )
        : []
    ).sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    )
  };
}
