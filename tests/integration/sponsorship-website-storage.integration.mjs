import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { listSponsorshipFulfilmentEvidence } from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor
} from './support/moderation-fixture.mjs';

test(
  'website fulfilment requires physically verified current owned WebP sources before any visibility transition',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    let openTransactions = 0;
    const db = {
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect();
        return {
          async query(sql, ...parameters) {
            const result = await client.query(sql, ...parameters);
            if (sql.startsWith('BEGIN')) openTransactions++;
            if (sql === 'COMMIT' || sql === 'ROLLBACK') openTransactions--;
            return result;
          },
          release: () => client.release()
        };
      }
    };
    const seed = async () => {
      const session = 'cs_website_storage_' + randomUUID();
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions
      (contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,
      sponsor_company_name,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',5000,'cad','paid',NOW(),$1,'Synthetic verified website source',
      'Complete owned public presentation',TRUE,'approved',TRUE) RETURNING id`,
          [session]
        )
      ).rows[0].id;
      await withPostgresTransaction(pool, async (client) => {
        await activateSponsorshipCommitments(client, {
          stripeSessionId: session
        });
        await qualifySponsorshipCommitment(
          client,
          {
            requestId: randomUUID(),
            contributionId: id,
            expectedVersion: 1,
            confirmation: id,
            reason: 'Synthetic recorded agreement for physical website proof',
            evidenceReference: 'synthetic://website-storage-agreement',
            offer: {
              ...createSponsorshipOfferSnapshot(5000, 'CAD'),
              version: 'historical-qualification-v1'
            }
          },
          fixtureModerationActor
        );
      });
      const storageKey = 'synthetic-private/' + id;
      const asset = (
        await pool.query(
          `INSERT INTO sponsor_media_assets
      (contribution_id,kind,review_status,original_filename,original_mime_type,
      original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,
      public_url,checksum_sha256,width,height,alt_text,usage_rights)
      VALUES($1,'supporting_image','approved','synthetic.png','image/png',100,
      'synthetic-original/'||$1::uuid::text,$2,$3,'/api/public/sponsor-media/'||gen_random_uuid(),
      $4,40,30,'Current owned photo',$5::jsonb) RETURNING id`,
          [
            id,
            bytes.length,
            storageKey,
            checksum,
            JSON.stringify({
              state: 'confirmed',
              channels: ['website'],
              targets: ['openg7'],
              transformations: ['technical'],
              credit: 'Photo : Atelier synthétique',
              restrictions: null
            })
          ]
        )
      ).rows[0].id;
      await approveFixtureSubject(pool, { type: 'media', id: asset });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      const version = (
        await pool.query(
          'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].version;
      return {
        id,
        asset,
        storageKey,
        command: {
          contributionId: id,
          expectedVersion: version,
          visible: true,
          confirmed: true
        }
      };
    };
    const assertNoPublication = async (item) => {
      const state = (
        await pool.query(
          'SELECT sponsor_site_visibility_held AS held FROM fund_contributions WHERE id=$1',
          [item.id]
        )
      ).rows[0];
      assert.equal(state.held, true);
      assert.deepEqual(
        await listSponsorshipFulfilmentEvidence(pool, item.id),
        []
      );
      assert.equal(
        (await loadSponsorshipCommitment(pool, item.id)).obligations[0].state,
        'pending'
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship_website.visibility'",
            [item.id]
          )
        ).rows[0].count,
        0
      );
      assert.equal(openTransactions, 0);
    };
    for (const scenario of [
      { label: 'storage port absent', code: 'MEDIA_STORAGE_UNAVAILABLE' },
      {
        label: 'owned physical object missing',
        content: null,
        code: 'MEDIA_UNAVAILABLE'
      },
      {
        label: 'owned physical object corrupted',
        content: Buffer.from('corrupted processed WebP'),
        code: 'MEDIA_CHANGED'
      }
    ])
      await t.test(scenario.label, async () => {
        const item = await seed();
        const storage =
          scenario.label === 'storage port absent'
            ? undefined
            : {
                readPrivateObject: async (key) => {
                  assert.equal(
                    openTransactions,
                    0,
                    'storage I/O must happen before BEGIN'
                  );
                  assert.equal(key, item.storageKey);
                  return scenario.content;
                }
              };
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            db,
            item.command,
            fixtureModerationActor,
            storage
          ),
          { code: scenario.code }
        );
        await assertNoPublication(item);
      });
    await t.test(
      'a source revision changed during the physical read cannot use the old attestation',
      async () => {
        const item = await seed();
        const storage = {
          readPrivateObject: async (key) => {
            assert.equal(openTransactions, 0);
            assert.equal(key, item.storageKey);
            await pool.query(
              "UPDATE sponsor_media_assets SET alt_text='New exact public caption',updated_at=clock_timestamp() WHERE id=$1",
              [item.asset]
            );
            await approveFixtureSubject(pool, {
              type: 'media',
              id: item.asset
            });
            return bytes;
          }
        };
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            db,
            item.command,
            fixtureModerationActor,
            storage
          ),
          { code: 'MEDIA_CHANGED' }
        );
        await assertNoPublication(item);
      }
    );
    await t.test(
      'valid bytes produce one qualified public snapshot; replay and hiding require no storage and preserve it',
      async () => {
        const item = await seed();
        let reads = 0;
        const storage = {
          readPrivateObject: async (key) => {
            assert.equal(openTransactions, 0);
            assert.equal(key, item.storageKey);
            reads++;
            return bytes;
          }
        };
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            db,
            item.command,
            fixtureModerationActor,
            storage
          ),
          'updated'
        );
        const evidence = await listSponsorshipFulfilmentEvidence(pool, item.id);
        assert.equal(evidence.length, 1);
        assert.equal(evidence[0].provenance, 'website_verified');
        assert.equal(evidence[0].visibility, 'unknown');
        assert.equal(evidence[0].externalPostUrl, null);
        const stored = (
          await pool.query(
            'SELECT media_snapshot FROM sponsorship_fulfilment_evidence WHERE id=$1',
            [evidence[0].id]
          )
        ).rows[0].media_snapshot;
        assert.equal(stored[0].id, item.asset);
        assert.equal(stored[0].sourceHash, checksum);
        assert.equal(stored[0].usage.credit, 'Photo : Atelier synthétique');
        assert.doesNotMatch(
          JSON.stringify(stored),
          /storageKey|synthetic-private|originalStorage/
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            db,
            item.command,
            fixtureModerationActor
          ),
          'unchanged'
        );
        assert.equal(reads, 1);
        assert.deepEqual(
          await listSponsorshipFulfilmentEvidence(pool, item.id),
          evidence
        );
        const version = (
          await pool.query(
            'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
            [item.id]
          )
        ).rows[0].version;
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            db,
            { ...item.command, expectedVersion: version, visible: false },
            fixtureModerationActor
          ),
          'updated'
        );
        assert.deepEqual(
          await listSponsorshipFulfilmentEvidence(pool, item.id),
          evidence
        );
        assert.equal(reads, 1);
        assert.equal(openTransactions, 0);
      }
    );
  }
);
