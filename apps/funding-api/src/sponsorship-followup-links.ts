const SPONSORSHIP_FOLLOWUP_PATH = '/fonds-des-batisseurs/suivi-commandite';

export const sponsorshipFollowupLocaleFromUrl = (
  value: string | null | undefined
): 'fr-CA' | 'en' => {
  if (!value) return 'fr-CA';

  try {
    const { pathname } = new URL(value);
    return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'fr-CA';
  } catch {
    return 'fr-CA';
  }
};

/** The caller supplies the authorized base; only the token enters the query. */
export const buildSponsorshipFollowupUrl = (
  baseUrl: string,
  token: string,
  locale: 'fr-CA' | 'en' = 'fr-CA'
): string => {
  const url = new URL(
    `${locale === 'en' ? '/en' : ''}${SPONSORSHIP_FOLLOWUP_PATH}`,
    baseUrl
  );
  url.searchParams.set('token', token);
  return url.toString();
};
