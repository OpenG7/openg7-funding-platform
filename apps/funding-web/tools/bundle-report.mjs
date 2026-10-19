import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const statsFile = resolve(
  process.argv[2] ?? resolve(root, 'dist/apps/funding-web/stats.json')
);

try {
  const { outputs } = JSON.parse(readFileSync(statsFile, 'utf8'));
  if (!outputs || typeof outputs !== 'object')
    throw new Error('Expected an Angular --stats-json build.');
  const entries = Object.entries(outputs);
  const main = entries.find(
    ([, output]) => output.entryPoint === 'apps/funding-web/src/main.ts'
  );
  if (!main) throw new Error('Browser main entry is missing.');
  const initial = new Set();
  const visit = (file) => {
    if (initial.has(file)) return;
    const output = outputs[file];
    if (!output) throw new Error(`Missing imported output: ${file}`);
    initial.add(file);
    for (const dependency of output.imports ?? []) {
      if (dependency.kind !== 'dynamic-import' && !dependency.external)
        visit(dependency.path);
    }
  };
  visit(main[0]);
  for (const [file, output] of entries) {
    if (output.entryPoint?.startsWith('angular:styles/global:')) visit(file);
  }
  const inputs = new Map();
  for (const file of initial) {
    for (const [input, { bytesInOutput }] of Object.entries(
      outputs[file].inputs ?? {}
    ))
      inputs.set(input, (inputs.get(input) ?? 0) + bytesInOutput);
  }
  const bySize = (a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file);
  const initialFiles = [...initial]
    .map((file) => ({ file, bytes: outputs[file].bytes }))
    .sort(bySize);
  const angular = JSON.parse(
    readFileSync(resolve(root, 'angular.json'), 'utf8')
  );
  console.log(
    JSON.stringify(
      {
        version: 1,
        initial: {
          bytes: initialFiles.reduce((sum, file) => sum + file.bytes, 0),
          files: initialFiles
        },
        largestInitialInputs: [...inputs]
          .map(([file, bytes]) => ({ file, bytes }))
          .sort(bySize)
          .slice(0, 15),
        largestLazyScripts: entries
          .filter(([file]) => file.endsWith('.js') && !initial.has(file))
          .map(([file, { bytes, entryPoint }]) => ({ file, bytes, entryPoint }))
          .sort(bySize)
          .slice(0, 10),
        budgets:
          angular.projects['funding-web'].architect.build.configurations
            .production.budgets,
        scope:
          'Raw static import graph, including global CSS; dynamic routes and locales are separate downloads. This is not a navigation transfer or runtime timing measurement.'
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(`Bundle report failed: ${error.message}`);
  process.exitCode = 1;
}
