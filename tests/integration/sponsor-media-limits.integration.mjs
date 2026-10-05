import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  checkSponsorMediaUpload,
  createSponsorMediaAsset,
  deleteSponsorMediaAsset
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'media quotas serialize concurrent uploads and a refusal blocks uploads and deletion inside transactions',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      const contributionId = (
        await pool.query(`INSERT INTO fund_contributions
      (contribution_type, amount_cents, currency, status, sponsor_review_status)
      VALUES ('sponsorship_interest', 50000, 'cad', 'paid', 'pending_review') RETURNING id`)
      ).rows[0].id;
      const upload = (
        kind = 'supporting_image',
        uploadedBy = 'sponsor',
        id = randomUUID()
      ) =>
        createSponsorMediaAsset(pool, {
          id,
          contributionId,
          kind,
          uploadedBy,
          auditActor: 'synthetic-media-uploader',
          storageDriver: 'local',
          originalFilename: 'synthetic.png',
          originalMimeType: 'image/png',
          originalSizeBytes: 100,
          originalStorageKey: randomUUID() + '/original.png',
          processedSizeBytes: 80,
          processedStorageKey: randomUUID() + '/processed.webp',
          checksumSha256: '0'.repeat(64),
          width: 1,
          height: 1,
          altText: null,
          maxSupportingImages: 3
        });
      const first = await upload();
      assert.equal(first.status, 'created');
      assert.equal((await upload()).status, 'created');
      const concurrent = await Promise.all([upload(), upload()]);
      assert.deepEqual(concurrent.map((result) => result.status).sort(), [
        'created',
        'supporting_image_limit_reached'
      ]);
      assert.equal((await upload()).status, 'supporting_image_limit_reached');
      assert.equal(
        (await upload('supporting_image', 'admin')).status,
        'supporting_image_limit_reached'
      );
      assert.equal(
        await checkSponsorMediaUpload(
          pool,
          contributionId,
          'supporting_image',
          3
        ),
        'supporting_image_limit_reached'
      );
      const logo = await upload('logo');
      assert.equal(logo.status, 'created');
      assert.deepEqual(
        (
          await pool.query(
            `SELECT kind, COUNT(*)::int AS count FROM sponsor_media_assets
          WHERE contribution_id=$1 AND deleted_at IS NULL GROUP BY kind ORDER BY kind`,
            [contributionId]
          )
        ).rows,
        [
          { kind: 'logo', count: 1 },
          { kind: 'supporting_image', count: 3 }
        ]
      );
      await assert.rejects(
        upload('logo', 'sponsor', first.asset.id),
        (error) =>
          error.rollbackConfirmed === true && error.cause.code === '23505'
      );
      assert.deepEqual(
        (
          await pool.query(
            `SELECT id, deleted_at, updated_at::text AS version
             FROM sponsor_media_assets WHERE id=$1`,
            [logo.asset.id]
          )
        ).rows,
        [{ id: logo.asset.id, deleted_at: null, version: logo.asset.version }],
        'a failed replacement rolls back the previous logo deletion and version change'
      );
      await pool.query(
        "UPDATE sponsor_media_assets SET review_status='approved', public_storage_key='synthetic/logo.webp', public_url='https://example.test/logo.webp' WHERE id=$1",
        [logo.asset.id]
      );
      assert.equal(
        await checkSponsorMediaUpload(pool, contributionId, 'logo', 3),
        'logo_locked'
      );
      assert.equal((await upload('logo')).status, 'logo_locked');
      assert.equal((await upload('logo', 'admin')).status, 'logo_locked');
      // A refusal after a successful preflight must still block the final write.
      await pool.query(
        "UPDATE sponsor_media_assets SET review_status='pending_review', public_storage_key=NULL, public_url=NULL WHERE id=$1",
        [logo.asset.id]
      );
      assert.equal(
        await checkSponsorMediaUpload(pool, contributionId, 'logo', 3),
        'allowed'
      );
      await pool.query(
        "UPDATE fund_contributions SET sponsor_review_status='rejected' WHERE id=$1",
        [contributionId]
      );
      assert.equal((await upload('logo')).status, 'not_editable');
      assert.equal(
        await checkSponsorMediaUpload(
          pool,
          contributionId,
          'supporting_image',
          3
        ),
        'not_editable'
      );
      assert.equal(
        (
          await deleteSponsorMediaAsset(pool, {
            assetId: first.asset.id,
            contributionId,
            expectedVersion: first.asset.version,
            allowApproved: false
          })
        ).status,
        'not_editable'
      );
      assert.equal(
        (
          await pool.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
            [contributionId]
          )
        ).rows[0].sponsor_review_status,
        'rejected'
      );
      assert.equal(
        Number(
          (
            await pool.query(
              'SELECT COUNT(*) FROM sponsor_media_assets WHERE contribution_id=$1 AND deleted_at IS NULL',
              [contributionId]
            )
          ).rows[0].count
        ),
        4
      );
      const administrativeReplacement = await upload('logo', 'admin');
      assert.equal(administrativeReplacement.status, 'created');
      assert.equal(administrativeReplacement.asset.uploadedBy, 'admin');
      assert.equal(
        (
          await pool.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
            [contributionId]
          )
        ).rows[0].sponsor_review_status,
        'rejected',
        'an administrative upload does not reopen a refused dossier'
      );
      assert.equal(
        (await upload('supporting_image', 'admin')).status,
        'supporting_image_limit_reached',
        'the administrative exception keeps the media quota'
      );
      await pool.query(
        "UPDATE sponsor_media_assets SET review_status='approved', public_storage_key='synthetic/admin-logo.webp', public_url='https://example.test/admin-logo.webp' WHERE id=$1",
        [administrativeReplacement.asset.id]
      );
      assert.equal(
        (await upload('logo', 'admin')).status,
        'logo_locked',
        'the administrative exception keeps an approved logo locked'
      );
      assert.equal(
        (
          await deleteSponsorMediaAsset(pool, {
            assetId: first.asset.id,
            expectedVersion: first.asset.version,
            allowApproved: false
          })
        ).status,
        'updated',
        'administrative deletion without a sponsor dossier scope stays possible after refusal'
      );
      await pool.query(
        "UPDATE fund_contributions SET status='pending' WHERE id=$1",
        [contributionId]
      );
      assert.equal(
        (await upload('logo', 'admin')).status,
        'contribution_not_found',
        'an administrative upload still requires a recorded payment status'
      );
    } finally {
      await stop();
    }
  }
);
