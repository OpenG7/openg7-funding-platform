import { readFileSync } from 'node:fs';

// Source coverage follows the page composition and its extracted responsibilities.
// Dedicated workflow tests and the admin UI suite verify runtime behavior.
export const readAdminSponsorsSource = () => {
  const root = 'apps/funding-web/src/app/features/funding/';
  return [
    'pages/admin-sponsors-page/admin-sponsors-page.component.ts',
    'models/admin-sponsor-workflow.ports.ts',
    'models/admin-sponsor-history.projection.ts',
    'services/admin-sponsor-refund-workflow.ts',
    'services/admin-sponsor-media-workflow.ts'
  ]
    .map((path) => readFileSync(root + path, 'utf8'))
    .join('\n');
};
