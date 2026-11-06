import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { SponsorMediaWorkspaceService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/service.js';
import { createSponsorMediaAsset } from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import { SponsorMediaExportService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/export.js';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const actor = 'synthetic-media-preparation-operator';
test(
  'native media preparation is scoped, versioned, replayable and never publishes',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const image = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#1976d2' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(image).digest('hex');
    const service = new SponsorMediaWorkspaceService(pool, {
      readPrivateObject: async () => image,
      deletePrivateObject: async () => true,
      deletePublicObject: async () => true
    });
    async function dossier() {
      const id = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      sponsor_review_status,sponsor_company_name,public_display_consent,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',50000,'CAD','paid',NOW(),'pending_review','Synthetic gallery',TRUE,FALSE) RETURNING id`)
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        benefits: [
          { channel: 'website', target: 'openg7', quantity: 1 },
          {
            channel: 'facebook',
            target: 'openg7',
            quantity: 1,
            format: 'individual_portrait'
          }
        ]
      });
      return id;
    }
    const contributionId = await dossier();
    const otherContributionId = await dossier();
    async function upload(owner = contributionId) {
      const id = randomUUID();
      const created = await createSponsorMediaAsset(pool, {
        id,
        contributionId: owner,
        kind: 'supporting_image',
        uploadedBy: 'admin',
        auditActor: actor,
        storageDriver: 'local',
        originalFilename: 'synthetic-gallery.webp',
        originalMimeType: 'image/webp',
        originalSizeBytes: image.length,
        originalStorageKey: id + '/original.webp',
        processedSizeBytes: image.length,
        processedStorageKey: id + '/processed.webp',
        checksumSha256: checksum,
        width: 32,
        height: 24,
        altText: 'Synthetic gallery photograph',
        maxSupportingImages: 100
      });
      assert.equal(created.status, 'created');
      await updateSponsorMediaUsage(pool, {
        requestId: randomUUID(),
        contributionId: owner,
        assetId: id,
        expectedVersion: created.asset.version,
        actor,
        evidenceReference: 'synthetic://exact-gallery-rights',
        usage: {
          state: 'confirmed',
          channels: ['website', 'facebook'],
          targets: ['openg7'],
          transformations: ['technical', 'portrait'],
          credit: null,
          restrictions: null
        }
      });
      return id;
    }
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await upload());
    const foreignAssetId = await upload(otherContributionId);
    const ws = () => service.workspace(contributionId);
    const initial = await ws();
    assert.equal(initial.assets.length, 20);
    assert.equal(initial.preparationObligations.length, 2);
    assert.ok(initial.preparationObligations.every((o) => o.acceptsMedia));
    const web = initial.preparationObligations.find(
      (o) => o.channel === 'website'
    );
    const facebook = initial.preparationObligations.find(
      (o) => o.channel === 'facebook'
    );
    const foreignTarget = (await service.workspace(otherContributionId))
      .preparationObligations[0];
    async function plan(action, selected = ids, target = web, extra = {}) {
      const current = await ws();
      return service.plan(
        {
          requestId: randomUUID(),
          contributionId,
          expectedRevision: current.revision,
          action,
          assets: selected.map((id) => ({
            id,
            version:
              current.assets.find((a) => a.id === id)?.version ??
              'foreign-version'
          })),
          targetObligationId: target.id,
          targetObligationVersion: target.version,
          ...extra
        },
        actor
      );
    }
    const command = (p) => ({
      requestId: randomUUID(),
      planId: p.id,
      confirmation: p.id,
      humanReviewed: true
    });
    const facts = async () => ({
      assets: (
        await pool.query(
          'SELECT id,review_status,website_selected,usage_rights,updated_at::text FROM sponsor_media_assets WHERE contribution_id=$1 ORDER BY id',
          [contributionId]
        )
      ).rows,
      dossier: (
        await pool.query(
          'SELECT sponsor_review_status,public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
          [contributionId]
        )
      ).rows,
      deliveries: (
        await pool.query(
          'SELECT count(*)::int AS count FROM publication_deliveries'
        )
      ).rows,
      emails: (
        await pool.query('SELECT count(*)::int AS count FROM email_messages')
      ).rows
    });
    const before = await facts();
    await t.test(
      'twenty references prepare one dossier without N0, website selection or publication',
      async () => {
        const p = await plan('preparation_assign');
        assert.deepEqual(p.blocked, []);
        assert.equal(p.preparationTarget.id, web.id);
        assert.ok(p.effects.includes('NO_PUBLICATION_AUTHORIZATION'));
        const input = command(p);
        await assert.rejects(
          service.execute({ ...input, humanReviewed: false }, actor),
          { code: 'CONFIRMATION_REQUIRED' }
        );
        const receipt = await service.execute(input, actor);
        assert.equal(receipt.items.length, 20);
        assert.deepEqual(await service.execute(input, actor), receipt);
        assert.deepEqual(
          (await service.receipt(contributionId, input.requestId, actor))
            .result,
          receipt
        );
        await assert.rejects(
          service.receipt(
            contributionId,
            input.requestId,
            'synthetic-other-admin'
          ),
          { code: 'MEDIA_RECEIPT_ACTOR_MISMATCH' }
        );
        assert.deepEqual(await facts(), before);
        assert.equal((await ws()).preparationAssignments.length, 20);
        assert.ok((await ws()).preparationAssignments.every((a) => !a.stale));
      }
    );
    await t.test(
      'another dossier, forged target and stale target versions cannot create an association',
      async () => {
        await assert.rejects(
          plan('preparation_assign', [ids[0]], foreignTarget),
          { code: 'MEDIA_PREPARATION_SCOPE_MISMATCH' }
        );
        await assert.rejects(plan('preparation_assign', [foreignAssetId]), {
          code: 'MEDIA_SCOPE_MISMATCH'
        });
        await assert.rejects(
          plan('preparation_assign', [ids[0]], {
            ...web,
            version: web.version + 1
          }),
          { code: 'MEDIA_PREPARATION_VERSION_CONFLICT' }
        );
        await assert.rejects(
          pool.query(
            `INSERT INTO sponsor_media_preparation_assignments(contribution_id,obligation_id,
        obligation_version,obligation_fingerprint,asset_id,asset_version,actor,media_fingerprint) VALUES($1,$2,1,$3,$4,'version',$5,$3)`,
            [contributionId, web.id, 'a'.repeat(64), foreignAssetId, actor]
          ),
          { code: '23503' }
        );
      }
    );
    await t.test(
      'multiple tabs use workspace CAS and a media can prepare two promised services',
      async () => {
        const first = await plan('preparation_assign', [ids[0]], facebook);
        const second = await plan('preparation_assign', [ids[1]], facebook);
        await service.execute(command(first), actor);
        await assert.rejects(service.execute(command(second), actor), {
          code: 'WORKSPACE_VERSION_CONFLICT'
        });
        const assignments = (await ws()).preparationAssignments.filter(
          (a) => a.assetId === ids[0]
        );
        assert.equal(assignments.length, 2);
        assert.deepEqual(await facts(), before);
      }
    );
    await t.test(
      'removing preparation retains the source and leaves a durable revision tombstone',
      async () => {
        const previous = (
          await pool.query(
            'SELECT max(updated_at)::text AS version FROM sponsor_media_preparation_assignments WHERE obligation_id=$1',
            [web.id]
          )
        ).rows[0].version;
        await service.execute(
          command(await plan('preparation_unassign', [ids[0]])),
          actor
        );
        assert.equal(
          (await ws()).preparationAssignments.filter(
            (a) => a.obligationId === web.id
          ).length,
          19
        );
        const row = (
          await pool.query(
            'SELECT active,updated_at::text FROM sponsor_media_preparation_assignments WHERE obligation_id=$1 AND asset_id=$2',
            [web.id, ids[0]]
          )
        ).rows[0];
        assert.equal(row.active, false);
        assert.notEqual(row.updated_at, previous);
        assert.deepEqual(await facts(), before);
      }
    );
    await t.test(
      'source changes mark references stale and expired plans cannot silently use the new version',
      async () => {
        const pending = await plan('preparation_assign', [ids[2]], facebook);
        await pool.query(
          "UPDATE sponsor_media_assets SET alt_text='Changed synthetic caption',updated_at=clock_timestamp() WHERE id=$1",
          [ids[2]]
        );
        const current = await ws();
        assert.equal(
          current.preparationAssignments.find((a) => a.assetId === ids[2])
            .stale,
          true
        );
        await assert.rejects(service.execute(command(pending), actor), {
          code: 'WORKSPACE_VERSION_CONFLICT'
        });
        const p = await plan('preparation_assign', [ids[3]], facebook);
        await pool.query(
          'UPDATE sponsorship_obligations SET version=version+1 WHERE id=$1',
          [facebook.id]
        );
        await assert.rejects(service.execute(command(p), actor), {
          code: 'MEDIA_PREPARATION_VERSION_CONFLICT'
        });
      }
    );
    await t.test(
      'Examiner versions include private associations and do not revive after the last assignment is removed',
      async (section) => {
        const preparation = new AdminPreparationService(pool);
        const generation = () =>
          preparation.servicePreparation(otherContributionId, foreignTarget.id);
        const before = await generation();
        await section.test(
          'collective corrections use native N1 and never enqueue an implicit email',
          async () => {
            await pool.query(
              "UPDATE fund_contributions SET email_private='synthetic-gallery@example.test' WHERE id=$1",
              [contributionId]
            );
            const current = await ws();
            const request = {
              requestId: randomUUID(),
              contributionId,
              expectedRevision: current.revision,
              action: 'request_correction',
              assets: [ids[4], ids[5]].map((id) => ({
                id,
                version: current.assets.find((a) => a.id === id).version
              })),
              reason: 'EDITORIAL_INCOMPATIBILITY',
              editorialProvision: 'recognition-scope',
              internalReason: 'Synthetic private correction instructions',
              sponsorExplanation:
                'Please provide a clearer replacement for these two synthetic photographs.'
            };
            const p = await service.plan(request, actor);
            assert.deepEqual(p.blocked, []);
            assert.ok(p.effects.includes('NO_OUTBOUND_MESSAGE'));
            const emailsBefore = (
              await pool.query(
                'SELECT count(*)::int AS count FROM email_messages'
              )
            ).rows[0].count;
            const input = command(p);
            await service.execute(input, actor);
            await service.execute(input, actor);
            const after = await ws();
            for (const id of [ids[4], ids[5]]) {
              assert.equal(
                after.assets.find((a) => a.id === id).moderation.state,
                'correction_requested'
              );
              assert.equal(
                after.preparationAssignments.find((a) => a.assetId === id)
                  .stale,
                true
              );
            }
            assert.equal(
              (
                await pool.query(
                  'SELECT count(*)::int AS count FROM email_messages'
                )
              ).rows[0].count,
              emailsBefore
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='moderation.notification_deferred'"
                )
              ).rows[0].count,
              2
            );
            const invalid = await service.plan(
              {
                ...request,
                requestId: randomUUID(),
                expectedRevision: after.revision,
                reason: 'HATE_TARGETED'
              },
              actor
            );
            assert.ok(
              invalid.blocked.every((entry) =>
                entry.reasons.includes('MODERATION_LEVEL_INCOMPATIBLE')
              )
            );
            await assert.rejects(service.execute(command(invalid), actor), {
              code: 'MEDIA_PLAN_BLOCKED'
            });
          }
        );
        await section.test(
          'private WebP exports require confirmation, ownership and exact versions and audit one prepared receipt',
          async () => {
            const exporter = new SponsorMediaExportService(pool, {
              readPrivateObject: async () => image
            });
            const asset = (await ws()).assets.find((a) => a.id === ids[6]);
            const input = {
              requestId: randomUUID(),
              contributionId,
              assetId: asset.id,
              expectedVersion: asset.version,
              confirmation: asset.id
            };
            const beforeExport = await facts();
            const result = await exporter.export(input, actor);
            assert.deepEqual(result.bytes, image);
            assert.equal(result.mimeType, 'image/webp');
            assert.equal(result.filename, `media-${asset.id}.webp`);
            assert.deepEqual(
              (await exporter.export(input, actor)).bytes,
              image
            );
            assert.equal(
              (
                await pool.query(
                  "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='sponsorship.media.workspace.export' AND metadata->>'requestId'=$1",
                  [input.requestId]
                )
              ).rows[0].count,
              1
            );
            assert.deepEqual(await facts(), beforeExport);
            await assert.rejects(
              exporter.export({ ...input, confirmation: 'wrong' }, actor),
              { code: 'INVALID_MEDIA_EXPORT' }
            );
            await assert.rejects(
              exporter.export(
                { ...input, contributionId: otherContributionId },
                actor
              ),
              { code: 'MEDIA_NOT_FOUND' }
            );
            await assert.rejects(
              exporter.export({ ...input, expectedVersion: 'stale' }, actor),
              { code: 'MEDIA_VERSION_CONFLICT' }
            );
            await assert.rejects(
              exporter.export(input, 'synthetic-other-operator'),
              { code: 'IDEMPOTENCY_CONFLICT' }
            );
            const unavailable = new SponsorMediaExportService(pool, {
              readPrivateObject: async () => null
            });
            await assert.rejects(
              unavailable.export({ ...input, requestId: randomUUID() }, actor),
              { code: 'MEDIA_CONTENT_UNAVAILABLE' }
            );
            const racing = new SponsorMediaExportService(pool, {
              readPrivateObject: async () => {
                await pool.query(
                  'UPDATE sponsor_media_assets SET updated_at=clock_timestamp() WHERE id=$1',
                  [asset.id]
                );
                return image;
              }
            });
            await assert.rejects(
              racing.export({ ...input, requestId: randomUUID() }, actor),
              { code: 'MEDIA_VERSION_CONFLICT' }
            );
          }
        );
        const assign = async (action) => {
          const current = await service.workspace(otherContributionId);
          const asset = current.assets.find((a) => a.id === foreignAssetId);
          const p = await service.plan(
            {
              requestId: randomUUID(),
              contributionId: otherContributionId,
              expectedRevision: current.revision,
              action,
              targetObligationId: foreignTarget.id,
              targetObligationVersion: foreignTarget.version,
              assets: [{ id: asset.id, version: asset.version }]
            },
            actor
          );
          assert.deepEqual(p.blocked, []);
          await service.execute(command(p), actor);
        };
        await assign('preparation_assign');
        const during = await generation();
        assert.notEqual(during.contentVersion, before.contentVersion);
        await assign('preparation_unassign');
        const after = await generation();
        assert.notEqual(after.contentVersion, before.contentVersion);
        assert.notEqual(after.contentVersion, during.contentVersion);
        assert.equal(
          (await service.workspace(otherContributionId)).preparationAssignments
            .length,
          0
        );
      }
    );
    await t.test(
      'opening a reconsideration after planning blocks private assignment before the first mutation',
      async () => {
        const decision = await approveFixtureSubject(pool, {
          type: 'media',
          id: ids[8]
        });
        const p = await plan('preparation_assign', [ids[8]], web);
        assert.deepEqual(p.blocked, []);
        const versions = (await ws()).assets.find(
          (a) => a.id === ids[8]
        ).version;
        await pool.query(
          "INSERT INTO moderation_appeals(decision_id,contribution_id,request_id,request_fingerprint,message,requester) VALUES($1,$2,$3,$4,'Synthetic new reconsideration evidence','synthetic-sponsor')",
          [decision.id, contributionId, randomUUID(), 'a'.repeat(64)]
        );
        assert.equal(
          (await ws()).assets.find((a) => a.id === ids[8]).version,
          versions
        );
        await assert.rejects(service.execute(command(p), actor), {
          code: 'MEDIA_PREPARATION_NOT_ELIGIBLE'
        });
      }
    );
    assert.ok(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM admin_audit_log WHERE action='sponsorship.media.workspace.preparation_assign'"
        )
      ).rows[0].count >= 2
    );
  }
);
