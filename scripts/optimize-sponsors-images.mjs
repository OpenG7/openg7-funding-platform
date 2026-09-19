import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Reproducible display derivatives; the source remains available to other pages.
const assets = new URL('../apps/funding-web/src/assets/', import.meta.url);
const stem = 'openg7-social-communautes-connectees-canada';
for (const width of [960, 1920]) {
  const result = await sharp(fileURLToPath(new URL(`${stem}.png`, assets)))
    .resize({ width })
    .webp({ quality: 80, effort: 6 })
    .toFile(fileURLToPath(new URL(`${stem}-${width}.webp`, assets)));
  console.log(
    `${width}: ${result.width}x${result.height}, ${result.size} bytes`
  );
}
