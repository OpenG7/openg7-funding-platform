import { generateWebpDerivative } from './lib/image-derivatives.mjs';

// Reproducible display derivatives; the source remains available to other pages.
const stem = 'openg7-social-communautes-connectees-canada';
for (const width of [960, 1920]) {
  const result = await generateWebpDerivative(stem, width);
  console.log(
    `${width}: ${result.width}x${result.height}, ${result.size} bytes`
  );
}
