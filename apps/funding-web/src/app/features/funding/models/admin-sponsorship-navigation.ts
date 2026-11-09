import type {
  AdminSponsorshipProgress,
  SponsorshipDossierTab
} from '@openg7/funding-core';

const sectionTabs = {
  payment: 'billing',
  review: 'publication',
  stripe: 'billing',
  identity: 'identity',
  media: 'media',
  'media-gallery': 'media',
  billing: 'billing',
  publication: 'publication',
  agreement: 'publication',
  preparation: 'publication',
  'publication-content': 'media',
  'website-settings': 'media',
  'assistance-review': 'publication',
  'assistance-source': 'publication',
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

/** Old Overview anchors retain their target after work moves to its owning tab. */
export function dossierSectionOwnerTab(
  tab: string | null,
  fragment: string | null
): string | null {
  return (tab === null || tab === 'overview') &&
    [
      'dossier-payment',
      'dossier-review',
      'dossier-stripe',
      'dossier-agreement',
      'dossier-assistance-review',
      'dossier-assistance-source'
    ].includes(fragment ?? '')
    ? dossierSectionTab(fragment)
    : tab;
}
