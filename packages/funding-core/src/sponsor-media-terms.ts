export type SponsorMediaTermsLocale = 'fr-CA' | 'en';

export interface SponsorMediaTermsAcceptance {
  readonly version: string;
  readonly fingerprint: string;
  readonly locale: SponsorMediaTermsLocale;
  readonly accepted: true;
}

export interface SponsorMediaUsageAcceptance {
  readonly id: string;
  readonly termsVersion: string;
  readonly termsFingerprint: string;
  readonly locale: SponsorMediaTermsLocale;
  readonly acceptedAt: string;
  readonly source: 'platform_acceptance';
}

export const SPONSOR_MEDIA_USAGE_TERMS_VERSION = 'sponsor-media-usage-v1';

/** Immutable text: a wording change requires a new version and fingerprints. */
const terms = {
  'fr-CA': {
    text: 'Je confirme être autorisé à accorder les droits sur chaque image transmise, y compris les autorisations des personnes représentées et des autres titulaires de droits. J’autorise OpenG7 à utiliser ces images uniquement pour les organisations, canaux et transformations que j’ai sélectionnés, en respectant les crédits et restrictions indiqués. L’adaptation technique comprend la conversion de format et le redimensionnement; les autres transformations exigent mon choix explicite. Cette autorisation ne garantit aucune publication et reste distincte de l’accord sur la présentation publique de l’organisation. Je peux retirer cette autorisation dans mon suivi privé pour les utilisations futures; un retrait ne rappelle pas les copies déjà diffusées. Mon acceptation, la version de ces conditions, mes choix et les empreintes des fichiers sont enregistrés pour documenter cet accord.',
    fingerprint:
      '75f9b45647b0f125b5bda7962b39f4abbda2ec2f0f1fd7553ba946255a89bd46'
  },
  en: {
    text: 'I confirm that I am authorized to grant rights for each submitted image, including permissions from depicted people and other rights holders. I authorize OpenG7 to use these images only for the organizations, channels and transformations I selected, respecting the specified credits and restrictions. Technical adaptation includes format conversion and resizing; other transformations require my explicit selection. This authorization does not guarantee publication and is separate from consent to the public presentation of the organization. I can withdraw this authorization in my private follow-up for future uses; withdrawal does not recall copies already distributed. My acceptance, the version of these terms, my choices and the file fingerprints are recorded to document this agreement.',
    fingerprint:
      'd8f96f20d643a40c6096c0e6b67159107545575ff82ed643799434f73ea31470'
  }
} as const;

export function getSponsorMediaUsageTerms(locale: SponsorMediaTermsLocale) {
  return Object.freeze({
    version: SPONSOR_MEDIA_USAGE_TERMS_VERSION,
    locale,
    ...terms[locale]
  });
}

/** The server accepts only an explicit acceptance of the exact displayed text. */
export function normalizeSponsorMediaTermsAcceptance(
  value: unknown
): SponsorMediaTermsAcceptance {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MEDIA_TERMS_ACCEPTANCE_REQUIRED');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['version', 'fingerprint', 'locale', 'accepted'].includes(key)
    ) ||
    input.accepted !== true ||
    (input.locale !== 'fr-CA' && input.locale !== 'en')
  )
    throw new Error('INVALID_MEDIA_TERMS_ACCEPTANCE');
  const current = getSponsorMediaUsageTerms(input.locale);
  if (
    input.version !== current.version ||
    input.fingerprint !== current.fingerprint
  )
    throw new Error('MEDIA_TERMS_VERSION_CONFLICT');
  return {
    version: current.version,
    fingerprint: current.fingerprint,
    locale: current.locale,
    accepted: true
  };
}
