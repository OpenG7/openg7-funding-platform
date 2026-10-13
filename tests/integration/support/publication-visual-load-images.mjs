import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import sharp from 'sharp';

export const VISUAL_LOAD_PHOTO_COUNT = 10;
export const VISUAL_LOAD_ORIGINAL_WIDTH = 6000;
export const VISUAL_LOAD_ORIGINAL_HEIGHT = 4000;
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

/** Distinct reproducible textured photographs; no flat-colour compression shortcut. */
export async function syntheticHighResolutionPhoto(index) {
  assert.ok(index >= 0 && index < VISUAL_LOAD_PHOTO_COUNT);
  const width = VISUAL_LOAD_ORIGINAL_WIDTH,
    height = VISUAL_LOAD_ORIGINAL_HEIGHT;
  const raw = Buffer.allocUnsafe(width * height * 3);
  let noise = 0x5f3759df ^ (index + 1);
  for (let y = 0, offset = 0; y < height; y++) {
    for (let x = 0; x < width; x++, offset += 3) {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      const grain = (noise >>> 24) & 63;
      raw[offset] = (x + index * 19 + grain) & 255;
      raw[offset + 1] = (y + index * 31 + grain) & 255;
      raw[offset + 2] = ((x >>> 3) + (y >>> 3) + index * 43 + grain) & 255;
    }
  }
  for (const quality of [80, 70, 60, 50]) {
    const bytes = await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality, chromaSubsampling: '4:2:0' })
      .toBuffer();
    if (bytes.length > 8 * 1024 * 1024) continue;
    assert.ok(
      bytes.length >= 1024 * 1024,
      'Use a substantial textured original, not a tiny compressed image'
    );
    return { bytes, quality };
  }
  assert.fail('Synthetic original exceeds the real upload limit');
}
