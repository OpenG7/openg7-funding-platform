import { readFileSync } from 'node:fs';

// Preserve source coverage across the page, its panels and local workflows.
// Actual interactions are covered by admin-publication-queue.spec.ts.
export const readAdminPublicationsSource = () => {
  const root =
    'apps/funding-web/src/app/features/funding/pages/admin-publications-page/';
  const paths = [
    'admin-publications-page.component.ts',
    'admin-publications-page.component.html',
    'publication-panels.helpers.ts',
    'panels/admin-publication-drafts-workflow.ts',
    'panels/admin-publication-batches-workflow.ts',
    'panels/admin-publication-slots-workflow.ts',
    ...['drafts', 'batches', 'slots'].flatMap((name) =>
      ['ts', 'html'].map(
        (extension) =>
          'panels/admin-publication-' + name + '-panel.component.' + extension
      )
    )
  ];
  return paths.map((path) => readFileSync(root + path, 'utf8')).join('\n');
};
