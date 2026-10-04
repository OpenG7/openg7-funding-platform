import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkSponsorMediaUpload,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listPublicSponsorMediaByContributionIds,
  listSponsorMediaAssets
} from '../dist/apps/funding-api/src/sponsor-media.repository.js';

const contributionId = '10000000-0000-4000-8000-000000000001';
const assetId = '10000000-0000-4000-8000-000000000002';
const version = '2026-09-01 00:00:00+00';

const assetRow = (overrides = {}) => ({
  id: assetId,
  contribution_id: contributionId,
  kind: 'logo',
  review_status: 'approved',
  uploaded_by: 'sponsor',
  original_filename: 'synthetic.png',
  original_mime_type: 'image/png',
  original_size_bytes: 100,
  original_storage_key: 'synthetic/original.png',
  processed_mime_type: 'image/webp',
  processed_size_bytes: 80,
  processed_storage_key: 'synthetic/processed.webp',
  public_storage_key: 'synthetic/public.webp',
  public_url: 'https://example.test/synthetic.webp',
  checksum_sha256: '0'.repeat(64),
  width: 640,
  height: 480,
  alt_text: 'Synthetic logo',
  sort_order: 0,
  reviewed_at: version,
  version,
  created_at: version,
  ...overrides
});

const queryFixture = (...responses) => {
  const calls = [];
  return {
    calls,
    pool: {
      async query(sql, parameters) {
        calls.push({ sql, parameters });
        assert.ok(responses.length, 'Unexpected database query');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return { rows: response };
      }
    }
  };
};

test('media reads retain their empty results without a database or asset', async () => {
  assert.deepEqual(await listSponsorMediaAssets(null, contributionId), []);
  assert.equal(await getSponsorMediaStorageRecord(null, assetId), null);
  assert.equal(await getApprovedPublicSponsorMedia(null, assetId), null);
  assert.equal(
    await checkSponsorMediaUpload(null, contributionId, 'logo', 3),
    'contribution_not_found'
  );
  assert.equal(
    (await listPublicSponsorMediaByContributionIds(null, [contributionId]))
      .size,
    0
  );

  const { pool } = queryFixture([], []);
  assert.equal(await getSponsorMediaStorageRecord(pool, assetId), null);
  assert.equal(await getApprovedPublicSponsorMedia(pool, assetId), null);
});

test('dossier assets omit storage keys while storage lookups retain cleanup metadata', async () => {
  const row = assetRow();
  const { pool, calls } = queryFixture([row], [row], [row]);
  const assets = await listSponsorMediaAssets(pool, contributionId);
  assert.deepEqual(assets, [
    {
      id: assetId,
      contributionId,
      kind: 'logo',
      reviewStatus: 'approved',
      uploadedBy: 'sponsor',
      originalFilename: 'synthetic.png',
      originalMimeType: 'image/png',
      originalSizeBytes: 100,
      processedMimeType: 'image/webp',
      processedSizeBytes: 80,
      width: 640,
      height: 480,
      altText: 'Synthetic logo',
      sortOrder: 0,
      publicUrl: 'https://example.test/synthetic.webp',
      reviewedAt: version,
      version,
      createdAt: version
    }
  ]);
  const expectedRecord = {
    ...assets[0],
    originalStorageKey: row.original_storage_key,
    processedStorageKey: row.processed_storage_key,
    publicStorageKey: row.public_storage_key,
    checksumSha256: row.checksum_sha256
  };
  assert.deepEqual(
    await getSponsorMediaStorageRecord(pool, assetId),
    expectedRecord
  );
  assert.deepEqual(
    await getApprovedPublicSponsorMedia(pool, assetId),
    expectedRecord
  );
  assert.deepEqual(
    calls.map((call) => call.parameters),
    [[contributionId], [assetId], [assetId]]
  );
});

test('upload preflight keeps eligibility, approved-logo locking and the configured quota', async (t) => {
  const editable = {
    status: 'paid',
    sponsor_review_status: 'pending_review',
    supporting_count: '0',
    approved_logo: false
  };
  for (const scenario of [
    { expected: 'contribution_not_found', rows: [] },
    {
      expected: 'not_editable',
      row: { sponsor_review_status: 'rejected' }
    },
    { expected: 'not_editable', row: { status: 'pending' } },
    { expected: 'logo_locked', row: { approved_logo: true } },
    {
      expected: 'allowed',
      row: { status: 'refunded' }
    },
    {
      expected: 'supporting_image_limit_reached',
      kind: 'supporting_image',
      row: { supporting_count: '3' }
    },
    {
      expected: 'allowed',
      kind: 'supporting_image',
      row: { status: 'disputed', supporting_count: '2', approved_logo: true }
    }
  ]) {
    await t.test(scenario.expected, async () => {
      const { pool, calls } = queryFixture(
        scenario.rows ?? [{ ...editable, ...scenario.row }]
      );
      assert.equal(
        await checkSponsorMediaUpload(
          pool,
          contributionId,
          scenario.kind ?? 'logo',
          3
        ),
        scenario.expected
      );
      assert.deepEqual(
        calls.map((call) => call.parameters),
        [[contributionId]]
      );
    });
  }
});

test('public media groups preserve row order and trim or supply image alt text', async () => {
  const otherContributionId = '10000000-0000-4000-8000-000000000003';
  const first = assetRow({
    alt_text: '  Public logo  ',
    company_name: 'Synthetic'
  });
  const second = assetRow({
    id: '10000000-0000-4000-8000-000000000004',
    contribution_id: otherContributionId,
    company_name: 'Second Company',
    alt_text: '   '
  });
  const third = assetRow({
    id: '10000000-0000-4000-8000-000000000005',
    kind: 'supporting_image',
    company_name: 'Synthetic',
    sort_order: 2,
    alt_text: null
  });
  const { pool, calls } = queryFixture(
    [{ exists: true }],
    [first, second, third]
  );
  const ids = [contributionId, otherContributionId];
  const result = await listPublicSponsorMediaByContributionIds(pool, ids);
  const publicAsset = (row, altText) => ({
    id: row.id,
    kind: row.kind,
    url: row.public_url,
    width: row.width,
    height: row.height,
    alt_text: altText,
    sort_order: row.sort_order
  });
  assert.deepEqual(
    [...result],
    [
      [
        contributionId,
        [
          publicAsset(first, 'Public logo'),
          publicAsset(third, 'Synthetic - image commanditaire')
        ]
      ],
      [
        otherContributionId,
        [publicAsset(second, 'Second Company - image commanditaire')]
      ]
    ]
  );
  assert.deepEqual(calls[1].parameters, [ids]);
});

test('public media skips empty requests and databases without the media table', async () => {
  const { pool, calls } = queryFixture([{ exists: false }]);
  assert.equal(
    (await listPublicSponsorMediaByContributionIds(pool, [])).size,
    0
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await listPublicSponsorMediaByContributionIds(pool, [contributionId]))
      .size,
    0
  );
  assert.equal(calls.length, 1);
});

test('media reads propagate database failures', async (t) => {
  for (const read of [
    (pool) => listSponsorMediaAssets(pool, contributionId),
    (pool) => getSponsorMediaStorageRecord(pool, assetId),
    (pool) => getApprovedPublicSponsorMedia(pool, assetId),
    (pool) => checkSponsorMediaUpload(pool, contributionId, 'logo', 3),
    (pool) => listPublicSponsorMediaByContributionIds(pool, [contributionId])
  ]) {
    await t.test(async () => {
      const error = new Error('Synthetic database failure');
      const { pool } = queryFixture(error);
      await assert.rejects(read(pool), (actual) => actual === error);
    });
  }
});
