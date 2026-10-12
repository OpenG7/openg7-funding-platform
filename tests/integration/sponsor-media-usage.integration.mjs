import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationDecision
} from './support/moderation-fixture.mjs';
import {
  createSponsorMediaAsset,
  reviewSponsorMediaAsset
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import {
  updateSponsorMediaUsage,
  requestSponsorMediaPreference,
  decideSponsorMediaPreference,
  getSponsorMediaPreference
} from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import {
  getModerationContent,
  recordModerationDecision
} from '../../dist/apps/funding-api/src/moderation/repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';

const rights = {
  state: 'confirmed',
  channels: ['website', 'facebook', 'linkedin'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait', 'composite'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
const rejectsCode = (code) => (error) =>
  error.code === code || error.cause?.code === code;
test(
  'versioned image rights and preferences preserve ownership, review and immutable audit in disposable PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      throw new Error('No external request is permitted.');
    });
    t.after(() => assert.equal(requests, 0));
    async function seed(usage) {
      const contributionId = (
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,sponsor_review_status) VALUES('sponsorship_interest',50000,'cad','paid','pending_review') RETURNING id"
        )
      ).rows[0].id;
      const created = await createSponsorMediaAsset(pool, {
        id: randomUUID(),
        contributionId,
        kind: 'supporting_image',
        uploadedBy: 'sponsor',
        auditActor: 'synthetic-uploader',
        storageDriver: 'local',
        originalFilename: 'synthetic.png',
        originalMimeType: 'image/png',
        originalSizeBytes: 100,
        originalStorageKey: randomUUID() + '/original.png',
        processedSizeBytes: 80,
        processedStorageKey: randomUUID() + '/processed.webp',
        checksumSha256: 'a'.repeat(64),
        width: 1,
        height: 1,
        altText: null,
        maxSupportingImages: 3,
        ...(usage ? { usage } : {})
      });
      assert.equal(created.status, 'created');
      return { contributionId, asset: created.asset };
    }
    const content = (id) =>
      withPostgresTransaction(pool, (db) =>
        getModerationContent(db, { type: 'media', id })
      );
    const usageInput = (fixture, usage = rights) => ({
      contributionId: fixture.contributionId,
      assetId: fixture.asset.id,
      expectedVersion: fixture.asset.version,
      requestId: randomUUID(),
      actor: 'synthetic-sponsor',
      usage
    });

    await t.test(
      'historical media has no inferred usage; qualification invalidates an old exact N0 and replays once',
      async () => {
        const fixture = await seed();
        assert.equal(fixture.asset.usage.state, 'needs_confirmation');
        await approveFixtureSubject(pool, {
          type: 'media',
          id: fixture.asset.id
        });
        const before = await content(fixture.asset.id),
          old = await fixtureModerationDecision(pool, {
            type: 'media',
            id: fixture.asset.id
          });
        const input = {
          ...usageInput(fixture),
          evidenceReference: 'Synthetic private authorization record'
        };
        const saved = await updateSponsorMediaUsage(pool, input);
        assert.equal(saved.asset.usage.state, 'confirmed');
        assert.equal(saved.asset.reviewStatus, 'pending_review');
        assert.equal(saved.asset.publicUrl, null);
        const after = await content(fixture.asset.id);
        assert.equal(after.contentVersion, before.contentVersion + 1);
        assert.notEqual(after.fingerprint, before.fingerprint);
        assert.deepEqual(after.snapshot.usage, saved.asset.usage);
        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            recordModerationDecision(db, {
              subject: { type: 'media', id: fixture.asset.id },
              decision: old,
              actor: 'synthetic-reviewer'
            })
          ),
          rejectsCode('MODERATION_CONTENT_CHANGED')
        );
        assert.deepEqual(await updateSponsorMediaUsage(pool, input), saved);
        const receipts = await pool.query(
          'SELECT (SELECT count(*)::int FROM sponsor_media_usage_commands WHERE contribution_id=$1) AS commands,(SELECT count(*)::int FROM sponsor_media_usage_history WHERE contribution_id=$1) AS history',
          [fixture.contributionId]
        );
        assert.deepEqual(receipts.rows[0], { commands: 1, history: 1 });
        await assert.rejects(
          pool.query(
            'UPDATE sponsor_media_usage_history SET evidence_reference=$1 WHERE asset_id=$2',
            ['changed private evidence', fixture.asset.id]
          ),
          /immutable/i
        );
        assert.equal(
          JSON.stringify(saved).includes(input.evidenceReference),
          false
        );
      }
    );
    await t.test(
      'foreign assets, stale versions and incompatible UUID replays leave rights and receipts unchanged',
      async () => {
        const a = await seed(),
          b = await seed();
        await assert.rejects(
          updateSponsorMediaUsage(pool, {
            ...usageInput(a),
            assetId: b.asset.id,
            expectedVersion: b.asset.version
          }),
          rejectsCode('MEDIA_NOT_FOUND')
        );
        const input = usageInput(a),
          saved = await updateSponsorMediaUsage(pool, input);
        await assert.rejects(
          updateSponsorMediaUsage(pool, {
            ...input,
            usage: { ...rights, credit: 'Different credit' }
          }),
          rejectsCode('IDEMPOTENCY_CONFLICT')
        );
        await assert.rejects(
          updateSponsorMediaUsage(pool, { ...input, requestId: randomUUID() }),
          rejectsCode('VERSION_CONFLICT')
        );
        assert.equal(
          (await content(a.asset.id)).snapshot.usage.credit,
          rights.credit
        );
        assert.notEqual(saved.asset.version, a.asset.version);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsor_media_usage_commands WHERE contribution_id=$1',
              [b.contributionId]
            )
          ).rows[0].count,
          0
        );
      }
    );
    await t.test(
      'withdrawing rights revokes review and public visibility without erasing the stored artifact',
      async () => {
        const fixture = await seed(rights);
        const decision = await fixtureModerationDecision(pool, {
          type: 'media',
          id: fixture.asset.id
        });
        const approved = await reviewSponsorMediaAsset(pool, {
          assetId: fixture.asset.id,
          expectedVersion: fixture.asset.version,
          reviewStatus: 'approved',
          altText: null,
          publicStorageKey: 'synthetic/public.webp',
          publicUrl: '/api/public/sponsor-media/synthetic',
          reviewedBy: 'synthetic-reviewer',
          confirmation: fixture.asset.id,
          moderationDecision: decision
        });
        assert.equal(approved.status, 'updated');
        fixture.asset = approved.asset;
        const saved = await updateSponsorMediaUsage(
          pool,
          usageInput(fixture, { ...rights, state: 'withdrawn' })
        );
        assert.equal(saved.asset.usage.state, 'withdrawn');
        assert.equal(saved.asset.publicUrl, null);
        assert.equal(saved.asset.reviewStatus, 'pending_review');
        assert.equal(
          (
            await pool.query(
              'SELECT public_storage_key FROM sponsor_media_assets WHERE id=$1',
              [fixture.asset.id]
            )
          ).rows[0].public_storage_key,
          'synthetic/public.webp'
        );
        assert.equal(
          (
            await pool.query(
              "SELECT state FROM moderation_cases WHERE subject_type='media' AND subject_id=$1",
              [fixture.asset.id]
            )
          ).rows[0].state,
          'unreviewed'
        );
      }
    );
    await t.test(
      'preference belongs to its dossier, preserves one receipt and admits only one concurrent revision',
      async () => {
        const a = await seed(rights),
          b = await seed(rights);
        const input = {
          contributionId: a.contributionId,
          requestId: randomUUID(),
          expectedRevision: 0,
          assetId: a.asset.id,
          correction: 'Please use the displayed photograph.',
          actor: 'synthetic-sponsor'
        };
        await assert.rejects(
          requestSponsorMediaPreference(pool, {
            ...input,
            assetId: b.asset.id
          }),
          rejectsCode('MEDIA_NOT_FOUND')
        );
        const outcomes = await Promise.allSettled([
          requestSponsorMediaPreference(pool, input),
          requestSponsorMediaPreference(pool, {
            ...input,
            requestId: randomUUID()
          })
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === 'fulfilled').length,
          1
        );
        assert.equal(
          outcomes.filter((result) => result.status === 'rejected').length,
          1
        );
        const accepted = outcomes.find(
          (result) => result.status === 'fulfilled'
        ).value;
        assert.equal(accepted.preference.revision, 1);
        assert.equal(accepted.preference.state, 'pending');
        const receipt = (
          await pool.query(
            "SELECT request_id FROM sponsor_media_usage_commands WHERE contribution_id=$1 AND operation='preference'",
            [a.contributionId]
          )
        ).rows[0];
        assert.deepEqual(
          await requestSponsorMediaPreference(pool, {
            ...input,
            requestId: receipt.request_id
          }),
          accepted
        );
        const decision = {
          contributionId: a.contributionId,
          requestId: randomUUID(),
          expectedRevision: 1,
          state: 'accepted',
          sponsorExplanation:
            'This owned photograph is suitable for preparation.',
          actor: 'synthetic-reviewer'
        };
        const reviewed = await decideSponsorMediaPreference(pool, decision);
        assert.equal(reviewed.preference.revision, 2);
        assert.equal(reviewed.preference.state, 'accepted');
        assert.deepEqual(
          await decideSponsorMediaPreference(pool, decision),
          reviewed
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM publication_deliveries WHERE status='approved'"
            )
          ).rows[0].count,
          0
        );
      }
    );
    await t.test(
      'deleted preferred image remains identified and unavailable; there is no automatic replacement',
      async () => {
        const fixture = await seed(rights);
        await requestSponsorMediaPreference(pool, {
          contributionId: fixture.contributionId,
          requestId: randomUUID(),
          expectedRevision: 0,
          assetId: fixture.asset.id,
          correction: null,
          actor: 'synthetic-sponsor'
        });
        await pool.query(
          'UPDATE sponsor_media_assets SET deleted_at=clock_timestamp() WHERE id=$1',
          [fixture.asset.id]
        );
        const preference = await getSponsorMediaPreference(
          pool,
          fixture.contributionId
        );
        assert.equal(preference.preferredAssetId, fixture.asset.id);
        assert.equal(preference.available, false);
        assert.equal(preference.state, 'pending');
        await assert.rejects(
          decideSponsorMediaPreference(pool, {
            contributionId: fixture.contributionId,
            requestId: randomUUID(),
            expectedRevision: 1,
            state: 'accepted',
            sponsorExplanation: 'Synthetic decision for a deleted image.',
            actor: 'synthetic-reviewer'
          }),
          rejectsCode('MEDIA_NOT_FOUND')
        );
      }
    );
    await t.test(
      'human restrictions are required and audited in the same transaction as current N0 approval',
      async () => {
        const fixture = await seed({
          ...rights,
          restrictions: 'Only with the full required caption.'
        });
        const decision = await fixtureModerationDecision(pool, {
          type: 'media',
          id: fixture.asset.id
        });
        const input = {
          assetId: fixture.asset.id,
          expectedVersion: fixture.asset.version,
          reviewStatus: 'approved',
          altText: null,
          publicStorageKey: fixture.asset.id + '/public.webp',
          publicUrl: '/api/public/sponsor-media/' + fixture.asset.id,
          reviewedBy: 'synthetic-reviewer',
          confirmation: fixture.asset.id,
          moderationDecision: decision
        };
        await assert.rejects(
          reviewSponsorMediaAsset(pool, input),
          rejectsCode('MEDIA_RESTRICTIONS_REVIEW_REQUIRED')
        );
        const result = await reviewSponsorMediaAsset(pool, {
          ...input,
          usageRestrictionsConfirmed: true
        });
        assert.equal(result.status, 'updated');
        assert.equal(result.asset.usageRestrictionsReviewed, true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship.media.restrictions-reviewed'",
              [fixture.asset.id]
            )
          ).rows[0].count,
          1
        );
      }
    );
    await t.test(
      'audit failure rolls back rights, immutable evidence and command receipt together',
      async () => {
        const fixture = await seed();
        const before = await content(fixture.asset.id);
        await pool.query(
          "CREATE FUNCTION synthetic_block_usage_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sponsorship.media.usage' THEN RAISE EXCEPTION 'Synthetic usage audit failure'; END IF; RETURN NEW; END $$"
        );
        await pool.query(
          'CREATE TRIGGER synthetic_block_usage_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_block_usage_audit()'
        );
        try {
          await assert.rejects(
            updateSponsorMediaUsage(pool, usageInput(fixture))
          );
          assert.deepEqual(await content(fixture.asset.id), before);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM sponsor_media_usage_commands WHERE contribution_id=$1',
                [fixture.contributionId]
              )
            ).rows[0].count,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_block_usage_audit ON admin_audit_log'
          );
          await pool.query('DROP FUNCTION synthetic_block_usage_audit()');
        }
      }
    );
  }
);
