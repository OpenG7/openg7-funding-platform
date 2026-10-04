import { readFileSync } from 'node:fs';

// Source coverage follows the page composition and its extracted responsibilities.
// Dedicated workflow tests and the admin UI suite verify runtime behavior.
export const readAdminSponsorsSource = () => {
  const root = 'apps/funding-web/src/app/features/funding/';
  return [
    'pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'models/admin-sponsor-workflow.ports.ts',
    'models/admin-sponsor-history.projection.ts',
    'models/admin-sponsor-presentation.projection.ts',
    'models/admin-sponsor-dossier-panels.ts',
    ...[
      'admin-sponsor-publication-panel',
      'admin-sponsor-refund-history',
      'admin-sponsor-audit-history',
      'admin-sponsor-rejection-panel',
      'admin-sponsor-refund-panel',
      'admin-sponsor-decision-actions'
    ].flatMap((name) =>
      ['ts', 'html', 'css'].map(
        (extension) =>
          `components/admin-sponsors/${name}.component.${extension}`
      )
    ),
    'services/admin-sponsor-review-workflow.ts',
    'services/admin-sponsor-publication-workflow.ts',
    'services/admin-sponsor-refund-workflow.ts',
    'services/admin-sponsor-media-workflow.ts',
    'services/admin-sponsor-list-controller.ts'
  ]
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
