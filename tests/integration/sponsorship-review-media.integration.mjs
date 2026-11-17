import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import {
  listPublicSponsorships,
  updateSponsorshipReview
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import {
  createSponsorMediaAsset,
  getApprovedPublicSponsorMedia
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor
} from './support/moderation-fixture.mjs';

test(
  'text approval is independent of media while website publication and later images stay explicitly authorized',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
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
        const inserted = await pool.query(
          `INSERT INTO sponsor_media_assets
            (contribution_id, kind, review_status, original_filename, original_mime_type,
             original_size_bytes, original_storage_key, processed_size_bytes,
             processed_storage_key, public_storage_key, public_url, checksum_sha256,
             width, height, deleted_at, usage_rights)
           VALUES ($1, $2, $3, 'fixture.webp', 'image/webp', $5, 'original/' || $1::uuid::text,
             $5, 'processed/' || $1::uuid::text,
             CASE WHEN $3 = 'approved' THEN 'public/' || $1::uuid::text END,
             CASE WHEN $3 = 'approved' THEN 'https://example.invalid/photo.webp' END,
             $6, 100, 100, CASE WHEN $4 THEN NOW() END,
             '{"state":"confirmed","channels":["website"],"targets":["openg7"],"transformations":["technical"],"credit":null,"restrictions":null}') RETURNING id`,
          [
            row.id,
            media.kind,
            media.status,
            media.deleted ?? false,
            bytes.length,
            checksum
          ]
        );
        if (media.status === 'approved' && !media.deleted)
          await approveFixtureSubject(pool, {
            type: 'media',
            id: inserted.rows[0].id
          });
      }
      await approveFixtureSubject(pool, { type: 'sponsorship', id: row.id });
      return row;
    };
    const approve = (database, row) =>
      updateSponsorshipReview(database, {
        contributionId: row.id,
        confirmation: row.id,
        actor: fixtureModerationActor,
        expectedVersion: row.version,
        reviewStatus: 'approved',
        reviewNote: null
      });
    const directoryHas = async (name) =>
      (await listPublicSponsorships(pool)).sponsorships.some(
        (sponsor) => sponsor.company_name === name
      );

    for (const [name, media] of [
      ['No photo', null],
      ['Approved logo only', { kind: 'logo', status: 'approved' }],
      ['Pending photo', { kind: 'supporting_image', status: 'pending_review' }],
      ['Rejected photo', { kind: 'supporting_image', status: 'rejected' }],
      [
        'Deleted photo',
        { kind: 'supporting_image', status: 'approved', deleted: true }
      ],
      ['Approved photo', { kind: 'supporting_image', status: 'approved' }]
    ]) {
      await t.test(name, async () => {
        const row = await seed(name, media);
        const result = await approve(pool, row);
        assert.equal(result.status, 'updated');
        assert.equal(result.updated, true);
        assert.equal(
          await directoryHas(name),
          false,
          'review never releases website visibility'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_site_visibility_held FROM fund_contributions WHERE id = $1',
              [row.id]
            )
          ).rows[0].sponsor_site_visibility_held,
          true
        );
      });
    }

    for (const revocation of ['deleted', 'rejected']) {
      await t.test(
        `photo ${revocation} after a prior dossier read does not prevent unchanged text approval`,
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
          await pool.query(
            revocation === 'deleted'
              ? 'UPDATE sponsor_media_assets SET deleted_at = NOW() WHERE contribution_id = $1'
              : "UPDATE sponsor_media_assets SET review_status = 'rejected', public_storage_key = NULL, public_url = NULL WHERE contribution_id = $1",
            [row.id]
          );
          const result = await approve(pool, row);
          assert.equal(result.status, 'updated');
          assert.equal(result.updated, true);
          assert.equal((await read()).sponsor_review_status, 'approved');
          assert.equal(
            (await read()).sponsor_company_name,
            before.sponsor_company_name
          );
          assert.equal(await directoryHas(`Revoked ${revocation}`), false);
        }
      );
    }

    await t.test(
      'later private media preserves visible text, exact source version and existing editorial approval',
      async () => {
        const name = 'Visible text before images';
        const row = await seed(name, null);
        const approved = await approve(pool, row);
        assert.equal(approved.status, 'updated');
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            {
              contributionId: row.id,
              expectedVersion: approved.currentVersion,
              visible: true,
              confirmed: true
            },
            'fixture-admin'
          ),
          'updated'
        );
        const snapshot = async () => ({
          contribution: (
            await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
              row.id
            ])
          ).rows[0],
          moderation: (
            await pool.query(
              "SELECT * FROM moderation_cases WHERE subject_type='sponsorship' AND subject_id=$1",
              [row.id]
            )
          ).rows[0],
          directory: (await listPublicSponsorships(pool)).sponsorships.find(
            (sponsor) => sponsor.company_name === name
          )
        });
        const before = await snapshot();
        assert.ok(before.directory);
        for (const kind of ['supporting_image', 'logo']) {
          const media = await createSponsorMediaAsset(pool, {
            id: randomUUID(),
            contributionId: row.id,
            kind,
            uploadedBy: 'sponsor',
            auditActor: 'synthetic-uploader',
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
          assert.equal(media.status, 'created');
          assert.equal(media.asset.reviewStatus, 'pending_review');
          assert.equal(media.asset.publicUrl, null);
          assert.equal(
            await getApprovedPublicSponsorMedia(pool, media.asset.id),
            null
          );
          const stored = (
            await pool.query(
              'SELECT website_selected,public_storage_key FROM sponsor_media_assets WHERE id=$1',
              [media.asset.id]
            )
          ).rows[0];
          assert.deepEqual(stored, {
            website_selected: false,
            public_storage_key: null
          });
          assert.deepEqual(await snapshot(), before);
        }
      }
    );

    for (const field of ['sponsor_company_name', 'sponsor_logo_url']) {
      await t.test(
        `changing ${field} still invalidates the exact dossier authorization`,
        async () => {
          const row = await seed(`Reviewed ${field}`, null);
          const approved = await approve(pool, row);
          assert.equal(approved.status, 'updated');
          const changed = (
            await pool.query(
              `UPDATE fund_contributions SET ${field}=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,updated_at::text AS version`,
              [
                row.id,
                field === 'sponsor_logo_url'
                  ? 'https://example.invalid/replacement.webp'
                  : 'Changed company'
              ]
            )
          ).rows[0];
          assert.equal((await approve(pool, row)).status, 'conflict');
          await assert.rejects(approve(pool, changed), {
            code: 'MODERATION_RESTRICTED'
          });
          assert.equal(await directoryHas(`Reviewed ${field}`), false);
        }
      );
    }
  }
);
