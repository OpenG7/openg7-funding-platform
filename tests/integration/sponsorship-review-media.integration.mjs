import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listPublicSponsorships,
  updateSponsorshipReview
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'review and website visibility require an active approved presentation photo, including at the review write',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const seed = async (name, media) => {
      const {
        rows: [row]
      } = await pool.query(
        `INSERT INTO fund_contributions
          (contribution_type, amount_cents, currency, status, public_display_consent,
           sponsor_review_status, sponsor_company_name)
         VALUES ('sponsorship_interest', 25000, 'cad', 'paid', TRUE, 'pending_review', $1)
         RETURNING id, updated_at::text AS version`,
        [name]
      );
      if (media) {
        await pool.query(
          `INSERT INTO sponsor_media_assets
            (contribution_id, kind, review_status, original_filename, original_mime_type,
             original_size_bytes, original_storage_key, processed_size_bytes,
             processed_storage_key, public_storage_key, public_url, checksum_sha256,
             width, height, deleted_at)
           VALUES ($1, $2, $3, 'fixture.png', 'image/png', 100, 'original/' || $1::uuid::text,
             80, 'processed/' || $1::uuid::text,
             CASE WHEN $3 = 'approved' THEN 'public/' || $1::uuid::text END,
             CASE WHEN $3 = 'approved' THEN 'https://example.invalid/photo.webp' END,
             repeat('a', 64), 100, 100, CASE WHEN $4 THEN NOW() END)`,
          [row.id, media.kind, media.status, media.deleted ?? false]
        );
      }
      return row;
    };
    const approve = (database, row) =>
      updateSponsorshipReview(database, {
        contributionId: row.id,
        expectedVersion: row.version,
        reviewStatus: 'approved',
        reviewNote: null
      });
    const directoryHas = async (name) =>
      (await listPublicSponsorships(pool)).sponsorships.some(
        (sponsor) => sponsor.company_name === name
      );

    for (const [name, media, eligible] of [
      ['No photo', null, false],
      ['Approved logo only', { kind: 'logo', status: 'approved' }, false],
      [
        'Pending photo',
        { kind: 'supporting_image', status: 'pending_review' },
        false
      ],
      [
        'Rejected photo',
        { kind: 'supporting_image', status: 'rejected' },
        false
      ],
      [
        'Deleted photo',
        { kind: 'supporting_image', status: 'approved', deleted: true },
        false
      ],
      ['Approved photo', { kind: 'supporting_image', status: 'approved' }, true]
    ]) {
      await t.test(name, async () => {
        const row = await seed(name, media);
        const result = await approve(pool, row);
        assert.equal(result.status, eligible ? 'updated' : 'media_required');
        assert.equal(result.updated, eligible);
        assert.equal(
          await directoryHas(name),
          false,
          'review never releases website visibility'
        );
        if (eligible) {
          assert.equal(
            await setSponsorshipWebsiteVisibility(
              pool,
              {
                contributionId: row.id,
                expectedVersion: result.currentVersion,
                visible: true,
                confirmed: true
              },
              'fixture-admin'
            ),
            'updated'
          );
        } else {
          // A legacy approved dossier still loses eligibility when its photo is absent or revoked.
          await pool.query(
            "UPDATE fund_contributions SET sponsor_review_status = 'approved', sponsor_site_visibility_held = FALSE WHERE id = $1",
            [row.id]
          );
        }
        assert.equal(await directoryHas(name), eligible);
      });
    }

    for (const revocation of ['deleted', 'rejected']) {
      await t.test(
        `photo ${revocation} after the read still prevents approval`,
        async () => {
          const row = await seed(`Revoked ${revocation}`, {
            kind: 'supporting_image',
            status: 'approved'
          });
          const read = async () =>
            (
              await pool.query(
                'SELECT * FROM fund_contributions WHERE id = $1',
                [row.id]
              )
            ).rows[0];
          const before = await read();
          let queries = 0;
          const database = {
            async query(...args) {
              const result = await pool.query(...args);
              if (++queries === 1) {
                // Commit the independent media change between the target read and guarded UPDATE.
                await pool.query(
                  revocation === 'deleted'
                    ? 'UPDATE sponsor_media_assets SET deleted_at = NOW() WHERE contribution_id = $1'
                    : "UPDATE sponsor_media_assets SET review_status = 'rejected', public_storage_key = NULL, public_url = NULL WHERE contribution_id = $1",
                  [row.id]
                );
              }
              return result;
            }
          };
          const result = await approve(database, row);
          assert.equal(queries, 2);
          assert.equal(result.status, 'conflict');
          assert.equal(result.updated, false);
          assert.deepEqual(await read(), before);
          assert.equal(await directoryHas(`Revoked ${revocation}`), false);
        }
      );
    }
  }
);
