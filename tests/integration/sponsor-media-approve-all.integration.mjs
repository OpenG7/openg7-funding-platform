import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';
import sharp from 'sharp';

import { getSponsorMediaUsageTerms } from '../../dist/packages/funding-core/src/index.js';
import {
  createSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  listPublicSponsorMediaByContributionIds,
  updateSponsorMediaMetadata
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import { SponsorMediaWorkspaceService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/service.js';
import { SponsorMediaApproveAllService } from '../../dist/apps/funding-api/src/sponsor-media-workspace/approve-all.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const actor = 'admin:00000000-0000-4000-8000-000000000004';
const rights = {
  state: 'confirmed',
  channels: ['website', 'facebook', 'linkedin'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};
const execution = (plan, requestId = randomUUID()) => ({
  requestId,
  planId: plan.id,
  confirmation: plan.id,
  humanReviewed: true
});

test(
  'approve all uses native moderation with durable independent results and one confirmed dossier scope',
  { timeout: 300000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const owner = database.pool;
    let pool;
    t.after(async () => {
      await pool?.end();
      await database.stop();
    });
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('No external provider is used by these fixtures.');
    });
    const role = 'og7_approve_all_runtime';
    const password = randomBytes(32).toString('hex');
    const databaseName = (
      await owner.query('SELECT current_database() AS name')
    ).rows[0].name;
    await owner.query(
      buildRuntimeRoleSql(
        { role, database: databaseName, password },
        { create: true }
      )
    );
    pool = new pg.Pool({ ...owner.options, user: role, password });
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#667788' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map();
    const storage = {
      async readPrivateObject(key) {
        return objects.get(key) ?? null;
      },
      async deletePrivateObject() {
        throw new Error('Approval cannot delete objects.');
      },
      async deletePublicObject() {
        throw new Error('Approval cannot delete objects.');
      }
    };
    const service = new SponsorMediaWorkspaceService(pool, storage);
    const terms = getSponsorMediaUsageTerms('fr-CA');
    const acceptance = {
      version: terms.version,
      fingerprint: terms.fingerprint,
      locale: terms.locale,
      accepted: true
    };
    async function dossier() {
      return (
        await owner.query(`INSERT INTO fund_contributions
      (contribution_type,amount_cents,currency,status,sponsor_review_status,sponsor_company_name,public_display_consent)
      VALUES('sponsorship_interest',50000,'cad','paid','pending_review','Synthetic review dossier',FALSE) RETURNING id`)
      ).rows[0].id;
    }
    async function upload(contributionId, options = {}) {
      const id = options.id ?? randomUUID();
      const confirmed = options.confirmed !== false;
      const key = id + '/processed.webp';
      objects.set(key, bytes);
      const result = await createSponsorMediaAsset(owner, {
        id,
        requestId: randomUUID(),
        requestFingerprint: randomBytes(32).toString('hex'),
        contributionId,
        kind: options.kind ?? 'supporting_image',
        uploadedBy: confirmed ? 'sponsor' : 'admin',
        auditActor: confirmed ? 'sponsor-followup' : actor,
        storageDriver: 'local',
        originalFilename: 'synthetic-' + id + '.webp',
        originalMimeType: 'image/webp',
        originalSizeBytes: bytes.length,
        originalStorageKey: id + '/original.webp',
        originalChecksumSha256: checksum,
        processedSizeBytes: bytes.length,
        processedStorageKey: key,
        checksumSha256: checksum,
        width: 32,
        height: 24,
        altText: options.missingAlt ? null : 'A synthetic workshop scene',
        maxSupportingImages: 100,
        ...(confirmed
          ? {
              usage: { ...rights, restrictions: options.restrictions ?? null },
              termsAcceptance: acceptance
            }
          : {})
      });
      assert.equal(result.status, 'created');
      return result.asset;
    }
    async function prepare(contributionId) {
      return service.planApproveAll(
        {
          requestId: randomUUID(),
          contributionId,
          expectedRevision: (await service.workspace(contributionId)).revision
        },
        actor
      );
    }
    async function nativePlan(contributionId, action, ids, extra = {}) {
      const workspace = await service.workspace(contributionId);
      return service.plan(
        {
          requestId: randomUUID(),
          contributionId,
          expectedRevision: workspace.revision,
          action,
          assets: ids.map((id) => ({
            id,
            version: workspace.assets.find((asset) => asset.id === id).version
          })),
          ...extra
        },
        actor
      );
    }
    async function approveNative(contributionId, asset) {
      return service.execute(
        execution(await nativePlan(contributionId, 'approve', [asset.id])),
        actor
      );
    }
    async function n0(ids) {
      return (
        await owner.query(
          "SELECT count(*)::int AS count FROM moderation_decisions WHERE subject_type='media' AND subject_id=ANY($1::uuid[]) AND level='N0'",
          [ids]
        )
      ).rows[0].count;
    }
    async function sideEffects() {
      return (
        await owner.query(`SELECT
      (SELECT count(*)::int FROM email_messages) AS messages,
      (SELECT count(*)::int FROM publication_deliveries) AS publications,
      (SELECT count(*)::int FROM sponsor_media_preparation_assignments) AS assignments,
      (SELECT count(*)::int FROM sponsor_media_terms_acceptances) AS consent`)
      ).rows[0];
    }
    async function assetRow(id) {
      return (
        await owner.query('SELECT * FROM sponsor_media_assets WHERE id=$1', [
          id
        ])
      ).rows[0];
    }

    await t.test(
      'the five-media example approves two native photos or logos, skips two approvals and preserves one missing consent',
      async () => {
        const id = await dossier();
        const approved = [await upload(id), await upload(id)];
        for (const asset of approved) await approveNative(id, asset);
        await owner.query(
          'UPDATE sponsor_media_assets SET website_selected=TRUE WHERE id=$1',
          [approved[0].id]
        );
        const beforeApproved = await Promise.all(
          approved.map((asset) => assetRow(asset.id))
        );
        const fresh = [await upload(id), await upload(id, { kind: 'logo' })];
        const missing = await upload(id, { confirmed: false });
        const before = await sideEffects();
        const ids = [...approved, ...fresh, missing].map((asset) => asset.id);
        const legacy = await nativePlan(id, 'approve', ids);
        assert.ok(legacy.blocked.length);
        await assert.rejects(service.execute(execution(legacy), actor), {
          code: 'MEDIA_PLAN_BLOCKED'
        });
        const plan = await prepare(id);
        assert.equal(plan.kind, 'approve_all');
        assert.deepEqual(plan.summary, {
          total: 5,
          eligible: 2,
          blocked: 1,
          alreadyApproved: 2,
          notProcessable: 0,
          authorizationRequired: 1,
          consentRequestable: 1
        });
        assert.equal(await n0(ids), 2, 'preparation does not approve anything');
        const request = execution(plan);
        await assert.rejects(
          service.execute(request, actor),
          (error) => error.status >= 400,
          'a dossier plan cannot use the legacy atomic route'
        );
        await assert.rejects(
          service.executeApproveAll(execution(legacy), actor),
          (error) => error.status >= 400,
          'a legacy plan cannot use the dossier route'
        );
        assert.deepEqual(
          await service.approveAllReceipt(
            { contributionId: id, requestId: request.requestId },
            actor
          ),
          { found: false }
        );
        const receipt = await service.executeApproveAll(request, actor);
        assert.equal(receipt.status, 'partial');
        assert.deepEqual(receipt.summary, {
          total: 5,
          approved: 2,
          alreadyApproved: 2,
          blocked: 1,
          notProcessable: 0,
          failed: 0,
          pending: 0
        });
        assert.deepEqual(
          receipt.items
            .filter((item) => item.result === 'approved')
            .map((item) => item.id)
            .sort(),
          fresh.map((asset) => asset.id).sort()
        );
        assert.ok(
          receipt.items
            .find((item) => item.id === missing.id)
            .reasons.includes('MEDIA_USAGE_CONFIRMATION_REQUIRED')
        );
        assert.equal(await n0(ids), 4);
        assert.deepEqual(
          await Promise.all(approved.map((asset) => assetRow(asset.id))),
          beforeApproved
        );
        assert.equal(
          (await assetRow(missing.id)).review_status,
          'pending_review'
        );
        assert.deepEqual(await sideEffects(), before);
        assert.equal(
          (
            await owner.query(
              'SELECT public_display_consent FROM fund_contributions WHERE id=$1',
              [id]
            )
          ).rows[0].public_display_consent,
          false
        );
        assert.deepEqual(
          await service.executeApproveAll(request, actor),
          receipt
        );
        assert.deepEqual(
          await service.approveAllReceipt(
            { contributionId: id, requestId: request.requestId },
            actor
          ),
          { found: true, result: receipt }
        );
        await assert.rejects(
          service.receipt(id, request.requestId, actor),
          (error) => error.status >= 400,
          'legacy receipt consumers cannot mistake the new progress marker for completion'
        );
      }
    );

    await t.test(
      'pending images previously selected for an eligible public profile stay private while independent photos are approved',
      async () => {
        const id = await dossier();
        const visible = await upload(id);
        const revised = await upload(id);
        const fresh = await upload(id);
        await approveNative(id, visible);
        await approveNative(id, revised);
        await owner.query(
          'UPDATE sponsor_media_assets SET website_selected=TRUE WHERE id=ANY($1::uuid[])',
          [[visible.id, revised.id]]
        );
        await owner.query(
          `UPDATE fund_contributions SET sponsor_review_status='approved',
          public_display_consent=TRUE,sponsor_site_visibility_held=FALSE WHERE id=$1`,
          [id]
        );
        await approveFixtureSubject(owner, { type: 'sponsorship', id }, actor);
        const publicIds = async () =>
          (
            (await listPublicSponsorMediaByContributionIds(pool, [id])).get(
              id
            ) ?? []
          )
            .map((asset) => asset.id)
            .sort();
        assert.deepEqual(await publicIds(), [visible.id, revised.id].sort());
        assert.ok(await getApprovedPublicSponsorMedia(pool, revised.id));
        const version = (await service.workspace(id)).assets.find(
          (asset) => asset.id === revised.id
        ).version;
        const changed = await updateSponsorMediaMetadata(pool, {
          assetId: revised.id,
          expectedVersion: version,
          confirmation: revised.id,
          altText: 'A revised synthetic caption that requires another review',
          actor
        });
        assert.equal(changed.status, 'updated');
        const beforeRevised = await assetRow(revised.id);
        const beforeVisible = await assetRow(visible.id);
        const beforeEffects = await sideEffects();
        assert.equal(beforeRevised.review_status, 'pending_review');
        assert.equal(beforeRevised.website_selected, true);
        assert.deepEqual(await publicIds(), [visible.id]);
        assert.equal(
          await getApprovedPublicSponsorMedia(pool, revised.id),
          null
        );
        const priorRevisedDecisions = await n0([revised.id]);
        const plan = await prepare(id);
        assert.equal(plan.summary.eligible, 1);
        assert.equal(plan.summary.alreadyApproved, 1);
        const candidate = plan.candidates.find(
          ({ asset }) => asset.id === revised.id
        );
        assert.equal(candidate.classification, 'blocked');
        assert.deepEqual(candidate.reasons, [
          'MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED'
        ]);
        const receipt = await service.executeApproveAll(execution(plan), actor);
        assert.equal(receipt.status, 'partial');
        assert.equal(receipt.summary.approved, 1);
        assert.equal(receipt.summary.blocked, 1);
        assert.equal(receipt.summary.alreadyApproved, 1);
        assert.equal(await n0([fresh.id]), 1);
        assert.equal(await n0([revised.id]), priorRevisedDecisions);
        assert.deepEqual(await assetRow(revised.id), beforeRevised);
        assert.deepEqual(await assetRow(visible.id), beforeVisible);
        assert.equal((await assetRow(fresh.id)).website_selected, false);
        assert.deepEqual(await publicIds(), [visible.id]);
        assert.equal(
          await getApprovedPublicSponsorMedia(pool, revised.id),
          null
        );
        assert.equal(await getApprovedPublicSponsorMedia(pool, fresh.id), null);
        assert.ok(await getApprovedPublicSponsorMedia(pool, visible.id));
        assert.deepEqual(await sideEffects(), beforeEffects);
      }
    );

    await t.test(
      'missing consent, withdrawal, refusal, alternative text and bytes are classified without an ineffective confirmation',
      async () => {
        const id = await dossier();
        const missing = await upload(id, { confirmed: false });
        const noAlt = await upload(id, { missingAlt: true });
        const withdrawn = await upload(id);
        await updateSponsorMediaUsage(owner, {
          contributionId: id,
          assetId: withdrawn.id,
          requestId: randomUUID(),
          expectedVersion: withdrawn.version,
          actor: 'sponsor-followup',
          usage: { ...rights, state: 'withdrawn' }
        });
        const refused = await upload(id);
        const refusal = await nativePlan(id, 'reject', [refused.id], {
          reason: 'IP_RIGHTS',
          internalReason: 'Synthetic rights refusal',
          sponsorExplanation: 'Please supply an authorized photograph.'
        });
        await service.execute(execution(refusal), actor);
        const unavailable = await upload(id);
        objects.delete(unavailable.id + '/processed.webp');
        const before = await sideEffects();
        const plan = await prepare(id);
        assert.equal(plan.summary.total, 5);
        assert.equal(plan.summary.eligible, 0);
        assert.equal(plan.summary.blocked, 4);
        assert.equal(plan.summary.notProcessable, 1);
        const reasons = (asset) =>
          plan.candidates.find((candidate) => candidate.asset.id === asset.id)
            .reasons;
        assert.ok(
          reasons(missing).includes('MEDIA_USAGE_CONFIRMATION_REQUIRED')
        );
        assert.ok(reasons(withdrawn).includes('MEDIA_USAGE_WITHDRAWN'));
        assert.ok(reasons(noAlt).includes('MEDIA_ALT_TEXT_REQUIRED'));
        assert.ok(reasons(refused).includes('MEDIA_REJECTED'));
        assert.ok(reasons(unavailable).length);
        const input = execution(plan);
        await assert.rejects(
          service.executeApproveAll(input, actor),
          (error) => error.status >= 400
        );
        assert.equal(
          await n0([
            missing.id,
            noAlt.id,
            withdrawn.id,
            refused.id,
            unavailable.id
          ]),
          0
        );
        assert.deepEqual(await sideEffects(), before);
        assert.equal((await assetRow(refused.id)).review_status, 'rejected');
      }
    );

    await t.test(
      'one explicit confirmation can review the exact displayed restrictions without creating consent',
      async () => {
        const id = await dossier();
        const restricted = await upload(id, {
          restrictions: 'Use only with the full caption and without cropping.'
        });
        const before = await sideEffects();
        const plan = await prepare(id);
        assert.equal(plan.summary.eligible, 1);
        assert.equal(
          plan.candidates[0].asset.usage.restrictions,
          'Use only with the full caption and without cropping.'
        );
        assert.equal(
          (await assetRow(restricted.id)).usage_restrictions_reviewed,
          false
        );
        await assert.rejects(
          service.executeApproveAll(
            { ...execution(plan), humanReviewed: false },
            actor
          ),
          (error) => error.status === 400
        );
        assert.equal(await n0([restricted.id]), 0);
        const receipt = await service.executeApproveAll(execution(plan), actor);
        assert.equal(receipt.summary.approved, 1);
        assert.equal(
          (await assetRow(restricted.id)).usage_restrictions_reviewed,
          true
        );
        assert.deepEqual(await sideEffects(), before);
      }
    );

    await t.test(
      'a changed or deleted member does not approve the wrong version or block an intact member; new uploads remain outside the manifest',
      async () => {
        const id = await dossier();
        const intact = await upload(id),
          changed = await upload(id),
          deleted = await upload(id);
        const plan = await prepare(id);
        await owner.query(
          'UPDATE sponsor_media_assets SET alt_text=$2,updated_at=clock_timestamp() WHERE id=$1',
          [changed.id, 'A newer description requiring a fresh review']
        );
        await owner.query(
          'UPDATE sponsor_media_assets SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
          [deleted.id]
        );
        const added = await upload(id);
        const receipt = await service.executeApproveAll(execution(plan), actor);
        assert.equal(receipt.status, 'partial');
        assert.equal(receipt.summary.total, 3);
        assert.equal(receipt.summary.approved, 1);
        assert.equal(receipt.summary.notProcessable, 2);
        assert.equal(
          receipt.items.find((item) => item.id === intact.id).result,
          'approved'
        );
        assert.ok(
          receipt.items.find((item) => item.id === changed.id).reasons.length
        );
        assert.ok(
          receipt.items.find((item) => item.id === deleted.id).reasons.length
        );
        assert.equal(
          receipt.items.some((item) => item.id === added.id),
          false
        );
        assert.equal(
          (await assetRow(added.id)).review_status,
          'pending_review'
        );
        assert.equal(
          await n0([intact.id, changed.id, deleted.id, added.id]),
          1
        );
      }
    );

    await t.test(
      'concurrent execution and receipt reconciliation create at most one native decision per image and bind the actor and intent',
      async () => {
        const id = await dossier();
        const assets = [await upload(id), await upload(id)];
        const plan = await prepare(id),
          input = execution(plan);
        await assert.rejects(
          service.executeApproveAll(input, 'admin:another-actor'),
          (error) => error.status === 403
        );
        await Promise.all([
          service.executeApproveAll(input, actor),
          service.executeApproveAll(input, actor)
        ]);
        const final = await service.approveAllReceipt(
          { contributionId: id, requestId: input.requestId },
          actor
        );
        assert.equal(final.found, true);
        assert.equal(final.result.status, 'completed');
        assert.equal(final.result.summary.approved, 2);
        assert.equal(await n0(assets.map((asset) => asset.id)), 2);
        assert.deepEqual(
          await service.executeApproveAll(input, actor),
          final.result
        );
        await assert.rejects(
          service.approveAllReceipt(
            { contributionId: id, requestId: input.requestId },
            'admin:another-actor'
          ),
          (error) => error.status === 403
        );
        await upload(id);
        const anotherPlan = await prepare(id);
        await assert.rejects(
          service.executeApproveAll(
            execution(anotherPlan, input.requestId),
            actor
          ),
          (error) => error.status === 409
        );
        assert.equal(await n0(assets.map((asset) => asset.id)), 2);
        await owner.query(
          'UPDATE sponsor_media_assets SET deleted_at=clock_timestamp() WHERE id=$1',
          [assets[0].id]
        );
        assert.deepEqual(
          await service.executeApproveAll(input, actor),
          final.result,
          'the original receipt remains authoritative after later changes'
        );
      }
    );

    await t.test(
      'expiry prevents a first confirmation but preserves the exact confirmed operation for explicit idempotent resume',
      async (subtest) => {
        const unconfirmedId = await dossier();
        const unconfirmedAsset = await upload(unconfirmedId);
        const unconfirmedPlan = await prepare(unconfirmedId);
        const unconfirmedInput = execution(unconfirmedPlan);
        const resumedId = await dossier();
        const resumedAssets = [
          await upload(resumedId),
          await upload(resumedId)
        ];
        const resumedPlan = await prepare(resumedId);
        const resumedInput = execution(resumedPlan);
        const interruptedService = new SponsorMediaApproveAllService(
          pool,
          storage,
          {
            afterItemCommitted: () => {
              throw new Error(
                'Synthetic interruption after the first durable decision'
              );
            }
          }
        );
        const interrupted = await interruptedService.execute(
          resumedInput,
          actor
        );
        assert.equal(interrupted.status, 'in_progress');
        assert.equal(interrupted.summary.approved, 1);
        assert.equal(interrupted.summary.pending, 1);
        assert.equal(await n0(resumedAssets.map((asset) => asset.id)), 1);
        const expiredNow =
          Math.max(
            Date.parse(unconfirmedPlan.expiresAt),
            Date.parse(resumedPlan.expiresAt)
          ) + 1;
        const clock = subtest.mock.method(Date, 'now', () => expiredNow);
        try {
          await assert.rejects(
            service.executeApproveAll(unconfirmedInput, actor),
            { code: 'MEDIA_PLAN_EXPIRED' }
          );
          assert.equal(await n0([unconfirmedAsset.id]), 0);
          assert.equal(
            (
              await owner.query(
                'SELECT count(*)::int AS count FROM sponsor_media_workspace_commands WHERE contribution_id=$1 AND request_id=$2',
                [unconfirmedId, unconfirmedInput.requestId]
              )
            ).rows[0].count,
            0
          );
          assert.deepEqual(
            await service.approveAllReceipt(
              {
                contributionId: unconfirmedId,
                requestId: unconfirmedInput.requestId
              },
              actor
            ),
            { found: false }
          );
          assert.deepEqual(
            await service.approveAllReceipt(
              { contributionId: resumedId, requestId: resumedInput.requestId },
              actor
            ),
            { found: true, result: interrupted }
          );
          await assert.rejects(
            service.executeApproveAll(
              resumedInput,
              'admin:another-expired-resume-actor'
            ),
            (error) => error.status === 403
          );
          const completed = await service.executeApproveAll(
            resumedInput,
            actor
          );
          assert.equal(completed.status, 'completed');
          assert.equal(completed.summary.approved, 2);
          assert.equal(completed.summary.pending, 0);
          assert.equal(await n0(resumedAssets.map((asset) => asset.id)), 2);
          assert.deepEqual(
            await service.executeApproveAll(resumedInput, actor),
            completed
          );
          assert.equal(await n0(resumedAssets.map((asset) => asset.id)), 2);
        } finally {
          clock.mock.restore();
        }
      }
    );

    await t.test(
      'an interruption after the first item keeps its decision and receipt durable; explicit resume processes only the remainder',
      async () => {
        const id = await dossier();
        const assets = [await upload(id), await upload(id), await upload(id)];
        const plan = await prepare(id),
          input = execution(plan);
        let interrupted = false;
        const interrupting = new SponsorMediaApproveAllService(pool, storage, {
          afterItemCommitted: async (item) => {
            if (!interrupted && item.result === 'approved') {
              interrupted = true;
              throw new Error(
                'Synthetic process interruption after durable commit'
              );
            }
          }
        });
        const partial = await interrupting.execute(input, actor);
        assert.equal(partial.status, 'in_progress');
        assert.equal(partial.summary.approved, 1);
        assert.equal(partial.summary.pending, 2);
        assert.equal(await n0(assets.map((asset) => asset.id)), 1);
        const observed = await service.approveAllReceipt(
          { contributionId: id, requestId: input.requestId },
          actor
        );
        assert.deepEqual(observed, { found: true, result: partial });
        const resumed = await service.executeApproveAll(input, actor);
        assert.equal(resumed.status, 'completed');
        assert.equal(resumed.summary.approved, 3);
        assert.equal(resumed.summary.pending, 0);
        assert.equal(await n0(assets.map((asset) => asset.id)), 3);
        assert.deepEqual(
          await service.executeApproveAll(input, actor),
          resumed
        );
      }
    );

    await t.test(
      'an interruption after the last committed image still exposes a resumable finalization without repeating any decision',
      async () => {
        const id = await dossier();
        const assets = [await upload(id), await upload(id)];
        const plan = await prepare(id),
          input = execution(plan);
        let committed = 0;
        const interrupting = new SponsorMediaApproveAllService(pool, storage, {
          afterItemCommitted: async (item) => {
            if (item.result === 'approved' && ++committed === 2)
              throw new Error(
                'Synthetic interruption before the final receipt'
              );
          }
        });
        const interrupted = await interrupting.execute(input, actor);
        assert.equal(interrupted.status, 'in_progress');
        assert.equal(interrupted.summary.approved, 2);
        assert.equal(interrupted.summary.pending, 0);
        assert.deepEqual(
          await service.approveAllReceipt(
            { contributionId: id, requestId: input.requestId },
            actor
          ),
          { found: true, result: interrupted }
        );
        assert.equal(await n0(assets.map((asset) => asset.id)), 2);
        const finished = await service.executeApproveAll(input, actor);
        assert.equal(finished.status, 'completed');
        assert.equal(finished.summary.approved, 2);
        assert.equal(await n0(assets.map((asset) => asset.id)), 2);
      }
    );

    await t.test(
      'a database failure cannot roll back earlier successes or invent a refusal; resume remains idempotent after recovery',
      async () => {
        const id = await dossier();
        const prefix = randomUUID().slice(0, 24);
        const assets = [];
        for (const suffix of ['000000000001', '000000000002', '000000000003'])
          assets.push(await upload(id, { id: prefix + suffix }));
        const plan = await prepare(id),
          input = execution(plan);
        await owner.query(`CREATE FUNCTION synthetic_fail_approve_all_member() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.subject_type='media' AND NEW.subject_id='${assets[1].id}'::uuid AND NEW.level='N0' THEN
        RAISE EXCEPTION 'Synthetic storage failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_fail_approve_all_member BEFORE INSERT ON moderation_decisions
      FOR EACH ROW EXECUTE FUNCTION synthetic_fail_approve_all_member();`);
        let receipt;
        try {
          receipt = await service.executeApproveAll(input, actor);
          assert.equal(receipt.status, 'in_progress');
          assert.equal(receipt.summary.approved, 1);
          assert.equal(receipt.summary.pending, 2);
          assert.equal(receipt.summary.failed, 0);
          assert.equal(await n0(assets.map((asset) => asset.id)), 1);
          assert.equal(
            (await assetRow(assets[1].id)).review_status,
            'pending_review'
          );
        } finally {
          await owner.query(
            'DROP TRIGGER synthetic_fail_approve_all_member ON moderation_decisions; DROP FUNCTION synthetic_fail_approve_all_member();'
          );
        }
        const resumed = await service.executeApproveAll(input, actor);
        assert.equal(resumed.status, 'completed');
        assert.equal(resumed.summary.approved, 3);
        assert.equal(await n0(assets.map((asset) => asset.id)), 3);
      }
    );

    await t.test(
      'one hundred supporting images plus a logo are all represented and processed without the manual-selection cap',
      async () => {
        const id = await dossier();
        for (let index = 0; index < 100; index++) await upload(id);
        await upload(id, { kind: 'logo' });
        const plan = await prepare(id);
        assert.equal(plan.summary.total, 101);
        assert.equal(plan.summary.eligible, 101);
        assert.equal(plan.candidates.length, 101);
        assert.equal(
          plan.candidates.filter((candidate) => candidate.asset.kind === 'logo')
            .length,
          1
        );
        const receipt = await service.executeApproveAll(execution(plan), actor);
        assert.equal(receipt.status, 'completed');
        assert.equal(receipt.summary.approved, 101);
        assert.equal(receipt.items.length, 101);
        assert.equal(
          await n0(plan.candidates.map((candidate) => candidate.asset.id)),
          101
        );
      }
    );
  }
);
