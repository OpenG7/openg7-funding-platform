import { readFileSync } from 'node:fs';

// Keep historical contract checks useful after extracting the page's components.
// The standalone browser suite verifies their actual interactions.
export function readFundingHomeSource() {
  const root = 'apps/funding-web/src/app/features/funding/';
  const files = [
    'pages/funding-page/funding-page.component',
    ...['contribution-form', 'checkout-notice', 'finance-summary'].map(
      (name) => `components/funding-${name}/funding-${name}.component`
    )
  ];
  return files
    .flatMap((file) =>
      ['ts', 'html'].map((extension) =>
        readFileSync(`${root}${file}.${extension}`, 'utf8')
      )
    )
    .join('\n');
}
