import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalogs = ['fr-CA', 'en'].map((language) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../apps/funding-web/src/assets/i18n/${language}.json`,
        import.meta.url
      ),
      'utf8'
    )
  )
);

// The older coverage suites inspect source code. Include only labels actually
// referenced by that source, and require each referenced leaf in both locales.
// Browser suites remain the evidence for rendered behavior and interactions.
export const translatedUiSource = (source) => {
  const labels = [];
  for (const match of source.matchAll(
    /['"](admin\.(?:legacy|messages|inspector|confirmation)\.[a-zA-Z0-9_.]+)['"]/g
  )) {
    const key = match[1];
    if (key.endsWith('.')) continue;
    const values = catalogs.map((catalog) =>
      key.split('.').reduce((value, segment) => value?.[segment], catalog)
    );
    for (const value of values)
      assert.equal(
        typeof value,
        'string',
        `Missing translated UI label: ${key}`
      );
    labels.push(...values);
  }
  return source + '\n' + labels.join('\n');
};
