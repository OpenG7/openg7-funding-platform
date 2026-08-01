import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { processSponsorImage } from '../dist/apps/funding-api/src/sponsor-image.service.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('sponsor image processing decodes PNG content and produces private WebP output', async () => {
  const result = await processSponsorImage({
    data: onePixelPng,
    kind: 'supporting_image',
    originalFilename: '../../presentation\n.png'
  });

  assert.equal(result.originalFilename, 'presentation.png');
  assert.equal(result.originalMimeType, 'image/png');
  assert.equal(result.originalExtension, 'png');
  assert.equal(result.originalSizeBytes, onePixelPng.byteLength);
  assert.equal(result.processedMimeType, 'image/webp');
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.ok(result.processedSizeBytes > 0);
  assert.equal(
    result.checksumSha256,
    createHash('sha256').update(result.processedData).digest('hex')
  );
  assert.deepEqual(result.originalData, onePixelPng);
});

test('sponsor image processing rejects bytes that are not a supported image', async () => {
  await assert.rejects(
    () =>
      processSponsorImage({
        data: Buffer.from('<svg><script>alert(1)</script></svg>'),
        kind: 'logo',
        originalFilename: 'logo.png'
      }),
    /unsupported image format|valid JPEG, PNG, or WebP/i
  );
});
