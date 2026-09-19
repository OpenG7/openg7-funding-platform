import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'Public sponsor directory on disposable PostgreSQL',
  { timeout: 90_000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() => pool.query('TRUNCATE fund_contributions CASCADE'));
    const seed = async (count = 1) => {
      const { rows } = await pool.query(
        `
      INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status,
        public_display_consent, display_amount_consent, sponsor_review_status, sponsor_company_name,
        sponsor_contact_email, email_private, sponsor_feed_notes, stripe_session_id,
        sponsor_feed_status, sponsor_feed_public_url, paid_at, updated_at)
      SELECT 'sponsorship_interest', 25000, 'cad', 'paid', true, false, 'approved', 'Same company',
        'private@example.invalid', 'payer@example.invalid', 'PRIVATE NOTE', 'cs_private_' || n,
        'not_planned', NULL, '2026-09-01', '2026-09-01'
      FROM generate_series(1, $1::integer) n RETURNING id`,
        [count]
      );
      await pool.query(`
      INSERT INTO sponsor_media_assets (contribution_id, kind, review_status, original_filename,
        original_mime_type, original_size_bytes, original_storage_key, processed_size_bytes,
        processed_storage_key, public_storage_key, public_url, checksum_sha256, width, height)
      SELECT id, 'supporting_image', 'approved', 'photo.png', 'image/png', 100,
        'private/' || id, 50, 'processed/' || id, 'public/' || id,
        '/api/public/sponsor-media/' || id, repeat('a', 64), 960, 640
      FROM fund_contributions`);
      return rows.map((row) => row.id);
    };

    await t.test(
      'all 57 dossiers are reachable with stable IDs and accurate totals, including homonyms',
      async () => {
        await seed(57);
        const defaultPage = await listPublicSponsorships(pool);
        assert.equal(defaultPage.sponsorships.length, 50);
        assert.equal(defaultPage.pagination.total_count, 57);
        const all = [];
        for (let page = 1; page <= 5; page++) {
          const result = await listPublicSponsorships(pool, {
            page,
            pageSize: 12
          });
          assert.equal(result.pagination.total_count, 57);
          assert.equal(result.sponsorships.length, page === 5 ? 9 : 12);
          all.push(...result.sponsorships.map((p) => p.public_id));
        }
        assert.equal(new Set(all).size, 57);
        assert.deepEqual(
          (
            await listPublicSponsorships(pool, { pageSize: 12 })
          ).sponsorships.map((p) => p.public_id),
          all.slice(0, 12)
        );
        const beyond = await listPublicSponsorships(pool, {
          page: 20,
          pageSize: 12
        });
        assert.equal(beyond.sponsorships.length, 0);
        assert.equal(beyond.pagination.total_count, 57);
      }
    );

    await t.test(
      'totals and cards apply consent, approval, payment, name and media rules identically',
      async () => {
        const ids = await seed(9);
        const changes = [
          'public_display_consent=false',
          "sponsor_review_status='pending_review'",
          "status='pending'",
          "sponsor_company_name=' '",
          "contribution_type='personal_support'"
        ];
        for (let i = 0; i < changes.length; i++)
          await pool.query(
            `UPDATE fund_contributions SET ${changes[i]} WHERE id=$1`,
            [ids[i]]
          );
        await pool.query(
          "UPDATE sponsor_media_assets SET review_status='pending_review', public_url=NULL, public_storage_key=NULL WHERE contribution_id=$1",
          [ids[5]]
        );
        await pool.query(
          'UPDATE sponsor_media_assets SET deleted_at=NOW() WHERE contribution_id=$1',
          [ids[6]]
        );
        await pool.query(
          'DELETE FROM sponsor_media_assets WHERE contribution_id=$1',
          [ids[7]]
        );
        const result = await listPublicSponsorships(pool);
        assert.equal(result.sponsorships.length, 1);
        assert.equal(result.pagination.total_count, 1);
        const publicJson = JSON.stringify(result);
        for (const secret of [
          'private@example.invalid',
          'payer@example.invalid',
          'PRIVATE NOTE',
          'cs_private_'
        ])
          assert.equal(publicJson.includes(secret), false);
        assert.notEqual(result.sponsorships[0].public_id, ids[8]);
        assert.equal(result.sponsorships[0].amount, null);
        await pool.query(
          'UPDATE fund_contributions SET display_amount_consent=true WHERE id=$1',
          [ids[8]]
        );
        assert.equal(
          (await listPublicSponsorships(pool)).sponsorships[0].amount,
          250
        );
      }
    );

    await t.test(
      'published counter counts profiles with links, and draft links are not exposed',
      async () => {
        const ids = await seed(4);
        await pool.query(
          "UPDATE fund_contributions SET sponsor_feed_status='published', sponsor_feed_public_url='https://example.com/shared' WHERE id=ANY($1::uuid[])",
          [ids.slice(0, 2)]
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_feed_status='published' WHERE id=$1",
          [ids[2]]
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_feed_status='drafted', sponsor_feed_public_url='https://example.com/private-draft' WHERE id=$1",
          [ids[3]]
        );
        const result = await listPublicSponsorships(pool, { pageSize: 1 });
        assert.equal(result.pagination.published_count, 2);
        const full = await listPublicSponsorships(pool);
        assert.equal(
          full.sponsorships.find((p) => p.feed_status === 'drafted')
            .feed_public_url,
          null
        );
        assert.equal(JSON.stringify(full).includes('private-draft'), false);
      }
    );

    await t.test(
      'refunds and disputes retain the existing separate editorial eligibility rule',
      async () => {
        const ids = await seed(2);
        await pool.query(
          "UPDATE fund_contributions SET status='refunded' WHERE id=$1",
          [ids[0]]
        );
        await pool.query(
          "UPDATE fund_contributions SET status='disputed' WHERE id=$1",
          [ids[1]]
        );
        assert.equal(
          (await listPublicSponsorships(pool)).pagination.total_count,
          2
        );
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=false WHERE id=$1',
          [ids[0]]
        );
        assert.equal(
          (await listPublicSponsorships(pool)).pagination.total_count,
          1
        );
      }
    );

    await t.test(
      'a real empty directory differs from an unavailable source; invalid pages are rejected',
      async () => {
        const empty = await listPublicSponsorships(pool);
        assert.equal(empty.data_source, 'database');
        assert.equal(empty.pagination.total_count, 0);
        const unavailable = await listPublicSponsorships(null);
        assert.equal(unavailable.data_source, 'empty');
        assert.equal(unavailable.pagination, undefined);
        await assert.rejects(
          () => listPublicSponsorships(pool, { page: 0 }),
          /Invalid/
        );
        await assert.rejects(
          () => listPublicSponsorships(pool, { pageSize: 51 }),
          /Invalid/
        );
      }
    );
  }
);
