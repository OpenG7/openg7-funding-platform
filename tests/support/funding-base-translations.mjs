import { readFileSync } from 'node:fs';

/** The public catalog and the base catalog loaded by administrative routes. */
export function fundingBaseTranslations(locale) {
  if (!['fr-CA', 'en'].includes(locale))
    throw new Error(`Unsupported fixture locale: ${locale}`);
  const read = (file) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../apps/funding-web/src/assets/i18n/${file}.json`,
          import.meta.url
        ),
        'utf8'
      )
    );
  return { ...read(locale), ...read(`admin-base.${locale}`) };
}
