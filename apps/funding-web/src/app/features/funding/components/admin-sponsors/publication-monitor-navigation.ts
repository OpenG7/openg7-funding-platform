/** Navigation identifiers only: never carry proposal contents or private contacts. */
export const publicationDeskPath = '/admin/fundraiser/preflight';

export function publicationReturnId(
  value: string | null | undefined
): string | null {
  return value && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
    ? value
    : null;
}

export function publicationDeskParams(
  contributionId: string,
  reference: string,
  obligationId?: string | null
): Record<string, string | null> {
  return {
    view: 'desk',
    deskSearch: reference.slice(0, 120),
    deskPage: null,
    deskStatus: null,
    sponsorshipId: null,
    obligationId: null,
    workshopSponsorshipId: null,
    reviewReturn: obligationId ?? null,
    publicationReturn: contributionId
  };
}

export function publicationExaminationParams(
  contributionId: string,
  obligationId: string
): Record<string, string> {
  return {
    view: 'desk',
    sponsorshipId: contributionId,
    obligationId,
    publicationReturn: contributionId
  };
}

export function publicationWorkshopParams(
  contributionId: string
): Record<string, string> {
  return {
    view: 'publication',
    workshopSponsorshipId: contributionId,
    publicationReturn: contributionId
  };
}
