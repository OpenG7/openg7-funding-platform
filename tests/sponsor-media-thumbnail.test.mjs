import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { sponsorMediaThumbnail } from '../dist/apps/funding-api/src/sponsor-media-thumbnail.js';

test('private thumbnails use bounded derivatives while preserving the reviewed source', async () => {
  const bytes = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: '#4477aa' }
  })
    .webp()
    .toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const result = await sponsorMediaThumbnail(bytes, hash);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(metadata.width <= 320 && metadata.height <= 240);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  await assert.rejects(
    sponsorMediaThumbnail(bytes, '0'.repeat(64)),
    /MEDIA_CHANGED/
  );
});
