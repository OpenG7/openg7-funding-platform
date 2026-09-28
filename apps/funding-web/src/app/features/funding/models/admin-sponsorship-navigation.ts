import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab
} from '@openg7/funding-core';

const sectionTabs = {
  payment: 'overview',
  review: 'overview',
  stripe: 'overview',
  identity: 'identity',
  media: 'media',
  billing: 'billing',
  publication: 'publication',
  refund: 'refund',
  audit: 'audit'
} as const satisfies Record<string, SponsorshipDossierTab>;

export type DossierSection = keyof typeof sectionTabs;

/** The API chooses the next tab; the Web identifies the relevant section within it. */
export function nextDossierSection(
  next: AdminSponsorshipProgress['next']
): DossierSection | null {
  if (next.reason === 'complete') return null;
  if (next.tab !== 'overview') return next.tab;
  if (next.reason === 'review_pending' || next.reason === 'review_rejected')
    return 'review';
  return next.reason === 'stripe_failed' ? 'stripe' : 'payment';
}

export function dossierSectionTab(
  fragment: string | null
): SponsorshipDossierTab | null {
  if (!fragment?.startsWith('dossier-')) return null;
  const section = fragment.slice('dossier-'.length);
  return Object.hasOwn(sectionTabs, section)
    ? sectionTabs[section as DossierSection]
    : null;
}
