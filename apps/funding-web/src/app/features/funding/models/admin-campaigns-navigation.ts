/** A dossier is mandatory when a link names one exact promised passage. */
export interface AdminCampaignsFocus {
  readonly sponsorshipId: string;
  readonly obligationId?: string;
}

export type AdminCampaignsDestination =
  | { readonly kind: 'all' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'focused'; readonly focus: AdminCampaignsFocus };

const identifier = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** Validate only the routing identifiers; other shell parameters are independent. */
export function adminCampaignsDestination(params: {
  getAll(name: string): readonly string[];
}): AdminCampaignsDestination {
  const dossiers = params.getAll('sponsorshipId');
  const obligations = params.getAll('obligationId');
  if (!dossiers.length && !obligations.length) return { kind: 'all' };
  if (
    dossiers.length !== 1 ||
    !identifier.test(dossiers[0]!) ||
    obligations.length > 1 ||
    (obligations.length === 1 && !identifier.test(obligations[0]!))
  )
    return { kind: 'invalid' };
  return {
    kind: 'focused',
    focus: {
      sponsorshipId: dossiers[0]!.toLowerCase(),
      ...(obligations.length
        ? { obligationId: obligations[0]!.toLowerCase() }
        : {})
    }
  };
}

/** A proof-view return retains its source only for the exact linked dossier and passage. */
export function adminCampaignsReturnContext(
  params: { getAll(name: string): readonly string[] },
  row: { readonly contributionId: string; readonly id: string }
): { readonly draftId?: string; readonly deliveryId?: string } | null {
  const destination = adminCampaignsDestination(params);
  if (
    destination.kind !== 'focused' ||
    destination.focus.sponsorshipId !== row.contributionId.toLowerCase() ||
    destination.focus.obligationId !== row.id.toLowerCase()
  )
    return null;
  const drafts = params.getAll('draftId');
  const deliveries = params.getAll('deliveryId');
  if (
    (!drafts.length && !deliveries.length) ||
    drafts.length > 1 ||
    deliveries.length > 1 ||
    [...drafts, ...deliveries].some((value) => !identifier.test(value))
  )
    return null;
  return {
    ...(drafts.length ? { draftId: drafts[0]!.toLowerCase() } : {}),
    ...(deliveries.length ? { deliveryId: deliveries[0]!.toLowerCase() } : {})
  };
}
