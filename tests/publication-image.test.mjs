import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  preparePublicationImage,
  preparePortraitImage,
  PUBLICATION_IMAGE_TRANSFORM,
  PUBLICATION_PORTRAIT_TRANSFORM
} from '../dist/apps/funding-api/src/publication-image.service.js';

const usage = {
  state: 'confirmed',
  channels: ['website', 'facebook', 'linkedin'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
async function portraitInput() {
  const bytes = await sharp({
    create: {
      width: 40,
      height: 100,
      channels: 4,
      background: { r: 200, g: 20, b: 10, alpha: 0.5 }
    }
  })
    .png()
    .toBuffer();
  return {
    contributionId: 'synthetic-owner',
    name: 'Atelier <Montréal>',
    credit: usage.credit,
    bytes,
    channel: 'facebook',
    target: 'openg7',
    media: {
      contributionId: 'synthetic-owner',
      kind: 'supporting_image',
      moderationApproved: true,
      usage,
      restrictionsReviewed: false
    }
  };
}
test('JPEG preparation is deterministic, strips alpha and supplies the actual preview/send checksum', async () => {
  const { bytes } = await portraitInput();
  const first = await preparePublicationImage(bytes),
    second = await preparePublicationImage(bytes);
  assert.deepEqual(first, second);
  assert.equal(
    first.sha256,
    createHash('sha256').update(first.bytes).digest('hex')
  );
  assert.equal(first.transform, PUBLICATION_IMAGE_TRANSFORM);
  const metadata = await sharp(first.bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 100);
});
test('portrait contains a complete owned/approved image, name and credit in reproducible JPEG bytes', async () => {
  const input = await portraitInput();
  const first = await preparePortraitImage(input),
    second = await preparePortraitImage(input);
  assert.deepEqual(first, second);
  assert.equal(first.transform, PUBLICATION_PORTRAIT_TRANSFORM);
  const metadata = await sharp(first.bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1024);
  const changed = await preparePortraitImage({
    ...input,
    name: 'Another complete name'
  });
  assert.notEqual(changed.sha256, first.sha256);
  const changedCredit = await preparePortraitImage({
    ...input,
    credit: 'Photo : Another author',
    media: {
      ...input.media,
      usage: { ...usage, credit: 'Photo : Another author' }
    }
  });
  assert.notEqual(changedCredit.sha256, first.sha256);
});
test('portrait rejects another dossier, a logo, missing N0 and missing explicit portrait permission', async () => {
  const input = await portraitInput();
  for (const [media, code] of [
    [
      { ...input.media, contributionId: 'another-owner' },
      'PORTRAIT_PHOTO_OWNER_REQUIRED'
    ],
    [{ ...input.media, kind: 'logo' }, 'PORTRAIT_PHOTO_OWNER_REQUIRED'],
    [{ ...input.media, moderationApproved: false }, 'MEDIA_NOT_APPROVED'],
    [
      { ...input.media, usage: { ...usage, transformations: ['technical'] } },
      'MEDIA_TRANSFORMATION_NOT_AUTHORIZED'
    ],
    [
      { ...input.media, usage: { ...usage, state: 'withdrawn' } },
      'MEDIA_USAGE_WITHDRAWN'
    ]
  ])
    await assert.rejects(
      preparePortraitImage({ ...input, media }),
      (error) => error.code === code
    );
});
test('portrait fails closed on channel/target, human restrictions and missing exact credit', async () => {
  const input = await portraitInput();
  await assert.rejects(
    preparePortraitImage({ ...input, target: 'openg20' }),
    (error) => error.code === 'MEDIA_TARGET_NOT_AUTHORIZED'
  );
  await assert.rejects(
    preparePortraitImage({ ...input, credit: null }),
    (error) => error.code === 'MEDIA_CREDIT_REQUIRED'
  );
  await assert.rejects(
    preparePortraitImage({
      ...input,
      media: {
        ...input.media,
        usage: { ...usage, restrictions: 'Use only with a verified caption.' }
      }
    }),
    (error) => error.code === 'MEDIA_RESTRICTIONS_REVIEW_REQUIRED'
  );
  await assert.rejects(
    preparePortraitImage({
      ...input,
      media: { ...input.media, usage: { ...usage, channels: ['linkedin'] } }
    }),
    (error) => error.code === 'MEDIA_CHANNEL_NOT_AUTHORIZED'
  );
  await assert.rejects(
    preparePortraitImage({ ...input, name: 'W'.repeat(301) }),
    (error) => error.code === 'PORTRAIT_LABEL_TOO_LONG'
  );
});
