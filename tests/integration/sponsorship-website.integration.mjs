import assert from 'node:assert/strict';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import {
  listPublicSponsorships,
  updateSponsorshipPublication,
  updateSponsorshipReview
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';

test(
  'website decisions and real public visibility agree for every tier, preserve social state, and audit atomically',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      const personal = (
        await pool.query(
          "INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status) VALUES ('personal_support', 5000, 'cad', 'paid') RETURNING *"
        )
      ).rows[0];
      for (const contributionId of [
        '10000000-0000-4000-8000-000000000999',
        personal.id
      ]) {
        for (const visible of [true, false]) {
          assert.equal(
            await setSponsorshipWebsiteVisibility(
              pool,
              {
                contributionId,
                expectedVersion: 'synthetic-version',
                visible,
                confirmed: true
              },
              'fixture-admin'
            ),
            'not_found'
          );
        }
      }
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
          .rows[0].count,
        0
      );
      assert.deepEqual(
        (
          await pool.query('SELECT * FROM fund_contributions WHERE id = $1', [
            personal.id
          ])
        ).rows[0],
        personal
      );
      for (const amount of [5000, 10000, 24999, 25000, 33333, 50000]) {
        const {
          rows: [{ id }]
        } = await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,public_display_consent,sponsor_company_name,sponsor_review_status,sponsor_feed_status)
        VALUES('sponsorship_interest',$1,'cad','paid',TRUE,'Synthetic website sponsor','pending_review','planned') RETURNING id`,
          [amount]
        );
        if (amount === 10000) {
          await pool.query(
            'UPDATE fund_contributions SET sponsor_review_status=NULL WHERE id=$1',
            [id]
          );
        }
        await pool.query(
          `INSERT INTO sponsor_media_assets (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height)
        VALUES($1,'supporting_image','approved','fixture.png','image/png',100,'private-original-' || $1::uuid::text,100,'private-processed-' || $1::uuid::text,'public-fixture-' || $1::uuid::text,'https://example.invalid/fixture.webp',repeat('a',64),100,100)`,
          [id]
        );
        const version = async () =>
          (
            await pool.query(
              'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
              [id]
            )
          ).rows[0].version;
        const load = async () =>
          (await getSponsorshipProgress(pool, id)).dossier;
        assert.equal(
          (await load()).website.visible,
          false,
          'a missing or pending review never implies visibility'
        );
        const directoryHas = async () =>
          (await listPublicSponsorships(pool)).sponsorships.some(
            (s) =>
              s.public_id === id ||
              s.company_name === 'Synthetic website sponsor'
          );
        const review = await updateSponsorshipReview(pool, {
          contributionId: id,
          expectedVersion: await version(),
          reviewStatus: 'approved',
          reviewNote: null
        });
        assert.equal(review.updated, true);
        assert.equal(
          (await load()).website.visible,
          false,
          'review alone does not publish'
        );
        assert.equal((await load()).website.canPublish, true);
        const saved = await updateSponsorshipPublication(pool, {
          contributionId: id,
          expectedVersion: await version(),
          publicSlug: 'fixture-' + id,
          publicSummary: 'Synthetic public profile',
          feedTarget: 'openg7',
          feedChannels: [],
          feedStatus: 'planned'
        });
        assert.equal(saved.updated, true);
        assert.equal(
          (await load()).website.visible,
          false,
          'metadata does not release the visibility hold'
        );
        assert.equal(await directoryHas(), false);
        const input = {
          contributionId: id,
          expectedVersion: await version(),
          visible: true,
          confirmed: true
        };
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            { ...input, expectedVersion: 'stale' },
            'fixture-admin'
          ),
          'conflict'
        );
        assert.deepEqual(
          (
            await Promise.all([
              setSponsorshipWebsiteVisibility(pool, input, 'fixture-admin'),
              setSponsorshipWebsiteVisibility(pool, input, 'fixture-admin')
            ])
          ).sort(),
          ['unchanged', 'updated'],
          'concurrent submissions perform one visibility change'
        );
        const visible = await load();
        assert.equal(visible.website.visible, true);
        assert.equal(await directoryHas(), true);
        assert.equal(visible.feedStatus, 'planned');
        assert.equal(visible.publications.length, 0);
        assert.equal(
          visible.milestones.find((s) => s.id === 'publication').state,
          amount < 25000 ? 'complete' : 'partial'
        );
        const count = async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship_website.visibility'",
                [id]
              )
            ).rows[0].count
          );
        const audited = await count();
        assert.equal(
          await setSponsorshipWebsiteVisibility(pool, input, 'fixture-admin'),
          'unchanged',
          'repeated publish has no new effect'
        );
        assert.equal(await count(), audited);
        const hide = {
          ...input,
          expectedVersion: await version(),
          visible: false
        };
        assert.equal(
          await setSponsorshipWebsiteVisibility(pool, hide, 'fixture-admin'),
          'updated'
        );
        assert.equal((await load()).website.visible, false);
        assert.equal(await directoryHas(), false);
        assert.notEqual(
          (await load()).milestones.find((s) => s.id === 'publication').state,
          'complete'
        );
        for (const [change, restore] of [
          ['public_display_consent=FALSE', 'public_display_consent=TRUE'],
          [
            "sponsor_review_status='rejected'",
            "sponsor_review_status='approved'"
          ],
          ["status='disputed'", "status='paid'"],
          [
            "sponsorship_refund_status='processing'",
            "sponsorship_refund_status='not_requested'"
          ],
          [
            "sponsor_company_name=''",
            "sponsor_company_name='Synthetic website sponsor'"
          ]
        ]) {
          await pool.query(
            `UPDATE fund_contributions SET ${change} WHERE id=$1`,
            [id]
          );
          assert.equal((await load()).website.canPublish, false, change);
          assert.equal(
            await setSponsorshipWebsiteVisibility(
              pool,
              { ...input, expectedVersion: await version() },
              'fixture-admin'
            ),
            'blocked',
            change
          );
          assert.equal(await directoryHas(), false);
          await pool.query(
            `UPDATE fund_contributions SET ${restore} WHERE id=$1`,
            [id]
          );
        }
        await pool.query(
          "UPDATE sponsor_media_assets SET review_status='pending_review', public_storage_key=NULL, public_url=NULL WHERE contribution_id=$1",
          [id]
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            { ...input, expectedVersion: await version() },
            'fixture-admin'
          ),
          'blocked'
        );
        await pool.query(
          "UPDATE sponsor_media_assets SET review_status='approved', public_storage_key='public-fixture-' || $1::uuid::text, public_url='https://example.invalid/fixture.webp' WHERE contribution_id=$1",
          [id]
        );
        // Simulate persistence failure: the visibility change must roll back with its audit.
        await pool.query(
          "ALTER TABLE admin_audit_log ADD CONSTRAINT fixture_reject_website_audit CHECK (action <> 'sponsorship_website.visibility') NOT VALID"
        );
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            pool,
            { ...input, expectedVersion: await version() },
            'fixture-admin'
          )
        );
        assert.equal((await load()).website.visible, false);
        await pool.query(
          'ALTER TABLE admin_audit_log DROP CONSTRAINT fixture_reject_website_audit'
        );
      }
    } finally {
      await stop();
    }
  }
);
