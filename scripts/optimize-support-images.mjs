import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

// Support hero derivatives; preserve the PNG used by other pages.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'apps/funding-web/src/assets');
const name = 'fonds-des-batisseurs-canada-coffre-lumineux';
for (const width of [960, 1920]) {
  const result = await sharp(path.join(assets, `${name}.png`))
    .resize({ width })
    .webp({ quality: 80, effort: 6 })
    .toFile(path.join(assets, `${name}-${width}.webp`));
  console.log(
    `${name}-${width}.webp: ${result.size} bytes (${result.width} × ${result.height})`
  );
}
