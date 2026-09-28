import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

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

test('image dimensions are bounded independently from compressed file size', async () => {
  const data = await sharp({
    create: { width: 8001, height: 5000, channels: 3, background: '#123456' }
  })
    .png()
    .toBuffer();
  assert.ok(data.length < 8388608);
  await assert.rejects(() =>
    processSponsorImage({
      data,
      kind: 'supporting_image',
      originalFilename: 'synthetic.png'
    })
  );
  const normal = await sharp({
    create: { width: 2400, height: 1200, channels: 3, background: '#123456' }
  })
    .png()
    .toBuffer();
  for (const [kind, width, height] of [
    ['logo', 1200, 600],
    ['supporting_image', 2000, 1000]
  ]) {
    const image = await processSponsorImage({
      data: normal,
      kind,
      originalFilename: 'synthetic.png'
    });
    assert.equal(image.width, width);
    assert.equal(image.height, height);
  }
});
