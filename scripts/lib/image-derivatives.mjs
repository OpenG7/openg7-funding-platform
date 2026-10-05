import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

export const fundingAssetsDirectory = fileURLToPath(
  new URL('../../apps/funding-web/src/assets/', import.meta.url)
);

// Keep display derivatives reproducible without modifying their source PNGs.
export function generateWebpDerivative(
  name,
  width,
  assetsDirectory = fundingAssetsDirectory
) {
  return sharp(path.join(assetsDirectory, `${name}.png`))
    .resize({ width })
    .webp({ quality: 80, effort: 6 })
    .toFile(path.join(assetsDirectory, `${name}-${width}.webp`));
}
