import { createHash } from 'node:crypto';

import sharp from 'sharp';

/** A private display derivative, never a publication preview or a change to reviewed bytes. */
export async function sponsorMediaThumbnail(
  bytes: Buffer,
  checksum: string
): Promise<Buffer> {
  if (createHash('sha256').update(bytes).digest('hex') !== checksum)
    throw new Error('MEDIA_CHANGED');
  return sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 320,
      height: 240,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 75 })
    .toBuffer();
}
