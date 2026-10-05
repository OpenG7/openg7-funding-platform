import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fundingAssetsDirectory,
  generateWebpDerivative
} from './lib/image-derivatives.mjs';

// Reproducible display derivatives; source PNGs remain available to other pages.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(
  path.join(
    root,
    'apps/funding-web/src/app/features/funding/pages/funding-page/funding-page.component.ts'
  ),
  'utf8'
);
const cards = [...page.matchAll(/asset:\s*'assets\/([^']+)-480\.webp'/g)].map(
  (match) => match[1]
);
if (cards.length !== 13)
  throw new Error('Expected the 13 funding ecosystem images.');
const images = [
  ...cards.map((name) => ({ name, widths: [480, 960] })),
  {
    name: 'fonds-des-batisseurs-dragon-coffre-lumineux',
    widths: [960, 1672]
  },
  ...[
    'fonds-des-batisseurs-feuille-erable-lumineuse',
    'fonds-des-batisseurs-dragon-coffre-fort',
    'openg7-dragon-dime-coffre-fort',
    'openg7-coffre-fort-ferme-dragon'
  ].map((name) => ({ name, widths: [960, 1920] }))
];
await mkdir(fundingAssetsDirectory, { recursive: true });
let bytes = 0;
for (const { name, widths } of images) {
  for (const width of widths) {
    const result = await generateWebpDerivative(name, width);
    bytes += result.size;
  }
}
console.log(
  `Generated ${images.length * 2} WebP derivatives (${(bytes / 1024 / 1024).toFixed(2)} MiB).`
);
