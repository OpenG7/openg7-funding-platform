import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  resolveMedia,
  resolvePreparedMedia,
  mediaSnapshotIssue
} from '../dist/apps/funding-api/src/publication-automation/media.js';
import { resolvePublicationVisual } from '../dist/apps/funding-api/src/publication-automation/visuals.js';
import { preparePublicationImage } from '../dist/apps/funding-api/src/publication-image.service.js';

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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const containsBuffer = (value) =>
  Buffer.isBuffer(value) ||
  (value !== null &&
    typeof value === 'object' &&
    Object.values(value).some(containsBuffer));

async function visualFixture(count) {
  const records = [];
  const objects = new Map();
  const preferences = new Map();
  const reads = [];
  for (let index = 0; index < count; index++) {
    const contributionId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const assetId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const bytes = await sharp({
      create: {
        width: 12 + index,
        height: 8 + index,
        channels: 4,
        background: { r: index * 20, g: 80, b: 160, alpha: 0.6 }
      }
    })
      .webp()
      .toBuffer();
    const record = {
      id: assetId,
      url: `/api/public/sponsor-media/${assetId}`,
      alt: `Owned photograph ${index + 1}`,
      key: `synthetic/private-${index + 1}.webp`,
      version: `asset-version-${index + 1}`,
      hash: sha256(bytes),
      usage: {
        state: 'confirmed',
        channels: ['facebook', 'linkedin'],
        targets: ['openg7'],
        transformations: ['technical', 'composite', 'portrait'],
        credit: null,
        restrictions: null
      },
      restrictionsReviewed: false
    };
    records.push({
      contributionId,
      name: `Synthetic owner ${index + 1}`,
      record
    });
    objects.set(record.key, bytes);
  }
  const db = {
    query: async (sql, parameters) => {
      if (sql.includes('FROM sponsor_media_preferences p')) {
        const preference = preferences.get(parameters[0]);
        return { rows: preference ? [preference] : [] };
      }
      const owner = records.find(({ record }) => record.id === parameters[0]);
      if (sql.includes('sponsor_company_name AS name'))
        return {
          rows:
            owner?.contributionId === parameters[1]
              ? [{ name: owner.name, kind: 'supporting_image' }]
              : []
        };
      if (sql.includes('m.checksum_sha256 AS hash'))
        return { rows: owner ? [owner.record] : [] };
      assert.fail('The fixture must recognize every visual eligibility query.');
    }
  };
  const storage = {
    readPrivateObject: async (key) => {
      reads.push(key);
      return objects.get(key) ?? null;
    }
  };
  const row = {
    id: '30000000-0000-4000-8000-000000000001',
    feed_id: 'openg7:linkedin',
    batch_id: '40000000-0000-4000-8000-000000000001',
    media_id: null,
    message: 'Exact reviewed caption',
    publication_format: 'image_collection',
    source_snapshot: [...records].reverse().map(({ contributionId }) => ({
      contribution_id: contributionId
    })),
    photo_selections: [...records]
      .reverse()
      .map(({ contributionId, record }) => ({
        contributionId,
        assetId: record.id,
        assetVersion: record.version
      }))
  };
  return { records, objects, preferences, reads, db, storage, row };
}

test('prepared media keeps source bytes and the exact JPEG outside the persisted snapshot', async () => {
  const f = await visualFixture(1);
  const { record } = f.records[0];
  const expected = await preparePublicationImage(f.objects.get(record.key));
  const resolved = await resolvePreparedMedia(
    f.db,
    f.storage,
    record.id,
    null,
    false,
    { feedId: f.row.feed_id, message: f.row.message }
  );
  assert.deepEqual(f.reads, [record.key]);
  assert.strictEqual(resolved.sourceBytes, f.objects.get(record.key));
  assert.deepEqual(resolved.prepared, expected);
  assert.equal(resolved.media.hash, record.hash);
  assert.equal(resolved.media.derivedHash, sha256(expected.bytes));
  assert.equal(mediaSnapshotIssue(record.id, resolved.media, record), null);
  assert.equal(containsBuffer(resolved.media), false);
  assert.deepEqual(
    Object.keys(resolved.media).sort(),
    [...Object.keys(record), 'derivedHash', 'transform'].sort()
  );
  assert.equal(await resolvePreparedMedia(f.db, f.storage, null), null);
  assert.deepEqual(f.reads, [record.key]);
});

test('a source image visual reuses one private read and one JPEG conversion', async (t) => {
  const f = await visualFixture(1);
  const { record } = f.records[0];
  const expected = await preparePublicationImage(f.objects.get(record.key));
  let conversions = 0;
  const originalJpeg = sharp.prototype.jpeg;
  t.mock.method(sharp.prototype, 'jpeg', function (...args) {
    conversions++;
    return originalJpeg.apply(this, args);
  });
  const visual = await resolvePublicationVisual(
    f.db,
    f.storage,
    {
      ...f.row,
      media_id: record.id,
      publication_format: 'collective_text',
      photo_selections: []
    },
    false
  );
  assert.deepEqual(f.reads, [record.key]);
  assert.equal(conversions, 1);
  assert.deepEqual(visual.prepared, expected);
  assert.equal(visual.snapshot.derivedHash, expected.sha256);
  assert.equal(containsBuffer(visual.snapshot), false);
});

for (const count of [2, 10])
  test(`an ordered collection of ${count} retains every exact JPEG with one private read and conversion per source`, async (t) => {
    const f = await visualFixture(count);
    const expected = await Promise.all(
      f.records.map(({ record }) =>
        preparePublicationImage(f.objects.get(record.key))
      )
    );
    let conversions = 0;
    const originalJpeg = sharp.prototype.jpeg;
    t.mock.method(sharp.prototype, 'jpeg', function (...args) {
      conversions++;
      return originalJpeg.apply(this, args);
    });
    const visual = await resolvePublicationVisual(
      f.db,
      f.storage,
      f.row,
      false
    );
    assert.deepEqual(
      f.reads,
      f.records.map(({ record }) => record.key)
    );
    assert.equal(conversions, count);
    assert.equal(visual.prepared.kind, 'collection');
    assert.equal(visual.prepared.images.length, count);
    assert.deepEqual(
      visual.snapshot.sources.map(({ contributionId }) => contributionId),
      f.records.map(({ contributionId }) => contributionId)
    );
    for (const [index, image] of visual.prepared.images.entries()) {
      assert.equal(image.contributionId, f.records[index].contributionId);
      assert.equal(image.assetId, f.records[index].record.id);
      assert.equal(image.alt, f.records[index].record.alt);
      assert.deepEqual(image.bytes, expected[index].bytes);
      assert.equal(image.sha256, expected[index].sha256);
      assert.equal(visual.snapshot.images[index].derivedHash, image.sha256);
      assert.equal(
        visual.snapshot.sources[index].media.derivedHash,
        image.sha256
      );
    }
    assert.equal(containsBuffer(visual.snapshot), false);
  });

test('a changed collection peer remains blocked even when the first requested photograph is unchanged', async () => {
  const f = await visualFixture(10);
  const first = f.records[0].record;
  const peer = f.records[9].record;
  f.objects.set(
    peer.key,
    Buffer.from('synthetic corrupted private photograph')
  );
  await assert.rejects(
    resolvePublicationVisual(f.db, f.storage, f.row, false),
    { code: 'MEDIA_CHANGED' }
  );
  assert.equal(sha256(f.objects.get(first.key)), first.hash);
  assert.deepEqual(
    f.reads,
    f.records.map(({ record }) => record.key)
  );
});

test('a collection peer with revoked usage rights is refused before reading that asset', async () => {
  const f = await visualFixture(2);
  const peer = f.records[1].record;
  peer.usage = { ...peer.usage, state: 'withdrawn' };
  await assert.rejects(
    resolvePublicationVisual(f.db, f.storage, f.row, false),
    { code: 'MEDIA_USAGE_WITHDRAWN' }
  );
  assert.deepEqual(f.reads, [f.records[0].record.key]);
});

test('a collection peer with a changed accepted preference cannot bypass full dependency validation', async () => {
  const f = await visualFixture(2);
  f.preferences.set(f.records[1].contributionId, {
    state: 'accepted',
    preferred_asset_id: f.records[0].record.id,
    available: true,
    revision: 2
  });
  await assert.rejects(
    resolvePublicationVisual(f.db, f.storage, f.row, false),
    { code: 'MEDIA_PREFERENCE_MISMATCH' }
  );
  assert.deepEqual(f.reads, [f.records[0].record.key]);
});
