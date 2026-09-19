import { readFileSync } from 'node:fs';

// Compatibility for historical source coverage after splitting the page.
// Actual interactions are covered by sponsorship-followup.spec.ts.
export const readSponsorshipFollowupSource = () => {
  const root = 'apps/funding-web/src/app/features/funding/';
  const paths = [
    'pages/sponsorship-followup-page/sponsorship-followup-page.component.ts',
    'pages/sponsorship-followup-page/sponsorship-followup-page.component.html',
    'models/sponsorship-followup-ui.ts',
    ...['form', 'status', 'media'].flatMap((name) =>
      ['ts', 'html'].map(
        (extension) =>
          'components/sponsorship-followup/sponsorship-followup-' +
          name +
          '.component.' +
          extension
      )
    )
  ];
  const catalog = JSON.parse(
    readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  return (
    paths.map((path) => readFileSync(root + path, 'utf8')).join('\n') +
    '\n' +
    JSON.stringify(catalog.funding.followup)
  );
};
