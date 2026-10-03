import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Historical source coverage follows the routed page and its local surfaces.
// Browser fixtures verify their bindings and interactions separately.
export function readAdminSurfaceSource(page) {
  const root = `apps/funding-web/src/app/features/funding/pages/admin-${page}-page`;
  const readDirectory = (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return readDirectory(path);
        return /\.(?:ts|html|css)$/.test(entry.name)
          ? [readFileSync(path, 'utf8')]
          : [];
      });
  return readDirectory(root).join('\n');
}
