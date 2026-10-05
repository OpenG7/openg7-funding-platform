import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createSponsorMediaAsset } from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'failed upload audit rolls back the new media, previous logo deletion and dossier review in PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const contributionId = (
      await pool.query(`
    INSERT INTO fund_contributions
      (contribution_type, amount_cents, currency, status, sponsor_review_status)
    VALUES ('sponsorship_interest', 50000, 'cad', 'paid', 'approved')
    RETURNING id
  `)
    ).rows[0].id;
    const upload = () =>
      createSponsorMediaAsset(pool, {
        id: randomUUID(),
        contributionId,
        kind: 'logo',
        uploadedBy: 'sponsor',
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
    const audit = (
      await pool.query(
        `
    SELECT actor, action, entity_type, entity_id, metadata
    FROM admin_audit_log WHERE entity_id = $1
  `,
        [first.asset.id]
      )
    ).rows;
    assert.deepEqual(audit, [
      {
        actor: 'synthetic-media-uploader',
        action: 'sponsorship.media.upload',
        entity_type: 'sponsor_media_asset',
        entity_id: first.asset.id,
        metadata: {
          contributionId,
          kind: 'logo',
          mimeType: 'image/png',
          sizeBytes: 100,
          storageDriver: 'local'
        }
      }
    ]);
    await pool.query(
      "UPDATE fund_contributions SET sponsor_review_status = 'approved' WHERE id = $1",
      [contributionId]
    );
    const snapshot = async () => ({
      assets: (
        await pool.query(
          'SELECT * FROM sponsor_media_assets WHERE contribution_id = $1 ORDER BY id',
          [contributionId]
        )
      ).rows,
      contribution: (
        await pool.query('SELECT * FROM fund_contributions WHERE id = $1', [
          contributionId
        ])
      ).rows,
      audits: (await pool.query('SELECT * FROM admin_audit_log ORDER BY id'))
        .rows
    });
    const before = await snapshot();
    for (const body of [
      "RAISE EXCEPTION 'Synthetic upload audit failure';",
      'RETURN NULL;'
    ]) {
      await pool.query(`
      CREATE OR REPLACE FUNCTION synthetic_block_media_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'sponsorship.media.upload' THEN
          ${body}
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
      await pool.query(`
      CREATE TRIGGER synthetic_block_media_audit
      BEFORE INSERT ON admin_audit_log
      FOR EACH ROW EXECUTE FUNCTION synthetic_block_media_audit();
    `);
      await assert.rejects(
        upload(),
        (error) =>
          error.rollbackConfirmed === true && /audit/i.test(error.cause.message)
      );
      assert.deepEqual(await snapshot(), before);
      await pool.query(
        'DROP TRIGGER synthetic_block_media_audit ON admin_audit_log'
      );
    }
  }
);
