import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Historical source coverage follows each page and its local modules.
// Workflow tests and UI fixtures verify runtime behavior separately.
export function readAdminOperationsSource(page) {
  const root = `apps/funding-web/src/app/features/funding/pages/admin-${page}-page`;
  return readdirSync(root)
    .filter((name) => /\.(?:ts|html|css)$/.test(name))
    .sort()
    .map((name) => readFileSync(join(root, name), 'utf8'))
    .join('\n');
}
