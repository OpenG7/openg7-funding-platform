import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  reviewSponsorMediaAsset
} from '../dist/apps/funding-api/src/sponsor-media.repository.js';

const contributionId = '10000000-0000-4000-8000-000000000001';
const assetId = '10000000-0000-4000-8000-000000000002';
const replacementId = '10000000-0000-4000-8000-000000000003';
const version = '2026-09-01 00:00:00+00';

const assetRow = (overrides = {}) => ({
  id: assetId,
  contribution_id: contributionId,
  kind: 'logo',
  review_status: 'pending_review',
  uploaded_by: 'sponsor',
  original_filename: 'synthetic.png',
  original_mime_type: 'image/png',
  original_size_bytes: 100,
  original_storage_key: 'synthetic/original.png',
  processed_mime_type: 'image/webp',
  processed_size_bytes: 80,
  processed_storage_key: 'synthetic/processed.webp',
  public_storage_key: null,
  public_url: null,
  checksum_sha256: '0'.repeat(64),
  width: 1,
  height: 1,
  alt_text: null,
  sort_order: 0,
  reviewed_at: null,
  version,
  created_at: version,
  deleted_at: null,
  ...overrides
});

const uploadInput = (overrides = {}) => ({
  id: replacementId,
  contributionId,
  kind: 'logo',
  uploadedBy: 'sponsor',
  originalFilename: 'synthetic.png',
  originalMimeType: 'image/png',
  originalSizeBytes: 100,
  originalStorageKey: 'synthetic/replacement-original.png',
  processedSizeBytes: 80,
  processedStorageKey: 'synthetic/replacement-processed.webp',
  checksumSha256: '1'.repeat(64),
  width: 1,
  height: 1,
  altText: null,
  maxSupportingImages: 3,
  ...overrides
});

const fixture = ({ contribution, assets = [], failures = {} } = {}) => {
  let committed = {
    contribution:
      contribution === undefined
        ? {
            id: contributionId,
            status: 'paid',
            sponsor_review_status: 'approved'
          }
        : contribution,
    assets
  };
  let transaction;
  const calls = [];
  const client = {
    async query(command, parameters = []) {
      const sql = command.replace(/\s+/g, ' ').trim();
      calls.push(sql);
      const failure = Object.entries(failures).find(([prefix]) =>
        sql.startsWith(prefix)
      );
      if (failure) throw failure[1];
      if (sql === 'BEGIN') transaction = structuredClone(committed);
      else if (sql === 'COMMIT') committed = transaction;
      else if (sql === 'ROLLBACK') transaction = null;
      else if (sql.includes('FROM fund_contributions')) {
        return {
          rows: transaction.contribution ? [transaction.contribution] : []
        };
      } else if (sql.startsWith('UPDATE fund_contributions')) {
        transaction.contribution.sponsor_review_status = 'pending_review';
      } else if (sql.startsWith('UPDATE sponsor_media_assets')) {
        transaction.assets.find((row) => row.id === parameters[0]).deleted_at =
          version;
      } else if (sql.startsWith('INSERT INTO sponsor_media_assets')) {
        const row = assetRow({
          id: parameters[0],
          contribution_id: parameters[1],
          kind: parameters[2],
          uploaded_by: parameters[3],
          original_storage_key: parameters[7],
          processed_storage_key: parameters[9],
          checksum_sha256: parameters[10],
          sort_order: parameters[14]
        });
        transaction.assets.push(row);
        return { rows: [row] };
      } else if (sql.includes('FROM sponsor_media_assets')) {
        const active = transaction.assets.filter((row) => !row.deleted_at);
        if (sql.startsWith('SELECT COUNT(*)'))
          return {
            rows: [
              {
                count: String(
                  active.filter((row) => row.kind === 'supporting_image').length
                )
              }
            ]
          };
        if (sql.startsWith('SELECT COALESCE(MAX(sort_order)'))
          return { rows: [{ next_order: active.length }] };
        if (sql.includes("kind = 'logo'"))
          return { rows: active.filter((row) => row.kind === 'logo') };
        return { rows: active.filter((row) => row.id === parameters[0]) };
      } else throw new Error(`Unexpected synthetic query: ${sql}`);
      return { rows: [], rowCount: 0 };
    },
    release() {
      calls.push('release');
    }
  };
  return {
    calls,
    state: () => committed,
    pool: {
      async connect() {
        calls.push('connect');
        return client;
      }
    }
  };
};

const assertClosed = (calls, command) => {
  assert.equal(calls.filter((call) => call === command).length, 1);
  assert.equal(calls.filter((call) => call === 'release').length, 1);
  assert.deepEqual(calls.slice(-2), [command, 'release']);
  assert.equal(
    calls.includes(command === 'COMMIT' ? 'ROLLBACK' : 'COMMIT'),
    false
  );
};

test('media creation rolls back every business refusal without changing the dossier or assets', async (t) => {
  for (const scenario of [
    { status: 'contribution_not_found', contribution: null },
    {
      status: 'not_editable',
      contribution: { status: 'paid', sponsor_review_status: 'rejected' }
    },
    {
      status: 'logo_locked',
      assets: [assetRow({ review_status: 'approved' })]
    },
    {
      status: 'supporting_image_limit_reached',
      input: { kind: 'supporting_image' },
      assets: [1, 2, 3].map((index) =>
        assetRow({ id: String(index), kind: 'supporting_image' })
      )
    }
  ]) {
    await t.test(scenario.status, async () => {
      const { calls, pool, state } = fixture(scenario);
      const before = structuredClone(state());
      assert.deepEqual(
        await createSponsorMediaAsset(pool, uploadInput(scenario.input)),
        { status: scenario.status }
      );
      assert.deepEqual(state(), before);
      assertClosed(calls, 'ROLLBACK');
    });
  }
});

test('logo replacement commits the new asset, old soft deletion and sponsor review together', async () => {
  const { calls, pool, state } = fixture({ assets: [assetRow()] });
  const result = await createSponsorMediaAsset(pool, uploadInput());
  assert.equal(result.status, 'created');
  assert.equal(result.asset.id, replacementId);
  assert.equal(result.replaced.id, assetId);
  assert.equal(
    state().assets.find((row) => row.id === assetId).deleted_at,
    version
  );
  assert.deepEqual(
    state()
      .assets.filter((row) => !row.deleted_at)
      .map((row) => row.id),
    [replacementId]
  );
  assert.equal(state().contribution.sponsor_review_status, 'pending_review');
  assertClosed(calls, 'COMMIT');
});

test('failed logo replacement avoids commit and preserves the insert error through rollback failure', async (t) => {
  for (const rollbackFails of [false, true]) {
    await t.test(
      rollbackFails ? 'rollback also fails' : 'rollback succeeds',
      async () => {
        const original = new Error('Synthetic insert failure');
        const failures = { 'INSERT INTO sponsor_media_assets': original };
        if (rollbackFails)
          failures.ROLLBACK = new Error('Synthetic rollback failure');
        const { calls, pool, state } = fixture({
          assets: [assetRow()],
          failures
        });
        const before = structuredClone(state());
        await assert.rejects(
          createSponsorMediaAsset(pool, uploadInput()),
          (error) => error === original
        );
        assert.ok(
          calls.some((sql) => sql.startsWith('UPDATE sponsor_media_assets'))
        );
        assert.deepEqual(state(), before);
        assertClosed(calls, 'ROLLBACK');
      }
    );
  }
});

test('media deletion rolls back refusals and keeps the current asset', async (t) => {
  for (const scenario of [
    { status: 'not_found', assets: [] },
    {
      status: 'not_found',
      assets: [assetRow({ contribution_id: 'another-synthetic-dossier' })]
    },
    {
      status: 'not_editable',
      contribution: { status: 'paid', sponsor_review_status: 'rejected' }
    },
    {
      status: 'approved_locked',
      assets: [assetRow({ review_status: 'approved' })]
    },
    { status: 'conflict', expectedVersion: 'stale-version' }
  ]) {
    await t.test(scenario.status, async () => {
      const { calls, pool, state } = fixture({
        assets: [assetRow()],
        ...scenario
      });
      const before = structuredClone(state());
      const result = await deleteSponsorMediaAsset(pool, {
        assetId,
        contributionId,
        expectedVersion: scenario.expectedVersion ?? version,
        allowApproved: false
      });
      assert.equal(result.status, scenario.status);
      assert.deepEqual(state(), before);
      assertClosed(calls, 'ROLLBACK');
    });
  }
});

test('media deletion commits after locking the sponsor dossier before the asset', async () => {
  const { calls, pool, state } = fixture({ assets: [assetRow()] });
  const result = await deleteSponsorMediaAsset(pool, {
    assetId,
    contributionId,
    expectedVersion: version,
    allowApproved: false
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.asset.id, assetId);
  assert.equal(state().assets[0].deleted_at, version);
  const locks = calls.filter((sql) => sql.includes('FOR UPDATE'));
  assert.equal(locks.length, 2);
  assert.match(locks[0], /FROM fund_contributions/);
  assert.match(locks[1], /FROM sponsor_media_assets/);
  assertClosed(calls, 'COMMIT');
});

const reviewInput = {
  assetId,
  expectedVersion: version,
  reviewStatus: 'approved',
  altText: 'Synthetic logo',
  publicStorageKey: 'synthetic/public.webp',
  publicUrl: 'https://example.test/synthetic.webp',
  reviewedBy: 'synthetic-admin'
};

test('media review returns the accepted version and storage references', async () => {
  const reviewedVersion = '2026-09-02 00:00:00+00';
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return {
        rows: [
          assetRow({
            review_status: 'approved',
            alt_text: reviewInput.altText,
            public_storage_key: reviewInput.publicStorageKey,
            public_url: reviewInput.publicUrl,
            reviewed_at: reviewedVersion,
            version: reviewedVersion
          })
        ]
      };
    }
  };
  const result = await reviewSponsorMediaAsset(pool, reviewInput);
  assert.equal(result.status, 'updated');
  assert.equal(result.asset.version, reviewedVersion);
  assert.equal(result.asset.reviewStatus, 'approved');
  assert.equal(result.asset.altText, reviewInput.altText);
  assert.equal(result.asset.publicStorageKey, reviewInput.publicStorageKey);
  assert.equal(
    result.asset.publicUrl,
    `/api/public/sponsor-media/${result.asset.id}`
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].parameters, [
    assetId,
    reviewInput.reviewStatus,
    reviewInput.altText,
    reviewInput.publicStorageKey,
    reviewInput.publicUrl,
    reviewInput.reviewedBy,
    version
  ]);
});

test('media review distinguishes stale versions from missing assets through a fresh lookup', async (t) => {
  const currentVersion = '2026-09-02 00:00:00+00';
  for (const current of [assetRow({ version: currentVersion }), null]) {
    await t.test(current ? 'conflict' : 'not_found', async () => {
      const calls = [];
      const responses = [[], current ? [current] : []];
      const pool = {
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          assert.ok(responses.length, 'Unexpected database query');
          return { rows: responses.shift() };
        }
      };
      const result = await reviewSponsorMediaAsset(pool, reviewInput);
      assert.equal(result.status, current ? 'conflict' : 'not_found');
      assert.equal(
        result.asset?.version ?? null,
        current ? currentVersion : null
      );
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].parameters, [assetId]);
    });
  }
});
