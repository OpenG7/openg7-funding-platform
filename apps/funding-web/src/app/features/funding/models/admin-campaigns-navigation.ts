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
