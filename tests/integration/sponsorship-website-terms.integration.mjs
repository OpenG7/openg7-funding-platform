import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import {
  createSponsorshipOfferSnapshot,
  publicSponsorshipObligations
} from '../../dist/packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  activateSponsorshipCommitments,
  createSponsorshipObligations,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  qualifySponsorshipCommitment,
  adjustSponsorshipObligation
} from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { sponsorshipOfferFingerprint } from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { listSponsorshipFulfilmentEvidence } from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor as actor
} from './support/moderation-fixture.mjs';

test(
  'website visibility and commercial fulfilment respect recorded durations and partial refunds independently',
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
    const storage = { readPrivateObject: async () => bytes };
    const offer = (durationDays = null) => ({
      ...createSponsorshipOfferSnapshot(5000, 'CAD'),
      version: 'historical-qualification-v1',
      benefits: createSponsorshipOfferSnapshot(5000, 'CAD').benefits.map(
        (b) => ({ ...b, durationDays })
      )
    });
    const seed = async ({
      commitment = 'none',
      durationDays = null,
      refundStatus = 'not_requested',
      refundAmount = null
    } = {}) => {
      const session = 'cs_website_terms_' + randomUUID();
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,
      sponsor_company_name,sponsor_public_summary,email_private,public_display_consent,sponsor_review_status,sponsor_site_visibility_held,
      sponsorship_refund_status,sponsorship_refund_amount_cents)
      VALUES('sponsorship_interest',5000,'cad','paid',NOW(),$1,'Synthetic website terms sponsor','Complete public presentation','synthetic@example.invalid',
      TRUE,'approved',TRUE,$2,$3) RETURNING id`,
          [session, refundStatus, refundAmount]
        )
      ).rows[0].id;
      if (commitment === 'legacy_duration') {
        // Seed immutable pre-fix history rather than rewriting an accepted offer.
        await withPostgresTransaction(pool, async (db) => {
          const snapshot = offer(durationDays);
          const offerId = (
            await db.query(
              `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
          VALUES($1,$2,$3,5000,'CAD',$4::jsonb,'historical_qualification') RETURNING id`,
              [
                id,
                snapshot.version,
                sponsorshipOfferFingerprint(snapshot),
                JSON.stringify(snapshot)
              ]
            )
          ).rows[0].id;
          const commitmentId = (
            await db.query(
              `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
          VALUES($1,$2,'qualified_historical','active',NOW()) RETURNING id`,
              [id, offerId]
            )
          ).rows[0].id;
          await createSponsorshipObligations(db, commitmentId, id, snapshot);
        });
      } else if (commitment !== 'none') {
        await withPostgresTransaction(pool, async (db) => {
          await activateSponsorshipCommitments(db, {
            stripeSessionId: session
          });
          if (commitment === 'active')
            await qualifySponsorshipCommitment(
              db,
              {
                requestId: randomUUID(),
                contributionId: id,
                expectedVersion: 1,
                confirmation: id,
                reason: 'Explicit synthetic website agreement',
                evidenceReference: 'synthetic://website-terms',
                offer: offer()
              },
              actor
            );
        });
      }
      const mediaId = (
        await pool.query(
          `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,original_mime_type,
      original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_url,checksum_sha256,width,height,usage_rights)
      VALUES($1,'supporting_image','approved','synthetic.webp','image/webp',$2,'synthetic-original-'||$1::uuid::text,$2,'synthetic-processed-'||$1::uuid::text,
      '/api/public/sponsor-media/'||gen_random_uuid(),$3,40,30,$4::jsonb) RETURNING id`,
          [
            id,
            bytes.length,
            checksum,
            JSON.stringify({
              state: 'confirmed',
              channels: ['website'],
              targets: ['openg7'],
              transformations: ['technical'],
              credit: null,
              restrictions: null
            })
          ]
        )
      ).rows[0].id;
      await approveFixtureSubject(pool, { type: 'media', id: mediaId });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    };
    const command = async (id, visible = true) => ({
      contributionId: id,
      expectedVersion: (
        await pool.query(
          'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].version,
      visible,
      confirmed: true
    });
    const financial = async (id) =>
      (
        await pool.query(
          'SELECT amount_cents,currency,status,sponsorship_refund_status,sponsorship_refund_amount_cents FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
    const noCompletion = async (id) => {
      assert.deepEqual(await listSponsorshipFulfilmentEvidence(pool, id), []);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship_obligation.fulfilled'",
            [id]
          )
        ).rows[0].count,
        0
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM email_messages WHERE metadata->>'contributionId'=$1 AND template_key='sponsorship_obligation' AND metadata->>'event'='fulfilled'",
            [id]
          )
        ).rows[0].count,
        0
      );
    };
    await t.test(
      'social and other-site duration qualifications remain refused atomically',
      async () => {
        const id = await seed({ commitment: 'needs_confirmation' });
        const before = await financial(id);
        for (const channel of ['website', 'facebook', 'linkedin'])
          await assert.rejects(
            withPostgresTransaction(pool, (db) =>
              qualifySponsorshipCommitment(
                db,
                {
                  requestId: randomUUID(),
                  contributionId: id,
                  expectedVersion: 1,
                  confirmation: id,
                  reason: 'Explicit synthetic duration agreement',
                  evidenceReference: 'synthetic://duration',
                  offer: {
                    ...offer(30),
                    benefits: [
                      {
                        ...offer(30).benefits[0],
                        channel,
                        id:
                          channel === 'website'
                            ? 'website_mention'
                            : channel + '_batch',
                        target: channel === 'website' ? 'openg20' : 'openg7'
                      }
                    ]
                  }
                },
                actor
              )
            ),
            { code: 'COMMITMENT_DURATION_UNSUPPORTED', status: 400 }
          );
        const m = await loadSponsorshipCommitment(pool, id);
        assert.equal(m.state, 'needs_confirmation');
        assert.equal(m.version, 1);
        assert.equal(m.offer, null);
        assert.deepEqual(m.obligations, []);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_commitment_changes WHERE commitment_id=$1',
              [m.id]
            )
          ).rows[0].count,
          0
        );
        await noCompletion(id);
        assert.deepEqual(await financial(id), before);
      }
    );
    await t.test(
      'show then immediate hide never fulfils an existing 30-day exposure agreement or rewrites its terms',
      async () => {
        const id = await seed({
          commitment: 'legacy_duration',
          durationDays: 30
        });
        const before = await loadSponsorshipCommitment(pool, id);
        const initial = publicSponsorshipObligations(before.obligations)[0];
        assert.equal(initial.state, 'pending');
        assert.equal(initial.blockedReason, null);
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await command(id),
            actor,
            storage
          ),
          'updated'
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await command(id, false),
            actor,
            storage
          ),
          'updated'
        );
        const after = await loadSponsorshipCommitment(pool, id);
        assert.deepEqual(after.offer, before.offer);
        assert.equal(after.offer.benefits[0].durationDays, 30);
        assert.equal(after.obligations[0].state, 'pending');
        assert.equal(
          after.obligations[0].version,
          before.obligations[0].version
        );
        assert.equal(after.obligations[0].fulfilmentEvidenceId, null);
        await noCompletion(id);
        // The open obligation remains available to the owner for explicit resolution.
        await withPostgresTransaction(pool, (db) =>
          adjustSponsorshipObligation(
            db,
            {
              requestId: randomUUID(),
              obligationId: after.obligations[0].id,
              expectedVersion: after.obligations[0].version,
              confirmation: after.obligations[0].id,
              reason:
                'Explicit synthetic waiver after reviewing the preserved duration agreement',
              kind: 'waiver'
            },
            actor
          )
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'adjusted'
        );
        await noCompletion(id);
      }
    );
    for (const commitment of ['none', 'needs_confirmation', 'active'])
      await t.test(
        `eligible partial refund permits visibility with ${commitment} commitment without fabricating fulfilment`,
        async () => {
          const id = await seed({
            commitment,
            refundStatus: 'completed',
            refundAmount: 1000
          });
          const before = await financial(id);
          const progress = await getSponsorshipProgress(pool, id);
          assert.equal(progress.dossier.website.canPublish, true);
          const input = await command(id);
          assert.equal(
            await setSponsorshipWebsiteVisibility(pool, input, actor, storage),
            'updated'
          );
          assert.equal(
            await setSponsorshipWebsiteVisibility(pool, input, actor, storage),
            'unchanged'
          );
          assert.equal(
            (await listPublicSponsorships(pool)).sponsorships.some(
              (s) =>
                s.public_id ===
                createHash('sha256')
                  .update('public-sponsor:' + id)
                  .digest('hex')
            ),
            true
          );
          await noCompletion(id);
          assert.deepEqual(await financial(id), before);
          if (commitment === 'active')
            assert.equal(
              (await loadSponsorshipCommitment(pool, id)).obligations[0]
                .blockedReason,
              'refund_completed'
            );
        }
      );
    for (const [refundStatus, refundAmount] of [
      ['requested', 1000],
      ['processing', 1000],
      ['completed', 5000]
    ])
      await t.test(
        `refund ${refundStatus}/${refundAmount} still blocks visibility and creates no proof`,
        async () => {
          const id = await seed({
            commitment: 'active',
            refundStatus,
            refundAmount
          });
          const before = await financial(id);
          assert.equal(
            await setSponsorshipWebsiteVisibility(
              pool,
              await command(id),
              actor,
              storage
            ),
            'blocked'
          );
          assert.equal(
            (
              await pool.query(
                'SELECT sponsor_site_visibility_held AS held FROM fund_contributions WHERE id=$1',
                [id]
              )
            ).rows[0].held,
            true
          );
          await noCompletion(id);
          assert.deepEqual(await financial(id), before);
        }
      );
  }
);
