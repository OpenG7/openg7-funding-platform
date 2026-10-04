import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Historical source coverage follows the page, presentation and delivery owner.
// Accounting UI fixtures verify the actual bindings and behavior in a browser.
export function readAdminAccountingSource(page) {
  const root = `apps/funding-web/src/app/features/funding/pages/admin-${page}-page`;
  const sources = readdirSync(root)
    .filter((name) => /\.(?:ts|html|css)$/.test(name))
    .sort()
    .map((name) => readFileSync(join(root, name), 'utf8'));
  if (page === 'invoices') {
    sources.push(
      ...[
        'admin-document-delivery-controller.ts',
        'admin-document-delivery-browser.ts'
      ].map((name) =>
        readFileSync(
          `apps/funding-web/src/app/features/funding/services/${name}`,
          'utf8'
        )
      )
    );
  }
  return sources.join('\n');
}
