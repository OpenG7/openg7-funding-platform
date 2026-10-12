import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  resolveMedia,
  mediaSnapshotIssue
} from '../dist/apps/funding-api/src/publication-automation/media.js';

test('approved source checksum is checked before preparing or freezing any JPEG bytes', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    assert.fail('Image preparation must not contact any provider.')
  );
  const bytes = await sharp({
    create: { width: 4, height: 8, channels: 3, background: '#ff4400' }
  })
    .png()
    .toBuffer();
  const record = {
    id: '10000000-0000-4000-8000-000000000402',
    url: '/api/public/sponsor-media/10000000-0000-4000-8000-000000000402',
    alt: 'Reviewed owned photograph',
    key: 'synthetic/private.webp',
    version: 'v1',
    hash: createHash('sha256').update(bytes).digest('hex'),
    usage: {
      state: 'confirmed',
      channels: ['facebook'],
      targets: ['openg7'],
      transformations: ['technical'],
      credit: null,
      restrictions: null
    },
    restrictionsReviewed: false
  };
  const db = { query: async () => ({ rows: [record] }) };
  let currentBytes = bytes;
  const storage = { readPrivateObject: async () => currentBytes };
  const media = await resolveMedia(db, storage, record.id, null, false, {
    feedId: 'openg7:facebook',
    message: 'Exact reviewed caption'
  });
  assert.equal(media.hash, record.hash);
  assert.match(media.derivedHash, /^[a-f0-9]{64}$/);
  assert.equal(mediaSnapshotIssue(record.id, media, record), null);
  currentBytes = await sharp({
    create: { width: 4, height: 8, channels: 3, background: '#00ff22' }
  })
    .png()
    .toBuffer();
  await assert.rejects(
    resolveMedia(db, storage, record.id, null, false, {
      feedId: 'openg7:facebook',
      message: 'Exact reviewed caption'
    }),
    (error) => error.code === 'MEDIA_CHANGED'
  );
  assert.equal(
    mediaSnapshotIssue(record.id, media, { ...record, hash: 'b'.repeat(64) }),
    'MEDIA_CHANGED'
  );
});
