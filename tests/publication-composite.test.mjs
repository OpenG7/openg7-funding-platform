import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { preparePublicationComposite } from '../dist/apps/funding-api/src/publication-composite.service.js';

test('collective images retain every participant, credit and original aspect ratio deterministically', async () => {
  const photo = await sharp({
    create: {
      width: 70,
      height: 100,
      channels: 4,
      background: { r: 220, g: 50, b: 80, alpha: 0.5 }
    }
  })
    .png()
    .toBuffer();
  const sources = Array.from({ length: 8 }, (_, i) => ({
    contributionId: `synthetic-${i}`,
    name: `Atelier ${i} — Montréal`,
    credit: 'Photo : exemple synthétique',
    bytes: photo
  }));
  const first = await preparePublicationComposite(sources);
  const replay = await preparePublicationComposite(sources);
  assert.deepEqual(first.bytes, replay.bytes);
  assert.equal(first.sha256, replay.sha256);
  assert.deepEqual(
    first.contributionIds,
    sources.map((s) => s.contributionId)
  );
  const metadata = await sharp(first.bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 1200);
  assert.ok(metadata.height > 0);
  await assert.rejects(
    preparePublicationComposite([...sources, sources[0]]),
    /COMPOSITE_PARTICIPANTS_INVALID/
  );
  await assert.rejects(
    preparePublicationComposite([{ ...sources[0], name: 'X'.repeat(301) }]),
    /COMPOSITE_LABEL_TOO_LONG/
  );
  const literal = await preparePublicationComposite([
    { ...sources[0], name: '<span size="100000">literal markup</span>' }
  ]);
  assert.equal((await sharp(literal.bytes).metadata()).format, 'jpeg');
});
