import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { lockModerationDependencies } from '../../dist/apps/funding-api/src/moderation/content.js';
import { recordRemoteRemovalRequirement } from '../../dist/apps/funding-api/src/moderation/governance.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  getModerationContent,
  recordModerationDecision
} from '../../dist/apps/funding-api/src/moderation/repository.js';
import { updateSponsorshipReview } from '../../dist/apps/funding-api/src/sponsorship-decisions.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/public-sponsorships.repository.js';
import {
  reviewSponsorMediaAsset,
  updateSponsorMediaMetadata
} from '../../dist/apps/funding-api/src/sponsor-media/persistence-write.js';
import { updateAdminPublicationDraft } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { publishAdminPublicationBatch } from '../../dist/apps/funding-api/src/fund-publication-batches.repository.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';

const actor = 'admin:00000000-0000-4000-8000-000000000003';
const subject = (type, id) => ({ type, id });

test(
  'legacy approvals and deferred publication require current moderation on PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const { pool } = database;
    const transact = (operation) => withPostgresTransaction(pool, operation);
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
    })
      .webp()
      .toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map();
    const reads = [];
    const storage = {
      readPrivateObject: async (key) => {
        reads.push(key);
        return objects.get(key) ?? null;
      }
    };
    const service = new PublicationAutomationService(pool, storage, {
      SOCIAL_PUBLICATION_MODE: 'mock',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true'
    });
    const feedId = 'openg20:facebook';
    let future;
    let due;
    const originalWorkerSettings = service.workerSettings.bind(service);

    async function reset() {
      service.workerSettings = originalWorkerSettings;
      await pool.query(
        'TRUNCATE moderation_cases,fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',account_fingerprint=NULL,last_prepared_at=NULL,capacity=5,horizon_days=14"
      );
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=NULL,version=1'
      );
      objects.clear();
      reads.length = 0;
      future = new Date(Date.now() + 60000).toISOString();
      due = new Date(Date.now() + 120000);
      await service.command({ action: 'check', feedId }, actor);
      const feed = (await service.state()).feeds.find(
        (entry) => entry.id === feedId
      );
      await service.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        actor
      );
    }

    async function decision(target, level = 'N0', extra = {}) {
      const content = await transact((db) => getModerationContent(db, target));
      return {
        requestId: randomUUID(),
        policyVersion: '1.0',
        contentVersion: content.contentVersion,
        contentFingerprint: content.fingerprint,
        expectedDecisionId: content.currentDecisionId,
        confirmation: target.id,
        level,
        ...(level === 'N0'
          ? {}
          : {
              primaryReason: 'MISLEADING_CLAIM',
              internalReason: 'Synthetic evidence',
              sponsorExplanation: 'Please document the claim.'
            }),
        ...extra
      };
    }
    const record = async (target, level = 'N0', extra = {}) => {
      const input = await decision(target, level, extra);
      return transact((db) =>
        recordModerationDecision(db, {
          subject: target,
          decision: input,
          actor
        })
      );
    };
    const row = async (table, id) => {
      const current = (
        await pool.query(
          `SELECT *,updated_at::text AS timestamp_version FROM ${table} WHERE id=$1`,
          [id]
        )
      ).rows[0];
      return current
        ? { ...current, version: current.version ?? current.timestamp_version }
        : null;
    };
    const version = async (table, id) => (await row(table, id)).version;

    async function fixture({
      sponsorApproval = true,
      mediaApproval = true,
      format = 'collective_text'
    } = {}) {
      await reset();
      const sponsorId = randomUUID();
      const mediaId = randomUUID();
      const draftId = randomUUID();
      const batchId = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels) VALUES($1,'sponsorship_interest',25000,'cad','paid',TRUE,'approved','Synthetic workshop','Approved synthetic summary','openg20','["facebook"]')`,
        [sponsorId]
      );
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text,public_url,usage_rights) VALUES($1::uuid,$2,'supporting_image','approved','synthetic.webp','image/webp',$3,$1::uuid::text||'/original',$3,$1::uuid::text||'/processed',$4,2,2,'Synthetic approved image','https://example.test/synthetic.webp',
        '{"state":"confirmed","channels":["website","facebook","linkedin"],"targets":["openg7","openg20"],"transformations":["technical","portrait","composite"],"credit":null,"restrictions":null}')`,
        [mediaId, sponsorId, bytes.length, hash]
      );
      objects.set(`${mediaId}/processed`, bytes);
      await recordFixtureSponsorshipAgreement(pool, sponsorId, {
        benefits: [
          { channel: 'website', target: 'openg7', quantity: 1 },
          { channel: 'facebook', target: 'openg20', quantity: 1, format }
        ]
      });
      await pool.query(
        "INSERT INTO sponsor_publication_batches(id,channel,capacity,status,scheduled_at) VALUES($1,'facebook',1,'scheduled',$2)",
        [batchId, future]
      );
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,batch_id,status,scheduled_at) VALUES($1,$2,'openg20','facebook','Synthetic title','Synthetic sponsor body','Sponsored',$3,'scheduled',$4)`,
        [draftId, sponsorId, batchId, future]
      );
      if (sponsorApproval) await record(subject('sponsorship', sponsorId));
      if (mediaApproval) await record(subject('media', mediaId));
      return { sponsorId, mediaId, draftId, batchId, format };
    }

    async function compose(f) {
      const draft = await row('sponsor_publication_drafts', f.draftId);
      const message = composePublicationRecognition([
        {
          id: draft.id,
          contributionId: f.sponsorId,
          name: 'Synthetic workshop',
          title: draft.title,
          body: draft.body,
          disclosureText: draft.disclosure_text
        }
      ]);
      return (
        await service.command(
          {
            action: 'compose',
            feedId,
            kind: 'sponsorship',
            batchId: f.batchId,
            message,
            scheduledAt: future,
            mediaId: f.format === 'collective_text' ? f.mediaId : null,
            publicationFormat: f.format,
            photoSelections:
              f.format === 'collective_text'
                ? []
                : [
                    {
                      contributionId: f.sponsorId,
                      assetId: f.mediaId,
                      assetVersion: await version(
                        'sponsor_media_assets',
                        f.mediaId
                      )
                    }
                  ]
          },
          actor
        )
      ).id;
    }
    async function approveDelivery(id) {
      await record(subject('publication_delivery', id));
      const delivery = await row('publication_deliveries', id);
      await service.command(
        { action: 'approve', id, version: delivery.version, confirmation: id },
        actor
      );
      reads.length = 0;
    }
    const editorialEvidence = async (id) =>
      (
        await pool.query(
          `SELECT c.current_content_version, c.current_fingerprint, d.content_version AS decision_content_version,
          d.content_fingerprint AS decision_fingerprint
         FROM moderation_cases c JOIN moderation_decisions d ON d.id=c.current_decision_id
         WHERE c.subject_type='publication_delivery' AND c.subject_id=$1`,
          [id]
        )
      ).rows[0];
    async function assertNotPublished(id) {
      const delivery = await row('publication_deliveries', id);
      assert.equal(delivery.status, 'blocked');
      assert.equal(delivery.approved_at, null);
      assert.equal(delivery.external_post_id, null);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.published'",
            [id]
          )
        ).rows[0].count,
        0
      );
      return delivery;
    }

    async function inactivePhotoCopy(id, f) {
      const historicalId = randomUUID();
      // An explicit synthetic historical copy tests removal qualification only;
      // it creates no financial fulfilment evidence or provider request.
      await pool.query(
        `INSERT INTO publication_deliveries(id,feed_id,kind,message,scheduled_at,account_id,mode,status,external_post_id,published_at)
        SELECT $1,feed_id,'news','Synthetic inactive historical copy',scheduled_at,account_id,mode,'published','mock-historical-inactive-copy',clock_timestamp()
        FROM publication_deliveries WHERE id=$2`,
        [historicalId, id]
      );
      await pool.query(
        `INSERT INTO publication_delivery_photos(delivery_id,contribution_id,asset_id,asset_version,active)
        VALUES($1,$2,$3,$4,FALSE)`,
        [
          historicalId,
          f.sponsorId,
          f.mediaId,
          await version('sponsor_media_assets', f.mediaId)
        ]
      );
      return historicalId;
    }

    await t.test(
      'media dependency locks include active derived deliveries and exclude inactive historical selections',
      async () => {
        const f = await fixture({ format: 'individual_portrait' });
        const id = await compose(f);
        const historicalId = await inactivePhotoCopy(id, f);
        const lock = await pool.connect();
        const contender = await pool.connect();
        try {
          await lock.query('BEGIN');
          await lockModerationDependencies(lock, subject('media', f.mediaId));
          await contender.query('BEGIN');
          await contender.query("SET LOCAL lock_timeout='100ms'");
          await assert.rejects(
            contender.query(
              'SELECT id FROM publication_deliveries WHERE id=$1 FOR UPDATE',
              [id]
            ),
            { code: '55P03' }
          );
          await contender.query('ROLLBACK');
          await contender.query('BEGIN');
          await contender.query("SET LOCAL lock_timeout='100ms'");
          assert.equal(
            (
              await contender.query(
                'SELECT id FROM publication_deliveries WHERE id=$1 FOR UPDATE',
                [historicalId]
              )
            ).rowCount,
            1
          );
          await contender.query('ROLLBACK');
          await lock.query('ROLLBACK');
        } finally {
          await contender.query('ROLLBACK');
          await lock.query('ROLLBACK');
          contender.release();
          lock.release();
        }
      }
    );

    for (const change of ['hold', 'usage-withdrawal']) {
      await t.test(
        `a derived photograph ${change} revokes its approved render before dispatch`,
        async () => {
          const f = await fixture({ format: 'individual_portrait' });
          const id = await compose(f);
          assert.equal(
            (await row('publication_deliveries', id)).media_id,
            null
          );
          await approveDelivery(id);
          let changed = false;
          service.workerSettings = async (db, lock) => {
            if (!db && reads.length > 0 && !changed) {
              changed = true;
              if (change === 'hold')
                await record(subject('media', f.mediaId), 'N2');
              else
                await updateSponsorMediaUsage(pool, {
                  contributionId: f.sponsorId,
                  assetId: f.mediaId,
                  requestId: randomUUID(),
                  expectedVersion: await version(
                    'sponsor_media_assets',
                    f.mediaId
                  ),
                  actor: 'sponsor-followup',
                  usage: {
                    state: 'withdrawn',
                    channels: [],
                    targets: [],
                    transformations: [],
                    credit: null,
                    restrictions: null
                  }
                });
            }
            return originalWorkerSettings(db, lock);
          };
          await service.tick(due);
          assert.equal(changed, true);
          assert.equal(
            (await assertNotPublished(id)).error_code,
            'MODERATION_RESTRICTED'
          );
          assert.ok(reads.length > 0);
          assert.equal(
            (await row('fund_contributions', f.sponsorId)).status,
            'paid'
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1',
                [id]
              )
            ).rows[0].n,
            0
          );
        }
      );
    }

    await t.test(
      'an active media N5 records a derived remote removal requirement once without selecting an inactive historical copy',
      async () => {
        const f = await fixture({ format: 'individual_portrait' });
        const id = await compose(f);
        const historicalId = await inactivePhotoCopy(id, f);
        await pool.query(
          "UPDATE publication_deliveries SET status='published',external_post_id='mock-historical-derived-copy',published_at=clock_timestamp() WHERE id=$1",
          [id]
        );
        const removal = await record(subject('media', f.mediaId), 'N5', {
          primaryReason: 'IP_RIGHTS'
        });
        assert.equal(removal.state, 'active');
        await transact((db) => recordRemoteRemovalRequirement(db, removal));
        const requirements = (
          await pool.query(
            'SELECT delivery_id,status FROM moderation_remote_removals WHERE decision_id=$1 ORDER BY delivery_id',
            [removal.id]
          )
        ).rows;
        assert.deepEqual(requirements, [
          { delivery_id: id, status: 'not_supported' }
        ]);
        assert.equal(
          (await row('publication_deliveries', id)).status,
          'published'
        );
        assert.equal(
          (await row('publication_deliveries', historicalId)).error_code,
          null
        );
        assert.equal(
          (await row('fund_contributions', f.sponsorId)).status,
          'paid'
        );
      }
    );

    await t.test(
      'historical dossier approval cannot bypass a missing N0; explicit N0 remains separate from site visibility',
      async () => {
        const f = await fixture({ sponsorApproval: false });
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='pending_review' WHERE id=$1",
          [f.sponsorId]
        );
        const before = await row('fund_contributions', f.sponsorId);
        const input = {
          contributionId: f.sponsorId,
          expectedVersion: before.version,
          reviewStatus: 'approved',
          reviewNote: null,
          actor,
          confirmation: f.sponsorId
        };
        await assert.rejects(updateSponsorshipReview(pool, input), {
          code: 'MODERATION_DECISION_REQUIRED'
        });
        assert.deepEqual(await row('fund_contributions', f.sponsorId), before);
        const result = await updateSponsorshipReview(pool, {
          ...input,
          moderationDecision: await decision(
            subject('sponsorship', f.sponsorId)
          )
        });
        assert.equal(result.updated, true);
        assert.equal(result.reviewStatus, 'approved');
        const after = await row('fund_contributions', f.sponsorId);
        assert.equal(after.sponsor_site_visibility_held, true);
        assert.equal(after.status, 'paid');
        assert.equal(after.amount_cents, 25000);
      }
    );

    await t.test(
      'a severe dossier refusal stays pending independent review and does not apply a final rejection',
      async () => {
        const f = await fixture();
        const input = await decision(
          subject('sponsorship', f.sponsorId),
          'N4',
          { primaryReason: 'THREAT' }
        );
        const result = await updateSponsorshipReview(pool, {
          contributionId: f.sponsorId,
          expectedVersion: await version('fund_contributions', f.sponsorId),
          reviewStatus: 'rejected',
          reviewNote: null,
          actor,
          confirmation: f.sponsorId,
          moderationDecision: input
        });
        assert.equal(result.decisionState, 'pending_independent_review');
        assert.notEqual(result.reviewStatus, 'rejected');
        const after = await row('fund_contributions', f.sponsorId);
        assert.equal(after.sponsor_site_visibility_held, true);
        assert.equal(after.status, 'paid');
        assert.equal(after.amount_cents, 25000);
      }
    );

    await t.test(
      'media edits are staged before review and invalidate an older exact approval',
      async () => {
        const f = await fixture();
        const before = await row('sponsor_media_assets', f.mediaId);
        const review = {
          assetId: f.mediaId,
          expectedVersion: before.version,
          reviewStatus: 'approved',
          altText: 'Edited synthetic image',
          publicStorageKey: null,
          publicUrl: `/api/public/sponsor-media/${f.mediaId}`,
          reviewedBy: actor,
          confirmation: f.mediaId
        };
        await assert.rejects(reviewSponsorMediaAsset(pool, review), {
          code: 'MODERATION_CONTENT_CHANGED'
        });
        assert.deepEqual(await row('sponsor_media_assets', f.mediaId), before);
        const changed = await updateSponsorMediaMetadata(pool, {
          assetId: f.mediaId,
          expectedVersion: before.version,
          confirmation: f.mediaId,
          altText: review.altText,
          actor
        });
        assert.equal(changed.status, 'updated');
        assert.equal(changed.asset.reviewStatus, 'pending_review');
        await assert.rejects(
          reviewSponsorMediaAsset(pool, {
            ...review,
            expectedVersion: await version('sponsor_media_assets', f.mediaId)
          }),
          { code: 'MODERATION_RESTRICTED' }
        );
        const accepted = await reviewSponsorMediaAsset(pool, {
          ...review,
          expectedVersion: await version('sponsor_media_assets', f.mediaId),
          moderationDecision: await decision(subject('media', f.mediaId))
        });
        assert.equal(accepted.status, 'updated');
        assert.equal(accepted.asset.reviewStatus, 'approved');
        assert.deepEqual(reads, []);
      }
    );

    await t.test(
      'a concurrent media edit cannot deadlock website authorization or retain public visibility after its commit',
      async () => {
        const f = await fixture();
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE WHERE id=$1',
          [f.sponsorId]
        );
        const sponsor = await row('fund_contributions', f.sponsorId);
        const media = await row('sponsor_media_assets', f.mediaId);
        const locked = Promise.withResolvers();
        const mediaStarted = Promise.withResolvers();
        const waiting = (promise) =>
          Promise.race([
            promise,
            new Promise((_, reject) => {
              const timer = setTimeout(
                () =>
                  reject(new Error('Synthetic concurrency barrier timed out')),
                5000
              );
              timer.unref();
            })
          ]);
        const observedPool = (observe) => ({
          query: pool.query.bind(pool),
          async connect() {
            const client = await pool.connect();
            return {
              async query(sql, values) {
                await observe(sql, 'before');
                const result = await client.query(sql, values);
                if (sql === 'BEGIN')
                  await client.query("SET LOCAL lock_timeout='5s'");
                await observe(sql, 'after');
                return result;
              },
              release: () => client.release()
            };
          }
        });
        const websitePool = observedPool(async (sql, phase) => {
          if (
            phase === 'after' &&
            sql.includes('FROM fund_contributions') &&
            sql.includes('FOR UPDATE')
          ) {
            locked.resolve();
            await waiting(mediaStarted.promise);
          }
        });
        const mediaPool = observedPool(async (sql, phase) => {
          if (phase === 'before' && sql.includes('UPDATE sponsor_media_assets'))
            mediaStarted.resolve();
        });
        const visibility = setSponsorshipWebsiteVisibility(
          websitePool,
          {
            contributionId: f.sponsorId,
            expectedVersion: sponsor.version,
            visible: true,
            confirmed: true
          },
          actor,
          storage
        );
        await waiting(locked.promise);
        const edit = updateSponsorMediaMetadata(mediaPool, {
          assetId: f.mediaId,
          expectedVersion: media.version,
          confirmation: f.mediaId,
          altText: 'Synthetic changed description',
          actor
        });
        const results = await Promise.allSettled([visibility, edit]);
        for (const result of results)
          assert.equal(
            result.status,
            'fulfilled',
            result.status === 'rejected' ? String(result.reason) : undefined
          );
        assert.equal(results[0].value, 'updated');
        assert.equal(results[1].value.status, 'updated');
        assert.deepEqual((await listPublicSponsorships(pool)).sponsorships, []);
        const after = await row('fund_contributions', f.sponsorId);
        assert.equal(after.status, 'paid');
        assert.equal(after.amount_cents, 25000);
      }
    );

    await t.test(
      'a legacy draft approval and a manual batch publication cannot write without their editorial decisions',
      async () => {
        const f = await fixture();
        const before = await row('sponsor_publication_drafts', f.draftId);
        await assert.rejects(
          updateAdminPublicationDraft(
            pool,
            { draftId: f.draftId, status: 'approved', confirmation: f.draftId },
            actor
          ),
          { code: 'MODERATION_DECISION_REQUIRED' }
        );
        assert.deepEqual(
          await row('sponsor_publication_drafts', f.draftId),
          before
        );
        const batchBefore = await row('sponsor_publication_batches', f.batchId);
        await assert.rejects(
          publishAdminPublicationBatch(pool, {
            batchId: f.batchId,
            confirmation: f.batchId
          }),
          { code: 'MODERATION_DECISION_REQUIRED' }
        );
        assert.deepEqual(
          await row('sponsor_publication_batches', f.batchId),
          batchBefore
        );
        await record(subject('publication_draft', f.draftId));
        assert.equal(
          (
            await updateAdminPublicationDraft(
              pool,
              {
                draftId: f.draftId,
                status: 'approved',
                confirmation: f.draftId
              },
              actor
            )
          ).updated,
          true
        );
        assert.equal(
          (
            await publishAdminPublicationBatch(pool, {
              batchId: f.batchId,
              confirmation: f.batchId
            })
          ).updated,
          true
        );
        assert.equal(
          (await row('sponsor_publication_drafts', f.draftId)).status,
          'published'
        );
      }
    );

    await t.test(
      'a structured refusal of the final render rejects only the delivery and keeps the sponsor payment and review intact',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        const current = await row('publication_deliveries', id);
        const moderationDecision = await decision(
          subject('publication_delivery', id),
          'N3'
        );
        reads.length = 0;
        await service.command(
          {
            action: 'reject',
            id,
            version: current.version,
            confirmation: id,
            moderationDecision
          },
          actor
        );
        const rejected = await row('publication_deliveries', id);
        assert.equal(rejected.status, 'rejected');
        assert.equal(rejected.approved_at, null);
        const sponsor = await row('fund_contributions', f.sponsorId);
        assert.equal(sponsor.sponsor_review_status, 'approved');
        assert.equal(sponsor.status, 'paid');
        assert.equal(sponsor.amount_cents, 25000);
        assert.deepEqual(reads, []);
      }
    );

    await t.test(
      'a legacy refusal validates source edits first, then revokes an approved delivery and records only its structured reason',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        await approveDelivery(id);
        const before = await row('sponsor_publication_drafts', f.draftId);
        const moderationDecision = await decision(
          subject('publication_draft', f.draftId),
          'N3'
        );
        const input = {
          draftId: f.draftId,
          status: 'rejected',
          confirmation: f.draftId,
          moderationDecision
        };
        for (const changes of [
          { title: 'Another title' },
          { body: 'Another message' },
          { disclosureText: 'Another disclosure' },
          { publicUrl: 'https://example.test/another-result' },
          { scheduledAt: new Date(due.getTime() + 60000).toISOString() }
        ]) {
          await assert.rejects(
            updateAdminPublicationDraft(pool, { ...input, ...changes }, actor),
            { code: 'MODERATION_CONTENT_CHANGED' }
          );
          assert.deepEqual(
            await row('sponsor_publication_drafts', f.draftId),
            before
          );
        }
        assert.equal(
          (await row('publication_deliveries', id)).status,
          'approved'
        );
        assert.equal(
          (
            await pool.query(
              "SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE subject_type='publication_draft' AND subject_id=$1",
              [f.draftId]
            )
          ).rows[0].count,
          0
        );
        const result = await updateAdminPublicationDraft(
          pool,
          {
            ...input,
            reviewNote: 'Legacy note must not replace the structured reason'
          },
          actor
        );
        assert.equal(result.updated, true);
        assert.equal(result.draft.status, 'rejected');
        assert.equal(result.draft.review_note, null);
        assert.equal(
          (await assertNotPublished(id)).error_code,
          'MODERATION_RESTRICTED'
        );
        const stored = (
          await pool.query(
            'SELECT internal_reason FROM moderation_decisions WHERE request_id=$1',
            [moderationDecision.requestId]
          )
        ).rows[0];
        assert.equal(stored.internal_reason, moderationDecision.internalReason);
        assert.equal(
          (await row('fund_contributions', f.sponsorId)).status,
          'paid'
        );
      }
    );

    await t.test(
      'an old approved job without a render decision is blocked before reading its media',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        reads.length = 0;
        await pool.query(
          "UPDATE publication_deliveries SET status='approved',approved_at=NOW(),approved_by=$2 WHERE id=$1",
          [id, actor]
        );
        await service.tick(due);
        assert.equal(
          (await assertNotPublished(id)).error_code,
          'MODERATION_DECISION_REQUIRED'
        );
        assert.deepEqual(reads, []);
      }
    );

    await t.test(
      'current render, dossier and media N0 decisions permit a separately approved simulated publication',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        const unseenDraft = await transact((db) =>
          getModerationContent(db, subject('publication_draft', f.draftId))
        );
        assert.equal(
          unseenDraft.currentDecisionId,
          null,
          'inspecting a draft alone does not impose an extra editorial approval'
        );
        await approveDelivery(id);
        const evidence = await editorialEvidence(id);
        const before = await row('publication_deliveries', id);
        await service.tick(due);
        const delivery = await row('publication_deliveries', id);
        assert.equal(delivery.status, 'published');
        assert.equal(delivery.attempts, before.attempts + 1);
        assert.ok(
          delivery.version > before.version,
          'the actual worker claim advances only its operational version'
        );
        assert.deepEqual(
          await editorialEvidence(id),
          evidence,
          'claim and completion preserve the N0 content version and fingerprint'
        );
        assert.equal(delivery.external_post_id, `mock-${id}`);
        assert.ok(reads.length > 0);
        assert.deepEqual([...new Set(reads)], [`${f.mediaId}/processed`]);
        // Simulation records the delivery; it never marks a real sponsorship published.
        assert.equal(
          (await row('sponsor_publication_batches', f.batchId)).status,
          'scheduled'
        );
      }
    );

    await t.test(
      'a media restriction committed after preflight is enforced before the dispatch callback',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        await approveDelivery(id);
        let restricted = false;
        service.workerSettings = async (db, lock) => {
          // This no-client call happens after the preflight transaction released
          // its delivery lock and before sendDelivery invokes assertActive.
          if (!db && reads.length > 0 && !restricted) {
            restricted = true;
            await record(subject('media', f.mediaId), 'N3');
          }
          return originalWorkerSettings(db, lock);
        };
        await service.tick(due);
        assert.equal(restricted, true);
        assert.equal(
          (await assertNotPublished(id)).error_code,
          'MODERATION_RESTRICTED'
        );
        assert.ok(reads.length > 0);
        assert.deepEqual([...new Set(reads)], [`${f.mediaId}/processed`]);
      }
    );

    for (const [level, attenuated] of [
      ['N2', false],
      ['N3', false],
      ['N2', true]
    ]) {
      await t.test(
        `a source draft ${level}${attenuated ? ' then N0' : ''} committed after preflight blocks the previous dispatch authorization`,
        async () => {
          const f = await fixture();
          const id = await compose(f);
          await approveDelivery(id);
          const evidence = await editorialEvidence(id);
          let restricted = false;
          let restrictionErrorCode = null;
          service.workerSettings = async (db, lock) => {
            if (!db && reads.length > 0 && !restricted) {
              restricted = true;
              try {
                if (level === 'N3') {
                  const result = await updateAdminPublicationDraft(
                    pool,
                    {
                      draftId: f.draftId,
                      status: 'rejected',
                      confirmation: f.draftId,
                      reviewNote:
                        'Legacy note must not replace the structured reason',
                      moderationDecision: await decision(
                        subject('publication_draft', f.draftId),
                        'N3'
                      )
                    },
                    actor
                  );
                  assert.equal(result.updated, true);
                  assert.equal(result.draft.review_note, null);
                } else
                  await record(subject('publication_draft', f.draftId), level);
                if (level === 'N3') {
                  const beforeEdit = await row(
                    'sponsor_publication_drafts',
                    f.draftId
                  );
                  for (const assignment of [
                    "title=title||' forbidden edit'",
                    "body=body||' forbidden edit'",
                    "scheduled_at=scheduled_at+INTERVAL '1 day'"
                  ]) {
                    await assert.rejects(
                      pool.query(
                        `UPDATE sponsor_publication_drafts SET ${assignment} WHERE id=$1`,
                        [f.draftId]
                      ),
                      { code: '55000' }
                    );
                    assert.deepEqual(
                      await row('sponsor_publication_drafts', f.draftId),
                      beforeEdit
                    );
                  }
                }
                if (attenuated)
                  await record(subject('publication_draft', f.draftId));
              } catch (error) {
                restrictionErrorCode = error.code;
                throw error;
              }
            }
            return originalWorkerSettings(db, lock);
          };
          await service.tick(due);
          assert.equal(restricted, true);
          assert.equal(
            restrictionErrorCode,
            null,
            'the adverse decision must commit; a worker exception is not a moderation restriction'
          );
          assert.equal(
            (await assertNotPublished(id)).error_code,
            'MODERATION_RESTRICTED'
          );
          assert.deepEqual(await editorialEvidence(id), evidence);
          assert.equal(
            (await row('sponsor_publication_drafts', f.draftId)).status,
            level === 'N2' ? 'scheduled' : 'rejected'
          );
          const sponsor = await row('fund_contributions', f.sponsorId);
          assert.equal(sponsor.sponsor_review_status, 'approved');
          assert.equal(sponsor.status, 'paid');
        }
      );
    }

    await t.test(
      'a legacy approved job without a restriction flag still obeys its source draft hold before reading media',
      async () => {
        const f = await fixture();
        const id = await compose(f);
        await approveDelivery(id);
        const evidence = await editorialEvidence(id);
        await record(subject('publication_draft', f.draftId), 'N2');
        await pool.query(
          "UPDATE publication_deliveries SET status='approved',approved_at=NOW(),approved_by=$2,error_code=NULL WHERE id=$1",
          [id, actor]
        );
        reads.length = 0;
        await service.tick(due);
        assert.equal(
          (await assertNotPublished(id)).error_code,
          'MODERATION_RESTRICTED'
        );
        assert.deepEqual(await editorialEvidence(id), evidence);
        assert.equal(
          (await row('sponsor_publication_drafts', f.draftId)).status,
          'scheduled'
        );
        assert.deepEqual(reads, []);
      }
    );
  }
);
