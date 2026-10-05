import { generateWebpDerivative } from './lib/image-derivatives.mjs';

// Support hero derivatives; preserve the PNG used by other pages.
const name = 'fonds-des-batisseurs-canada-coffre-lumineux';
for (const width of [960, 1920]) {
  const result = await generateWebpDerivative(name, width);
  console.log(
    `${name}-${width}.webp: ${result.size} bytes (${result.width} × ${result.height})`
  );
}
