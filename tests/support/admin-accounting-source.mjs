import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Historical source coverage spans the page and its local presentation pieces.
// Accounting UI fixtures verify the actual bindings and behavior in a browser.
export function readAdminAccountingSource(page) {
  const root = `apps/funding-web/src/app/features/funding/pages/admin-${page}-page`;
  return readdirSync(root)
    .filter((name) => /\.(?:ts|html|css)$/.test(name))
    .sort()
    .map((name) => readFileSync(join(root, name), 'utf8'))
    .join('\n');
}
