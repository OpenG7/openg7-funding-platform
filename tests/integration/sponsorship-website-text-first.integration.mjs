import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { recordedLegacySponsorshipOffer } from '../support/sponsorship-commitment-fixture.mjs';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/public-sponsorships.repository.js';
import {
  loadSponsorshipObligationTimings,
  executeSponsorshipTimingCommand
} from '../../dist/apps/funding-api/src/sponsorship-obligation-timing.js';
import {
  startDisposablePostgres,
  observePostgresTransactions
} from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor as actor
} from './support/moderation-fixture.mjs';

test(
  'text-first website visibility preserves image promises, exact refresh receipts and immutable duration sources',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map();
    let reads = 0;
    const storage = {
      readPrivateObject: async (key) => {
        reads++;
        return objects.get(key) ?? null;
      }
    };
    const version = async (id) =>
      (
        await pool.query(
          'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].version;
    const visibility = async (id) => ({
      contributionId: id,
      expectedVersion: await version(id),
      visible: true,
      confirmed: true
    });
    const financial = async (id) =>
      (
        await pool.query(
          'SELECT amount_cents,currency,status,sponsorship_refund_status FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
    const proofs = async (id) =>
      (
        await pool.query(
          'SELECT * FROM sponsorship_fulfilment_evidence WHERE contribution_id=$1 ORDER BY recorded_at,id',
          [id]
        )
      ).rows;
    const seed = async ({
      imagePromise = true,
      quantity = 1,
      durationDays = null
    } = {}) => {
      const session = 'cs_text_first_' + randomUUID();
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,
      sponsor_company_name,sponsor_public_summary,email_private,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',5000,'cad','paid',NOW(),$1,'Synthetic text-first sponsor','Approved public text',
        'synthetic@example.invalid',TRUE,'approved',TRUE) RETURNING id`,
          [session]
        )
      ).rows[0].id;
      await withPostgresTransaction(pool, async (db) => {
        await activateSponsorshipCommitments(db, { stripeSessionId: session });
        const offer = recordedLegacySponsorshipOffer(5000);
        await qualifySponsorshipCommitment(
          db,
          {
            requestId: randomUUID(),
            contributionId: id,
            expectedVersion: 1,
            confirmation: id,
            reason: 'Synthetic original text and optional media terms',
            evidenceReference: 'synthetic://text-first-terms',
            offer: {
              ...offer,
              version: 'historical-qualification-v1',
              benefits: offer.benefits.map((benefit) => ({
                ...benefit,
                quantity,
                durationDays,
                requiredElements: imagePromise
                  ? ['company_name', 'approved_presentation']
                  : ['company_name']
              }))
            }
          },
          actor
        );
      });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    };
    const addMedia = async (id, selected = false) => {
      const key = 'synthetic/text-first/' + randomUUID();
      const assetId = (
        await pool.query(
          `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,original_mime_type,
      original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_url,checksum_sha256,width,height,usage_rights,website_selected)
      VALUES($1,'supporting_image','approved','synthetic.webp','image/webp',$2,$3,$2,$3,
        '/api/public/sponsor-media/'||gen_random_uuid(),$4,40,30,$5::jsonb,FALSE) RETURNING id`,
          [
            id,
            bytes.length,
            key,
            hash,
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
      objects.set(key, bytes);
      await approveFixtureSubject(pool, { type: 'media', id: assetId });
      if (selected) {
        await pool.query(
          'UPDATE sponsor_media_assets SET website_selected=TRUE,updated_at=clock_timestamp() WHERE id=$1',
          [assetId]
        );
        await approveFixtureSubject(pool, { type: 'media', id: assetId });
      }
      return { id: assetId, key };
    };
    const refresh = async (id, obligation, requestId = randomUUID()) => ({
      ...(await visibility(id)),
      refresh: {
        requestId,
        obligationId: obligation.id,
        expectedVersion: obligation.version
      }
    });

    await t.test(
      'an existing image promise permits text now and completes the same passage once after explicit image selection',
      async () => {
        const id = await seed({ quantity: 2 });
        const before = await financial(id);
        const initial = await loadSponsorshipCommitment(pool, id);
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await visibility(id),
            actor
          ),
          'updated'
        );
        assert.equal(
          (await listPublicSponsorships(pool)).sponsorships.some(
            (item) =>
              item.public_id ===
              createHash('sha256')
                .update('public-sponsor:' + id)
                .digest('hex')
          ),
          true
        );
        assert.equal((await proofs(id)).length, 0);
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0]
            .blockedReason,
          'required_elements_missing'
        );
        const unavailable = await refresh(id, initial.obligations[0]);
        assert.equal(
          await setSponsorshipWebsiteVisibility(pool, unavailable, actor),
          'blocked'
        );
        await addMedia(id, true);
        // A known blocked command stays blocked; the later human action gets a new UUID.
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            unavailable,
            actor,
            storage
          ),
          'blocked'
        );
        const command = await refresh(id, initial.obligations[0]);
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, initial.obligations[1]),
            actor,
            storage
          ),
          'blocked'
        );
        assert.deepEqual(
          await Promise.all([
            setSponsorshipWebsiteVisibility(pool, command, actor, storage),
            setSponsorshipWebsiteVisibility(pool, command, actor, storage)
          ]),
          ['updated', 'updated']
        );
        const firstProof = (await proofs(id))[0];
        assert.equal(firstProof.obligation_id, initial.obligations[0].id);
        assert.equal(firstProof.media_snapshot.length, 1);
        const count = reads;
        assert.equal(
          await setSponsorshipWebsiteVisibility(pool, command, actor, {
            readPrivateObject: async () => {
              throw new Error('must not re-read a completed receipt');
            }
          }),
          'updated'
        );
        assert.equal(reads, count);
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            pool,
            command,
            'different-actor',
            storage
          ),
          { code: 'WEBSITE_REFRESH_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          setSponsorshipWebsiteVisibility(
            pool,
            {
              ...command,
              refresh: {
                ...command.refresh,
                obligationId: initial.obligations[1].id
              }
            },
            actor,
            storage
          ),
          { code: 'WEBSITE_REFRESH_REQUEST_CONFLICT' }
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            {
              ...command,
              refresh: { ...command.refresh, requestId: randomUUID() }
            },
            actor,
            storage
          ),
          'conflict'
        );
        const after = await loadSponsorshipCommitment(pool, id);
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, after.obligations[0]),
            actor,
            storage
          ),
          'unchanged'
        );
        assert.equal(after.obligations[0].state, 'fulfilled');
        assert.equal(after.obligations[1].state, 'pending');
        // A fresh UUID is a new human command, not a new website placement.
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, after.obligations[1]),
            actor,
            storage
          ),
          'blocked'
        );
        assert.equal((await proofs(id)).length, 1);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM email_messages WHERE metadata->>'contributionId'=$1 AND metadata->>'event'='fulfilled'",
              [id]
            )
          ).rows[0].count,
          1
        );
        assert.deepEqual(await financial(id), before);
        await assert.rejects(
          pool.query(
            "UPDATE sponsorship_website_refresh_commands SET outcome='unchanged' WHERE request_id=$1",
            [command.refresh.requestId]
          ),
          { code: '23514' }
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            { ...(await visibility(id)), visible: false },
            actor
          ),
          'updated'
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await visibility(id),
            actor,
            storage
          ),
          'updated'
        );
        assert.equal((await proofs(id)).length, 2);
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[1].state,
          'fulfilled'
        );
      }
    );

    await t.test(
      'legacy visibility audits permit only their unfinished passage, while an unrecorded transition cannot be invented',
      async () => {
        const id = await seed({ quantity: 2 });
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held=FALSE WHERE id=$1',
          [id]
        );
        await addMedia(id, true);
        let obligations = (await loadSponsorshipCommitment(pool, id))
          .obligations;
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligations[0]),
            actor,
            storage
          ),
          'blocked'
        );
        assert.equal((await proofs(id)).length, 0);
        // Synthetic pre-refresh transition: legacy metadata has no obligation ID.
        await pool.query(
          `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,metadata)
           VALUES($1,'sponsorship_website.visibility','sponsorship',$2,
             '{"visible":true,"outcome":"updated"}'::jsonb)`,
          [actor, id]
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligations[0]),
            actor,
            storage
          ),
          'updated'
        );
        obligations = (await loadSponsorshipCommitment(pool, id)).obligations;
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligations[1]),
            actor,
            storage
          ),
          'blocked'
        );
        assert.equal((await proofs(id)).length, 1);
        assert.equal(obligations[1].state, 'pending');
      }
    );

    await t.test(
      'a text-only promise is fulfilled without storage and later optional imagery never rewrites its proof',
      async () => {
        const id = await seed({ imagePromise: false });
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await visibility(id),
            actor
          ),
          'updated'
        );

        const original = (await proofs(id))[0];
        assert.deepEqual(original.media_snapshot, []);
        await addMedia(id, true);
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligation),
            actor,
            storage
          ),
          'unchanged'
        );
        const evidence = await proofs(id);
        assert.equal(evidence.length, 1);
        assert.deepEqual(evidence[0], original);
      }
    );

    await t.test(
      'refresh keeps held, stale and foreign targets distinct and atomically rolls back a missing audit',
      async () => {
        const id = await seed();
        const other = await seed();
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligation),
            actor
          ),
          'blocked'
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await visibility(id),
            actor
          ),
          'updated'
        );
        const otherObligation = (await loadSponsorshipCommitment(pool, other))
          .obligations[0];
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, otherObligation),
            actor
          ),
          'not_found'
        );
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            {
              ...(await refresh(id, obligation)),
              expectedVersion: 'stale-source'
            },
            actor
          ),
          'conflict'
        );
        await addMedia(id, true);
        const command = await refresh(id, obligation);
        const tracked = observePostgresTransactions(pool);
        const checkedStorage = {
          readPrivateObject: async (key) => {
            assert.equal(tracked.openTransactions, 0);
            return objects.get(key) ?? null;
          }
        };
        await pool.query(`CREATE FUNCTION synthetic_reject_website_refresh_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
  BEGIN IF NEW.action='sponsorship_website.refresh' THEN RAISE EXCEPTION 'synthetic refresh audit unavailable'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER synthetic_reject_website_refresh_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_reject_website_refresh_audit()`);
        try {
          await assert.rejects(
            setSponsorshipWebsiteVisibility(
              tracked.pool,
              command,
              actor,
              checkedStorage
            ),
            /refresh audit unavailable/
          );
          assert.equal((await proofs(id)).length, 0);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM sponsorship_website_refresh_commands WHERE request_id=$1',
                [command.refresh.requestId]
              )
            ).rows[0].count,
            0
          );
          assert.equal(
            (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
            'pending'
          );
          assert.equal(tracked.openTransactions, 0);
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_reject_website_refresh_audit ON admin_audit_log; DROP FUNCTION synthetic_reject_website_refresh_audit()'
          );
        }
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            tracked.pool,
            command,
            actor,
            checkedStorage
          ),
          'updated'
        );
        assert.equal((await proofs(id)).length, 1);
      }
    );

    await t.test(
      'missing promised media starts no duration, and private unselected decisions do not restart a later exact exposure',
      async () => {
        const id = await seed({ durationDays: 1 });
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await visibility(id),
            actor
          ),
          'updated'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_website_exposure_observations WHERE contribution_id=$1',
              [id]
            )
          ).rows[0].count,
          0
        );
        await addMedia(id, true);
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        const command = await refresh(id, obligation);
        assert.equal(
          await setSponsorshipWebsiteVisibility(pool, command, actor, storage),
          'updated'
        );
        assert.equal((await proofs(id)).length, 0);
        const anchor = (
          await pool.query(
            'SELECT * FROM sponsorship_website_exposure_observations WHERE contribution_id=$1 ORDER BY observed_at DESC LIMIT 1',
            [id]
          )
        ).rows[0];
        const beforeVersion = await version(id);
        const privateMedia = await addMedia(id, false);
        assert.equal(await version(id), beforeVersion);
        let timing = (
          await loadSponsorshipObligationTimings(pool, [obligation.id])
        ).get(obligation.id);
        assert.equal(timing.durationState, 'awaiting_review');
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            await refresh(id, obligation),
            actor,
            storage
          ),
          'unchanged'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_website_exposure_observations WHERE contribution_id=$1',
              [id]
            )
          ).rows[0].count,
          1
        );
        const approval = (
          await pool.query(
            "SELECT current_decision_id AS id FROM moderation_cases WHERE subject_type='media' AND subject_id=$1",
            [privateMedia.id]
          )
        ).rows[0].id;
        const oldSources = structuredClone(anchor.source_snapshot);
        oldSources[0].approvals.push({
          subjectType: 'media',
          subjectId: privateMedia.id,
          decisionId: approval
        });
        // Synthetic pre-change observation: unrelated private decisions were included
        // historically. Its immutable data remains intact when comparison filters them.
        const oldAnchor = (
          await pool.query(
            `INSERT INTO sponsorship_website_exposure_observations
      (obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,actor,observed_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,clock_timestamp()-INTERVAL '2 days') RETURNING id`,
            [
              obligation.id,
              id,
              obligation.version,
              createHash('sha256')
                .update(
                  JSON.stringify({
                    message: anchor.message,
                    sources: oldSources,
                    media: anchor.media_snapshot
                  })
                )
                .digest('hex'),
              anchor.message,
              JSON.stringify(oldSources),
              JSON.stringify(anchor.media_snapshot),
              actor
            ]
          )
        ).rows[0].id;
        timing = (
          await loadSponsorshipObligationTimings(pool, [obligation.id])
        ).get(obligation.id);
        await executeSponsorshipTimingCommand(
          pool,
          {
            requestId: randomUUID(),
            obligationId: obligation.id,
            expectedVersion: timing.version,
            confirmation: obligation.id,
            reason: 'Synthetic continuous website text and selected image',
            kind: 'duration',
            startObservationId: oldAnchor,
            continuityConfirmed: true,
            evidenceReference: 'synthetic://continuous-selected-public-source'
          },
          actor,
          storage
        );
        assert.equal((await proofs(id)).length, 1);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT source_snapshot FROM sponsorship_website_exposure_observations WHERE id=$1',
              [oldAnchor]
            )
          ).rows[0].source_snapshot,
          oldSources
        );
      }
    );
  }
);
