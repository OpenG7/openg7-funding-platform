import { readFileSync } from 'node:fs';

// Keep historical contract checks useful across the page, components and controller.
// The standalone browser suite verifies their actual interactions.
export function readFundingHomeSource() {
  const root = 'apps/funding-web/src/app/features/funding/';
  const files = [
    'pages/funding-page/funding-page.component',
    ...['contribution-form', 'checkout-notice', 'finance-summary'].map(
      (name) => `components/funding-${name}/funding-${name}.component`
    )
  ];
  const components = files
    .flatMap((file) =>
      ['ts', 'html'].map((extension) =>
        readFileSync(`${root}${file}.${extension}`, 'utf8')
      )
    )
    .join('\n');
  return (
    components +
    '\n' +
    readFileSync(`${root}services/funding-home-controller.ts`, 'utf8')
  );
}
