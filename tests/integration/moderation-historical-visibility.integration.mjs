import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  moderationApprovedSql,
  moderationVisibleSql
} from '../../dist/apps/funding-api/src/moderation/policy.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/public-sponsorships.repository.js';

test(
  'adoption preserves only existing public facts and never grants a new approval',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    t.after(() => database.stop());
    const { pool } = database;
    const migrations = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    const files = (await readdir(migrations))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    for (const file of files.filter((name) => Number(name.slice(0, 3)) < 38))
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
    const createSponsor = async () => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_name,sponsor_company_name,public_display_consent,sponsor_review_status,sponsor_site_visibility_held) VALUES($1,'sponsorship_interest',100000,'cad','paid','Synthetic public name','Synthetic Workshop',TRUE,'approved',FALSE)`,
        [id]
      );
      const mediaId = randomUUID();
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height,public_url) VALUES($1,$2,'supporting_image','approved','synthetic.webp','image/webp',100,$3,100,$4,$5,20,20,$6)`,
        [
          mediaId,
          id,
          `private/${mediaId}-original`,
          `private/${mediaId}-processed`,
          'a'.repeat(64),
          `https://example.test/api/sponsorship-media/${mediaId}`
        ]
      );
      return { id, mediaId };
    };
    const legacy = await createSponsor();
    const withdrawal = await createSponsor();
    for (const file of files.filter((name) => Number(name.slice(0, 3)) >= 38))
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
    const visible = async (subjectType, id) =>
      (
        await pool.query(
          `SELECT ${moderationVisibleSql(subjectType, '$1::uuid')} AS visible`,
          [id]
        )
      ).rows[0].visible;
    const approved = async (subjectType, id) =>
      (
        await pool.query(
          `SELECT ${moderationApprovedSql(subjectType, '$1::uuid')} AS approved`,
          [id]
        )
      ).rows[0].approved;
    assert.equal(await visible('sponsorship', legacy.id), true);
    assert.equal(
      await visible('media', legacy.mediaId),
      false,
      'the recorded historical observation cannot supply current image-use rights'
    );
    assert.equal(await approved('sponsorship', legacy.id), false);
    assert.equal(await approved('media', legacy.mediaId), false);
    assert.equal(
      (
        await pool.query(
          'SELECT COUNT(*)::int AS count FROM moderation_decisions'
        )
      ).rows[0].count,
      0
    );
    const page = await listPublicSponsorships(pool, { page: 1, pageSize: 10 });
    assert.equal(page.pagination.total_count, 0);
    assert.equal(
      (
        await pool.query(
          'SELECT COUNT(*)::int AS count FROM sponsor_media_assets'
        )
      ).rows[0].count,
      2,
      'private historical files remain preserved'
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT DISTINCT usage_rights->>'state' AS state FROM sponsor_media_assets"
        )
      ).rows.map(({ state }) => state),
      ['needs_confirmation']
    );
    await pool.query(
      'UPDATE fund_contributions SET amount_cents=amount_cents+1,updated_at=NOW() WHERE id=$1',
      [legacy.id]
    );
    assert.equal(await visible('sponsorship', legacy.id), true);
    await pool.query(
      "UPDATE fund_contributions SET public_name='Changed name' WHERE id=$1",
      [legacy.id]
    );
    assert.equal(await visible('sponsorship', legacy.id), false);
    await pool.query(
      "UPDATE fund_contributions SET public_name='Synthetic public name' WHERE id=$1",
      [legacy.id]
    );
    assert.equal(
      await visible('sponsorship', legacy.id),
      false,
      'reverting text cannot restore the historical exception'
    );
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
      [withdrawal.id]
    );
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=TRUE WHERE id=$1',
      [withdrawal.id]
    );
    assert.equal(
      await visible('sponsorship', withdrawal.id),
      false,
      'restoring consent requires a new explicit authorization'
    );
    const newSponsor = await createSponsor();
    assert.equal(await visible('sponsorship', newSponsor.id), false);
    assert.equal(await approved('sponsorship', newSponsor.id), false);
    assert.equal(
      (await listPublicSponsorships(pool, { page: 1, pageSize: 10 })).pagination
        .total_count,
      0
    );
  }
);
