import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import sharp from 'sharp';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  qualifySponsorshipCommitment,
  adjustSponsorshipObligation
} from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import {
  capturePublicationObligations,
  assertPublicationObligations,
  recordSocialFulfilment,
  listSponsorshipFulfilmentEvidence
} from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import {
  getSponsorshipCharterReviewPreview,
  getPublicSponsorshipCharter
} from '../../dist/apps/funding-api/src/moderation/charter.js';

test(
  'qualified evidence fulfils exact passages without inventing historical or simulated success',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const role = 'og7_fulfilment_runtime';
    const password = randomBytes(32).toString('hex');
    const name = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    await database.pool.query(
      buildRuntimeRoleSql({ role, database: name, password }, { create: true })
    );
    const pool = new pg.Pool({
      ...database.pool.options,
      user: role,
      password
    });
    t.after(async () => {
      await pool.end();
      await database.stop();
    });
    await assertProductionDatabasePrivileges(pool, true);
    await assert.rejects(
      pool.query('DELETE FROM sponsorship_obligation_reservations'),
      { code: '42501' }
    );
    const actor = 'admin:00000000-0000-4000-8000-000000000004';
    const websiteImage = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const websiteHash = createHash('sha256').update(websiteImage).digest('hex');
    const websiteStorage = {
      readPrivateObject: async (key) => {
        assert.equal(key, 'private-processed');
        return websiteImage;
      }
    };
    const session = `cs_fulfilment_${randomUUID()}`;
    const contributionId = (
      await pool.query(
        `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    stripe_session_id,sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',50000,'cad','paid',NOW(),$1,'Synthetic evidence company','Complete public presentation',TRUE,'approved',TRUE) RETURNING id`,
        [session]
      )
    ).rows[0].id;
    await withPostgresTransaction(pool, async (db) => {
      await activateSponsorshipCommitments(db, { stripeSessionId: session });
      const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
      await qualifySponsorshipCommitment(
        db,
        {
          requestId: randomUUID(),
          contributionId,
          expectedVersion: 1,
          confirmation: contributionId,
          reason: 'Synthetic commercial agreement for exact passage tests',
          evidenceReference: 'synthetic://fulfilment-agreement',
          offer: {
            ...offer,
            version: 'historical-qualification-v1',
            benefits: offer.benefits.map((b) =>
              b.channel === 'facebook' ? { ...b, quantity: 2 } : b
            )
          }
        },
        actor
      );
    });
    const mediaId = (
      await pool.query(
        `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,
    original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,
    public_url,checksum_sha256,width,height) VALUES($1,'supporting_image','approved','synthetic.png','image/png',100,'private-original',
    $3,'private-processed','public-synthetic','https://example.invalid/synthetic.webp',$2,100,100) RETURNING id`,
        [contributionId, websiteHash, websiteImage.length]
      )
    ).rows[0].id;
    await pool.query(
      'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb WHERE id=$1',
      [
        mediaId,
        JSON.stringify({
          state: 'confirmed',
          channels: ['website', 'facebook', 'linkedin'],
          targets: ['openg7', 'openg20'],
          transformations: ['technical'],
          credit: null,
          restrictions: null
        })
      ]
    );
    await approveFixtureSubject(pool, { type: 'media', id: mediaId });
    await approveFixtureSubject(pool, {
      type: 'sponsorship',
      id: contributionId
    });
    const createDelivery = async (mode = 'live') => {
      const batchId = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',2,'open') RETURNING id"
        )
      ).rows[0].id;
      const draftId = (
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,batch_id)
      VALUES($1,'openg7','facebook','Complete title','Complete sponsor text','Commandite rémunérée.',$2)
      ON CONFLICT(contribution_id,feed_target,channel) WHERE obligation_id IS NULL DO UPDATE SET batch_id=$2 RETURNING id`,
          [contributionId, batchId]
        )
      ).rows[0].id;
      const sources = [
        {
          id: draftId,
          contribution_id: contributionId,
          title: 'Complete title',
          body: 'Complete sponsor text',
          disclosure_text: 'Commandite rémunérée.',
          feed_target: 'openg7',
          channel: 'facebook'
        }
      ];
      return (
        await pool.query(
          `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,source_snapshot,account_id,mode)
      VALUES('openg7:facebook','sponsorship',$1,'Synthetic complete recognition',NOW(),$2::jsonb,'synthetic-page',$3) RETURNING *`,
          [batchId, JSON.stringify(sources), mode]
        )
      ).rows[0];
    };
    const reserve = async (row) => {
      row.obligation_snapshot = await withPostgresTransaction(pool, (db) =>
        capturePublicationObligations(db, row)
      );
      await pool.query(
        'UPDATE publication_deliveries SET obligation_snapshot=$2::jsonb WHERE id=$1',
        [row.id, JSON.stringify(row.obligation_snapshot)]
      );
    };

    await t.test(
      'simulation never closes an obligation or records a provider proof',
      async () => {
        const row = await createDelivery('mock');
        await reserve(row);
        await withPostgresTransaction(pool, (db) =>
          recordSocialFulfilment(
            db,
            row,
            `mock-${row.id}`,
            null,
            actor,
            'provider_acknowledged'
          )
        );
        assert.equal(
          (await listSponsorshipFulfilmentEvidence(pool, contributionId))
            .length,
          0
        );
        assert.equal(
          (
            await loadSponsorshipCommitment(pool, contributionId)
          ).obligations.filter((o) => o.state === 'fulfilled').length,
          0
        );
      }
    );
    await t.test(
      'two approvals reserve different passages and the same remote post cannot fulfil both',
      async () => {
        const first = await createDelivery();
        await reserve(first);
        const second = await createDelivery();
        await reserve(second);
        assert.notEqual(
          first.obligation_snapshot[0].id,
          second.obligation_snapshot[0].id
        );
        await withPostgresTransaction(pool, (db) =>
          recordSocialFulfilment(
            db,
            first,
            '123_456',
            'https://www.facebook.com/123_456',
            actor,
            'provider_acknowledged'
          )
        );
        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            recordSocialFulfilment(
              db,
              second,
              '123_456',
              null,
              actor,
              'provider_verified'
            )
          ),
          /duplicate key/
        );
        assert.equal(
          (await listSponsorshipFulfilmentEvidence(pool, contributionId))
            .length,
          1
        );
        await withPostgresTransaction(pool, (db) =>
          recordSocialFulfilment(
            db,
            second,
            '123_789',
            'https://www.facebook.com/123_789',
            actor,
            'provider_verified'
          )
        );
        const commitment = await loadSponsorshipCommitment(
          pool,
          contributionId
        );
        assert.equal(
          commitment.obligations.filter(
            (o) => o.channel === 'facebook' && o.state === 'fulfilled'
          ).length,
          2
        );
        const evidence = await listSponsorshipFulfilmentEvidence(
          pool,
          contributionId
        );
        assert.equal(evidence.length, 2);
        assert.equal(
          JSON.stringify(evidence).includes('private-processed'),
          false
        );
        await assert.rejects(
          pool.query(
            'UPDATE sponsorship_fulfilment_evidence SET message=$1 WHERE id=$2',
            ['forged', evidence[0].id]
          ),
          /immutable/
        );
      }
    );
    await t.test(
      'a destination adjustment revokes authority without granting a new approval',
      async () => {
        const obligation = (
          await loadSponsorshipCommitment(pool, contributionId)
        ).obligations.find((o) => o.channel === 'linkedin');
        await withPostgresTransaction(pool, (db) =>
          adjustSponsorshipObligation(
            db,
            {
              requestId: randomUUID(),
              obligationId: obligation.id,
              expectedVersion: obligation.version,
              confirmation: obligation.id,
              reason: 'Synthetic documented destination correction',
              kind: 'destination',
              target: 'openg20'
            },
            actor
          )
        );
        const changed = (
          await loadSponsorshipCommitment(pool, contributionId)
        ).obligations.find((o) => o.id === obligation.id);
        assert.equal(changed.target, 'openg20');
        assert.equal(changed.state, 'pending');
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [obligation.id]
            )
          ).rows[0].count,
          0
        );
      }
    );
    await t.test(
      'an explicit website publication creates one qualified proof and its replay does not create another',
      async () => {
        const version = (
          await pool.query(
            'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
            [contributionId]
          )
        ).rows[0].version;
        const command = {
          contributionId,
          expectedVersion: version,
          visible: true,
          confirmed: true
        };
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            command,
            actor,
            websiteStorage
          ),
          'updated'
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            command,
            actor,
            websiteStorage
          ),
          'unchanged'
        );
        const evidence = await listSponsorshipFulfilmentEvidence(
          pool,
          contributionId
        );
        assert.equal(evidence.filter((e) => e.channel === 'website').length, 1);
        assert.equal(
          evidence.find((e) => e.channel === 'website').provenance,
          'website_verified'
        );
      }
    );
    await t.test(
      'consent withdrawal blocks any further passage and preserves delivered evidence',
      async () => {
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [contributionId]
        );
        const row = await createDelivery();
        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            assertPublicationObligations(db, row)
          ),
          /SPONSORSHIP_OBLIGATION_UNAVAILABLE/
        );
        assert.equal(
          (await listSponsorshipFulfilmentEvidence(pool, contributionId))
            .length,
          3
        );
      }
    );
    await t.test(
      'editorial previews preserve the inactive public charter and every financial fact',
      async () => {
        const before = (
          await pool.query('SELECT * FROM moderation_policies ORDER BY version')
        ).rows;
        const preview = await withPostgresTransaction(
          pool,
          (db) => getSponsorshipCharterReviewPreview(db),
          { readOnlySnapshot: true }
        );
        assert.equal(preview.active, false);
        assert.equal(preview.recognitionTerms.status, 'proposed');
        const publicCharter = await getPublicSponsorshipCharter(pool);
        assert.equal(publicCharter.text, null);
        assert.equal(publicCharter.fingerprint, null);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM moderation_policies ORDER BY version'
            )
          ).rows,
          before
        );
        assert.equal(
          (await listSponsorshipFulfilmentEvidence(pool, contributionId))
            .length,
          3
        );
      }
    );
  }
);
