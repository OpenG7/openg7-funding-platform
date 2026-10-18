import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { SponsorMediaWorkspaceService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/service.js';
import {
  createSponsorMediaAsset,
  listPublicSponsorMediaByContributionIds
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';

const actor = 'admin:00000000-0000-4000-8000-000000000004';
const rights = {
  state: 'confirmed',
  channels: ['website', 'facebook', 'linkedin'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: 'Photographie : Atelier synthétique',
  restrictions: null
};
const code = (expected) => (error) => error.code === expected;

test(
  'media workspace inheritance, exact collective decisions, website separation and durable deletion on disposable PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const deleted = [];
    let cleanupFails = false;
    let imageAvailable = true;
    let imageCorrupt = false;
    const image = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#888888' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(image).digest('hex');
    const service = new SponsorMediaWorkspaceService(pool, {
      async readPrivateObject() {
        return !imageAvailable
          ? null
          : imageCorrupt
            ? Buffer.from('Synthetic corrupt media')
            : image;
      },
      async deletePrivateObject(key) {
        if (cleanupFails) throw new Error('Synthetic outage');
        deleted.push(key);
        return true;
      },
      async deletePublicObject(key) {
        deleted.push(key);
        return true;
      }
    });
    const contributionId = (
      await pool.query(
        "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,sponsor_review_status,sponsor_company_name,public_display_consent) VALUES('sponsorship_interest',50000,'cad','paid','pending_review','Synthetic workshop',TRUE) RETURNING id"
      )
    ).rows[0].id;
    async function upload(id = contributionId) {
      const assetId = randomUUID();
      const created = await createSponsorMediaAsset(pool, {
        id: assetId,
        contributionId: id,
        kind: 'supporting_image',
        uploadedBy: 'sponsor',
        auditActor: 'synthetic-uploader',
        storageDriver: 'local',
        originalFilename: 'synthetic.webp',
        originalMimeType: 'image/webp',
        originalSizeBytes: image.length,
        originalStorageKey: assetId + '/original.webp',
        processedSizeBytes: image.length,
        processedStorageKey: assetId + '/processed.webp',
        checksumSha256: checksum,
        width: 100,
        height: 80,
        altText: 'Synthetic workshop photograph',
        maxSupportingImages: 100
      });
      assert.equal(created.status, 'created');
      return created.asset.id;
    }
    const first = await upload(),
      second = await upload();
    let futureAssetId;
    const ws = () => service.workspace(contributionId);
    async function rules(scope, scopeId, usage, coveredAssetIds, extra = {}) {
      return service.rules(
        {
          requestId: randomUUID(),
          contributionId,
          expectedRevision: (await ws()).revision,
          scope,
          scopeId,
          usage,
          coveredAssetIds,
          evidenceReference:
            'Synthetic authorization source covering these exact photographs',
          confirmation: scopeId,
          ...extra
        },
        actor
      );
    }
    async function plan(action, ids = [first, second], extra = {}) {
      const current = await ws();
      return service.plan(
        {
          requestId: randomUUID(),
          contributionId,
          expectedRevision: current.revision,
          action,
          assets: ids.map((id) => ({
            id,
            version: current.assets.find((a) => a.id === id).version
          })),
          ...extra
        },
        actor
      );
    }
    const execute = (p) =>
      service.execute(
        {
          requestId: randomUUID(),
          planId: p.id,
          confirmation: p.id,
          humanReviewed: true
        },
        actor
      );

    await t.test(
      'historical unknowns stay unknown until the human applies an explicitly covered rule',
      async () => {
        let current = await rules('dossier', contributionId, rights, [
          first,
          second
        ]);
        assert.ok(
          current.assets.every((a) => a.usage.state === 'needs_confirmation')
        );
        const selectedRule = current.rules[0];
        const p = await plan('rules', [first, second], {
          ruleId: selectedRule.id
        });
        assert.deepEqual(p.blocked, []);
        await execute(p);
        current = await ws();
        assert.ok(
          current.assets.every(
            (a) => a.usage.state === 'confirmed' && a.usageSource === 'dossier'
          )
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT DISTINCT usage_rights->>'state' AS state FROM sponsor_media_assets WHERE contribution_id=$1",
              [contributionId]
            )
          ).rows,
          [{ state: 'needs_confirmation' }]
        );
        const reader = await service.workspace(contributionId, false);
        assert.ok(reader.rules.every((r) => r.evidenceReference === undefined));
        await assert.rejects(
          rules('dossier', contributionId, rights, []),
          code('MEDIA_AUTHORIZATION_SCOPE_REQUIRED')
        );
      }
    );
    await t.test(
      'a foreign proof scope fails without granting rights or changing workspace revision',
      async () => {
        const current = await ws();
        await assert.rejects(
          rules('dossier', contributionId, rights, [randomUUID()]),
          code('MEDIA_SCOPE_MISMATCH')
        );
        assert.equal((await ws()).revision, current.revision);
      }
    );
    await t.test(
      'missing or corrupt private bytes block a plan and a later execution without recording an N0',
      async () => {
        for (const mode of ['missing', 'corrupt']) {
          imageAvailable = mode !== 'missing';
          imageCorrupt = mode === 'corrupt';
          const blocked = await plan('approve');
          assert.ok(
            blocked.blocked.every((a) =>
              a.reasons.includes('MEDIA_CONTENT_UNAVAILABLE')
            )
          );
          await assert.rejects(execute(blocked), (error) =>
            ['MEDIA_PLAN_BLOCKED', 'MEDIA_CONTENT_UNAVAILABLE'].includes(
              error.code
            )
          );
        }
        imageAvailable = true;
        imageCorrupt = false;
        const prepared = await plan('approve');
        assert.deepEqual(prepared.blocked, []);
        imageCorrupt = true;
        await assert.rejects(
          execute(prepared),
          code('MEDIA_CONTENT_UNAVAILABLE')
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM moderation_decisions WHERE subject_type='media' AND subject_id=ANY($1::uuid[])",
              [[first, second]]
            )
          ).rows[0].n,
          0
        );
        imageCorrupt = false;
      }
    );
    await t.test(
      'a failed final audit rolls back both exact N0 decisions, media updates and receipt',
      async () => {
        const p = await plan('approve');
        const before = await ws();
        const requestId = randomUUID();
        await pool.query(`CREATE FUNCTION synthetic_fail_workspace_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='sponsorship.media.workspace.approve' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_fail_workspace_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_workspace_audit()`);
        try {
          await assert.rejects(
            service.execute(
              {
                requestId,
                planId: p.id,
                confirmation: p.id,
                humanReviewed: true
              },
              actor
            )
          );
          assert.deepEqual((await ws()).assets, before.assets);
          assert.deepEqual(
            await service.receipt(contributionId, requestId, actor),
            { found: false }
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM moderation_decisions WHERE subject_type='media' AND subject_id=ANY($1::uuid[])",
                [[first, second]]
              )
            ).rows[0].n,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_fail_workspace_audit ON admin_audit_log; DROP FUNCTION synthetic_fail_workspace_audit()'
          );
        }
      }
    );
    await t.test(
      'one reviewed manifest records exact N0 decisions atomically and never selects the website or sends',
      async () => {
        const p = await plan('approve');
        assert.deepEqual(p.blocked, []);
        const request = {
          requestId: randomUUID(),
          planId: p.id,
          confirmation: p.id,
          humanReviewed: true
        };
        const [receipt, concurrent] = await Promise.all([
          service.execute(request, actor),
          service.execute(request, actor)
        ]);
        assert.deepEqual(concurrent, receipt);
        assert.equal(receipt.items.length, 2);
        assert.deepEqual(await service.execute(request, actor), receipt);
        assert.deepEqual(
          await service.receipt(contributionId, request.requestId, actor),
          { found: true, result: receipt }
        );
        const current = await ws();
        assert.ok(
          current.assets.every(
            (a) =>
              a.reviewStatus === 'approved' &&
              !a.websiteSelected &&
              a.moderation.level === 'N0'
          )
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM moderation_decisions WHERE subject_type='media' AND subject_id=ANY($1::uuid[]) AND level='N0'",
              [[first, second]]
            )
          ).rows[0].n,
          2
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='sponsorship.media.workspace.approve'"
            )
          ).rows[0].n,
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM publication_deliveries'
            )
          ).rows[0].n,
          0
        );
        const repeated = await plan('approve');
        assert.ok(
          repeated.blocked.every((a) =>
            a.reasons.includes('MEDIA_ALREADY_APPROVED')
          )
        );
        await assert.rejects(execute(repeated), code('MEDIA_PLAN_BLOCKED'));
      }
    );
    await t.test(
      'website exposure is a separate confirmed selection with a matching deselection',
      async () => {
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='approved',sponsor_site_visibility_held=FALSE WHERE id=$1",
          [contributionId]
        );
        await approveFixtureSubject(pool, {
          type: 'sponsorship',
          id: contributionId
        });
        assert.equal(
          (
            await listPublicSponsorMediaByContributionIds(pool, [
              contributionId
            ])
          ).size,
          0
        );
        await execute(await plan('website_select'));
        assert.equal(
          (
            await listPublicSponsorMediaByContributionIds(pool, [
              contributionId
            ])
          ).get(contributionId).length,
          2
        );
        assert.ok(
          (
            await listPublicSponsorMediaByContributionIds(pool, [
              contributionId
            ])
          )
            .get(contributionId)
            .every((asset) => asset.credit === rights.credit)
        );
        await execute(await plan('website_deselect', [first]));
        assert.equal(
          (
            await listPublicSponsorMediaByContributionIds(pool, [
              contributionId
            ])
          ).get(contributionId).length,
          1
        );
      }
    );
    await t.test(
      'a changed rule invalidates dependent decisions and a prepared manifest without overwriting uploaded facts',
      async () => {
        const stale = await plan('website_select');
        await rules(
          'dossier',
          contributionId,
          { ...rights, channels: ['linkedin'] },
          [first, second]
        );
        await assert.rejects(
          execute(stale),
          code('WORKSPACE_VERSION_CONFLICT')
        );
        const current = await ws();
        assert.ok(
          current.assets.every(
            (a) =>
              a.reviewStatus === 'pending_review' &&
              !a.websiteSelected &&
              a.moderation.state === 'unreviewed'
          )
        );
        assert.equal(
          (
            await listPublicSponsorMediaByContributionIds(pool, [
              contributionId
            ])
          ).size,
          0
        );
      }
    );
    await t.test(
      'a media override survives dossier changes; moving members remains versioned and auditable',
      async () => {
        await rules('media', first, rights, [first]);
        await rules(
          'dossier',
          contributionId,
          { ...rights, channels: ['facebook'] },
          [first, second]
        );
        let current = await ws();
        assert.equal(
          current.assets.find((a) => a.id === first).usageSource,
          'media'
        );
        assert.deepEqual(
          current.assets.find((a) => a.id === first).usage.channels,
          rights.channels
        );
        current = await service.batch(
          {
            requestId: randomUUID(),
            contributionId,
            expectedRevision: current.revision,
            name: 'Synthetic event',
            confirmation: contributionId
          },
          actor
        );
        const batch = current.batches[0];
        await execute(
          await plan('move', [second], { targetBatchId: batch.id })
        );
        assert.equal(
          (await ws()).assets.find((a) => a.id === second).batchId,
          batch.id
        );
      }
    );
    await t.test(
      'only an explicit future scope makes a new upload inherit; existing historical assets stay explicit',
      async () => {
        const omitted = await upload();
        await execute(await plan('rules', [omitted], { ruleId: null }));
        await rules('dossier', contributionId, rights, [first, second], {
          includesFutureUploads: true
        });
        assert.equal(
          (await ws()).assets.find((a) => a.id === omitted).usage.state,
          'needs_confirmation'
        );
        const next = await upload();
        futureAssetId = next;
        const asset = (await ws()).assets.find((a) => a.id === next);
        assert.equal(asset.usage.state, 'confirmed');
        assert.equal(asset.usageSource, 'dossier');
        assert.equal(asset.reviewStatus, 'pending_review');
        assert.equal(asset.websiteSelected, false);
        assert.equal(
          (
            await pool.query(
              "SELECT usage_rights->>'state' AS state FROM sponsor_media_assets WHERE id=$1",
              [next]
            )
          ).rows[0].state,
          'needs_confirmation'
        );
      }
    );
    await t.test(
      'a withdrawn individual license cannot fall back to inherited rights; a fresh explicit authorization can restore it',
      async () => {
        let asset = (await ws()).assets.find((a) => a.id === second);
        await updateSponsorMediaUsage(pool, {
          contributionId,
          assetId: second,
          requestId: randomUUID(),
          expectedVersion: asset.version,
          actor,
          usage: { ...rights, state: 'withdrawn' },
          evidenceReference: 'Synthetic explicit rights withdrawal'
        });
        const blocked = await plan('rules', [second], { ruleId: null });
        assert.ok(blocked.blocked[0].reasons.includes('MEDIA_USAGE_WITHDRAWN'));
        await assert.rejects(execute(blocked), code('MEDIA_PLAN_BLOCKED'));
        await rules('media', second, rights, [second]);
        asset = (await ws()).assets.find((a) => a.id === second);
        assert.equal(asset.usage.state, 'confirmed');
        assert.equal(asset.usageSource, 'media');
      }
    );
    await t.test(
      'restoring inheritance removes the override reference without copying the parent license',
      async () => {
        await rules('media', first, null, []);
        const asset = (await ws()).assets.find((a) => a.id === first);
        assert.equal(asset.usageSource, 'dossier');
        assert.equal(asset.usage.state, 'confirmed');
        assert.equal(
          (
            await pool.query(
              "SELECT usage_rights->>'state' AS state FROM sponsor_media_assets WHERE id=$1",
              [first]
            )
          ).rows[0].state,
          'needs_confirmation'
        );
      }
    );
    await t.test(
      'a blocked member or stale selection cannot partially approve a batch',
      async () => {
        const before = (
          await pool.query(
            'SELECT count(*)::int AS n FROM moderation_decisions'
          )
        ).rows[0].n;
        const current = await ws();
        const p = await service.plan(
          {
            requestId: randomUUID(),
            contributionId,
            expectedRevision: current.revision,
            action: 'approve',
            assets: [
              {
                id: first,
                version: current.assets.find((a) => a.id === first).version
              },
              {
                id: second,
                version: current.assets.find((a) => a.id === second).version,
                altText: null
              }
            ]
          },
          actor
        );
        assert.ok(p.blocked.some((a) => a.id === second));
        await assert.rejects(execute(p), code('MEDIA_PLAN_BLOCKED'));
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM moderation_decisions'
            )
          ).rows[0].n,
          before
        );
      }
    );
    await t.test(
      'clearing a rule invalidates an exact N0 and snapshots unknown effective rights even when uploaded legacy rights were confirmed',
      async () => {
        await pool.query(
          'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb WHERE id=$1',
          [futureAssetId, JSON.stringify(rights)]
        );
        await execute(await plan('approve', [futureAssetId]));
        const before = (await ws()).assets.find((a) => a.id === futureAssetId);
        assert.equal(before.moderation.state, 'approved');
        await rules('dossier', contributionId, null, []);
        const asset = (await ws()).assets.find((a) => a.id === futureAssetId);
        assert.equal(asset.usage.state, 'needs_confirmation');
        assert.equal(asset.moderation.state, 'unreviewed');
        assert.notEqual(
          asset.moderation.fingerprint,
          before.moderation.fingerprint
        );
        const snapshot = (
          await pool.query(
            "SELECT moderation_snapshot('media',$1) AS content",
            [futureAssetId]
          )
        ).rows[0].content;
        assert.equal(snapshot.usage.state, 'needs_confirmation');
        assert.equal(snapshot.effectiveRule, null);
      }
    );
    await t.test(
      'deletion commits a durable cleanup intent and retries a storage outage without replaying the decision',
      async () => {
        const deliveryId = randomUUID();
        await pool.query(
          `INSERT INTO publication_deliveries(id,feed_id,kind,message,scheduled_at,account_id,mode,status,media_id,media_snapshot,approved_at,approved_by)
          VALUES($1,'openg7:facebook','news','Synthetic exact dependent delivery',NOW()+interval '1 day','synthetic-account','mock','approved',$2,'{}'::jsonb,NOW(),$3)`,
          [deliveryId, first, actor]
        );
        // A historical dependency may retain both a direct source and an active photo reference.
        await pool.query(
          `INSERT INTO publication_delivery_photos(delivery_id,contribution_id,asset_id,asset_version)
          SELECT $1,contribution_id,id,updated_at::text FROM sponsor_media_assets WHERE id=$2`,
          [deliveryId, second]
        );
        const p = await plan('delete', [first, second]);
        const receipt = await execute(p);
        assert.equal(receipt.status, 'completed');
        const delivery = (
          await pool.query(
            'SELECT status,approved_at,error_code FROM publication_deliveries WHERE id=$1',
            [deliveryId]
          )
        ).rows[0];
        assert.deepEqual(delivery, {
          status: 'blocked',
          approved_at: null,
          error_code: 'MEDIA_CHANGED'
        });
        const invalidation = (
          await pool.query(
            "SELECT actor,metadata FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.media_invalidated'",
            [deliveryId]
          )
        ).rows;
        assert.equal(invalidation.length, 1);
        assert.equal(invalidation[0].actor, actor);
        assert.deepEqual(
          invalidation[0].metadata.assetIds,
          [first, second].sort()
        );
        assert.equal(invalidation[0].metadata.code, 'MEDIA_CHANGED');
        assert.equal(invalidation[0].metadata.mediaId, null);
        assert.equal(
          (
            await pool.query(
              'SELECT version FROM publication_deliveries WHERE id=$1',
              [deliveryId]
            )
          ).rows[0].version,
          2
        );
        assert.equal(invalidation[0].metadata.requestId, receipt.requestId);
        assert.equal(
          (await ws()).assets.some((a) => a.id === first),
          false
        );
        cleanupFails = true;
        await service.tick();
        assert.equal(deleted.length, 0);
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM sponsor_media_cleanup_jobs WHERE asset_id=$1',
              [first]
            )
          ).rows[0].state,
          'pending'
        );
        cleanupFails = false;
        await pool.query(
          'UPDATE sponsor_media_cleanup_jobs SET next_attempt_at=clock_timestamp() WHERE asset_id=ANY($1::uuid[])',
          [[first, second]]
        );
        await service.tick();
        assert.equal(deleted.length, 4);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='sponsorship.media.cleanup.completed' AND entity_id=$1",
              [first]
            )
          ).rows[0].n,
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM sponsor_media_cleanup_jobs WHERE asset_id=$1',
              [first]
            )
          ).rows[0].state,
          'complete'
        );
        await service.tick();
        assert.equal(deleted.length, 4);
        const cleanupAudit = (
          await pool.query(
            "SELECT metadata FROM admin_audit_log WHERE action='sponsorship.media.cleanup.completed' AND entity_id=$1",
            [first]
          )
        ).rows[0];
        assert.equal(cleanupAudit.metadata.requestId, receipt.requestId);
      }
    );
  }
);
