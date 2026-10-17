import { readFileSync } from 'node:fs';

/** Match the lazy administrative locale registration used by publication views. */
export function adminPublicationTranslations(locale) {
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
  const catalog = read(locale);
  const deferred = read(`admin-publication-schedule.${locale}`);
  const merge = (target, additions) => {
    for (const [key, value] of Object.entries(additions)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] ??= {};
        merge(target[key], value);
      } else target[key] = value;
    }
  };
  merge(catalog, deferred.adminOverrides);
  return catalog;
}
