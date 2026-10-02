import type { SponsorshipDossierTab } from '@openg7/funding-core';

import type { SponsorshipAttentionRecord } from './fund-contributions.repository.js';

export const SPONSORSHIP_ADMIN_PATH = '/admin/fundraiser/sponsors';

export const sponsorshipAdminUrl = (
  contributionId: string,
  tab?: SponsorshipDossierTab
): string => {
  const path = `${SPONSORSHIP_ADMIN_PATH}?sponsorshipId=${encodeURIComponent(contributionId)}`;
  return tab === undefined ? path : `${path}&tab=${encodeURIComponent(tab)}`;
};

export const sponsorshipRef = (
  record: Pick<SponsorshipAttentionRecord, 'contributionId' | 'publicReference'>
): string => record.publicReference ?? `#${record.contributionId.slice(0, 8)}`;
