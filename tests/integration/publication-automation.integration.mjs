import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { waitForFixtureAccountCooldown } from './support/publication-account-cooldown-fixture.mjs';
import {
  approveFixtureSubject,
  fixtureModerationDecision
} from './support/moderation-fixture.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { sources } from '../../dist/apps/funding-api/src/publication-automation/sources.js';
import { mediaRecord } from '../../dist/apps/funding-api/src/publication-automation/media.js';
import { markSocialPublicationJobPublishing } from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import {
  listPublicSponsorships,
  recordSponsorshipDetailsForContribution,
  updateSponsorshipPublication
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { listPublicBuilders } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import {
  deleteSponsorMediaAsset,
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  reviewSponsorMediaAsset
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import {
  saveSponsorshipDraft,
  submitSponsorshipDraft
} from '../../dist/apps/funding-api/src/sponsorship-access.service.js';

test(
  'publication automation with disposable PostgreSQL',
  { timeout: 240000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    let imageBytes = null;
    const storage = { readPrivateObject: async () => imageBytes };
    const env = {
      SOCIAL_PUBLICATION_MODE: 'mock',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true'
    };
    const service = new PublicationAutomationService(pool, storage, env);
    const feedId = 'openg20:facebook';
    let future;
    let due;
    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',account_fingerprint=NULL,last_prepared_at=NULL,capacity=5,horizon_days=14"
      );
      env.SOCIAL_PUBLICATION_MODE = 'mock';
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=NULL,version=1'
      );
      const scenarioStartedAt = Date.now();
      future = new Date(scenarioStartedAt + 60000).toISOString();
      due = new Date(scenarioStartedAt + 120000);
    }
    async function activate(s = service) {
      await s.command({ action: 'check', feedId }, 'tester');
      const feed = (await s.state()).feeds.find((f) => f.id === feedId);
      await s.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        'tester'
      );
    }
    async function compose(s = service) {
      return (
        await s.command(
          {
            action: 'compose',
            feedId,
            kind: 'news',
            message: 'Exact approved message',
            scheduledAt: future
          },
          'tester'
        )
      ).id;
    }
    async function approve(id, s = service) {
      const j = (await s.state()).deliveries.find((j) => j.id === id);
      await s.command(
        {
          action: 'approve',
          id,
          version: j.version,
          confirmation: id,
          moderationDecision: await fixtureModerationDecision(pool, {
            type: 'publication_delivery',
            id
          })
        },
        'tester'
      );
    }
    async function record(id) {
      return (await service.state()).deliveries.find((j) => j.id === id);
    }
    async function sponsorshipMessage(batchId, prefix = '') {
      const sources = (
        await pool.query(
          `SELECT d.id,d.contribution_id AS "contributionId",c.sponsor_company_name AS name,d.title,d.body,d.disclosure_text AS "disclosureText"
        FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1 ORDER BY d.id`,
          [batchId]
        )
      ).rows;
      return [prefix, composePublicationRecognition(sources)]
        .filter(Boolean)
        .join('\n\n');
    }
    async function sponsor({ reviewed = true, agreement = true } = {}) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels) VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved','Fixture sponsor','Approved public summary','openg20','["facebook"]')`,
        [id]
      );
      if (agreement)
        await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'facebook',
          target: 'openg20'
        });
      if (reviewed)
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    }
    async function presentation(contributionId) {
      const id = randomUUID();
      const bytes =
        imageBytes ??
        (await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
        })
          .webp()
          .toBuffer());
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text,usage_rights) VALUES($1,$2,'supporting_image','approved','fixture.webp','image/webp',$7,$3,$7,$4,$5,'https://example.test/image.webp',$6,2,2,'Approved image',
        '{"state":"confirmed","channels":["website","facebook","linkedin"],"targets":["openg7","openg20"],"transformations":["technical"],"credit":null,"restrictions":null}')`,
        [
          id,
          contributionId,
          `${id}/original`,
          `${id}/processed`,
          `${id}/public`,
          createHash('sha256').update(bytes).digest('hex'),
          bytes.length
        ]
      );
      await approveFixtureSubject(pool, { type: 'media', id });
      return id;
    }
    async function pendingProposal() {
      const contributionId = await sponsor();
      await pool.query(
        "UPDATE fund_contributions SET sponsor_review_status='pending_review' WHERE id=$1",
        [contributionId]
      );
      await service.prepare(feedId, 'planner');
      const job = (await service.state()).deliveries.find(
        (j) => j.status === 'draft'
      );
      return { contributionId, job };
    }
    async function combinedApproval(job) {
      return {
        action: 'approve',
        id: job.id,
        version: job.version,
        confirmation: job.id,
        moderationDecision: await fixtureModerationDecision(pool, {
          type: 'publication_delivery',
          id: job.id
        }),
        approveSponsors: await Promise.all(
          job.sponsors.map(async ({ id, version }) => ({
            id,
            version,
            moderationDecision: await fixtureModerationDecision(pool, {
              type: 'sponsorship',
              id
            })
          }))
        )
      };
    }
    await t.test(
      'explicit recorded agreements and consent restrict preparation independently of legacy routing fields',
      async () => {
        await reset();
        const cases = [
          { amount: 10000, channels: [] },
          { amount: 24999, channels: [] },
          { amount: 25000, channels: ['facebook'] },
          { amount: 49999, channels: ['facebook'] },
          { amount: 50000, channels: ['facebook', 'linkedin'] },
          { amount: 25000, consent: false, channels: [] },
          { amount: 50000, currency: 'usd', channels: [] },
          { amount: 10000, explicit: ['linkedin'], channels: ['linkedin'] }
        ];
        for (const review of ['pending_review', 'approved']) {
          await reset();
          const sponsors = [];
          for (const example of cases) {
            const id = randomUUID();
            await pool.query(
              `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_channels)
               VALUES($1,'sponsorship_interest',$2,$3,'paid',$4,$5,'Tier boundary fixture',$6::jsonb)`,
              [
                id,
                example.amount,
                example.currency ?? 'cad',
                example.consent ?? true,
                review,
                JSON.stringify(example.explicit ?? [])
              ]
            );
            if (example.currency !== 'usd')
              await recordFixtureSponsorshipAgreement(pool, id, {
                channels: ['website', ...example.channels]
              });
            sponsors.push({ id, channels: example.channels });
          }
          for (const channel of ['facebook', 'linkedin']) {
            await service.prepare(`openg7:${channel}`, 'tier-test');
            // A repeat must not multiply the source drafts or grant approval.
            await service.prepare(`openg7:${channel}`, 'tier-test');
            const drafts = (
              await pool.query(
                'SELECT contribution_id,status FROM sponsor_publication_drafts WHERE channel=$1 ORDER BY contribution_id',
                [channel]
              )
            ).rows;
            assert.deepEqual(
              drafts.map((d) => d.contribution_id),
              sponsors
                .filter((s) => s.channels.includes(channel))
                .map((s) => s.id)
                .sort()
            );
            assert(drafts.every((d) => d.status === 'draft'));
          }
          assert(
            (await service.state()).deliveries.every(
              (d) =>
                d.status === 'draft' &&
                d.approvedAt === null &&
                d.attempts === 0
            )
          );
        }
      }
    );
    await t.test(
      'extracted source and media reads hold real row locks until their caller ends the transaction',
      async () => {
        await reset();
        await activate();
        const contributionId = await sponsor();
        const mediaId = await presentation(contributionId);
        await service.prepare(feedId, 'planner');
        const job = (await service.state()).deliveries[0];
        const draftId = (
          await pool.query(
            'SELECT id FROM sponsor_publication_drafts WHERE batch_id=$1',
            [job.batchId]
          )
        ).rows[0].id;
        const contributionUpdate = {
          sql: 'UPDATE fund_contributions SET sponsor_company_name=sponsor_company_name WHERE id=$1',
          id: contributionId
        };
        const cases = [
          {
            read: (db) => sources(db, job.batchId, feedId, true),
            writes: [
              {
                sql: 'UPDATE sponsor_publication_batches SET capacity=capacity WHERE id=$1',
                id: job.batchId
              },
              {
                sql: 'UPDATE sponsor_publication_drafts SET title=title WHERE id=$1',
                id: draftId
              },
              contributionUpdate
            ]
          },
          {
            read: (db) => mediaRecord(db, mediaId),
            writes: [
              {
                sql: 'UPDATE sponsor_media_assets SET alt_text=alt_text WHERE id=$1',
                id: mediaId
              },
              contributionUpdate
            ]
          }
        ];
        for (const scenario of cases) {
          const holder = await pool.connect();
          const writer = await pool.connect();
          try {
            await holder.query('BEGIN');
            await scenario.read(holder);
            for (const write of scenario.writes) {
              await writer.query('BEGIN');
              await writer.query("SET LOCAL lock_timeout='150ms'");
              await assert.rejects(writer.query(write.sql, [write.id]), {
                code: '55P03'
              });
              await writer.query('ROLLBACK');
            }
            await holder.query('ROLLBACK');
            for (const write of scenario.writes)
              assert.equal(
                (await writer.query(write.sql, [write.id])).rowCount,
                1
              );
          } finally {
            await holder.query('ROLLBACK');
            await writer.query('ROLLBACK');
            holder.release();
            writer.release();
          }
        }
      }
    );
    await t.test(
      'source review comparisons preserve PostgreSQL microseconds after extraction',
      async () => {
        await reset();
        await activate();
        const contributionId = await sponsor();
        await service.prepare(feedId, 'planner');
        const job = (await service.state()).deliveries[0];
        const approvedAt = '2030-01-01T12:00:00.123456Z';
        const submittedAt = '2030-01-01T12:00:00.123457Z';
        assert.equal(
          new Date(approvedAt).getTime(),
          new Date(submittedAt).getTime()
        );
        await pool.query(
          "UPDATE publication_deliveries SET status='approved',approved_at=$2::timestamptz WHERE id=$1",
          [job.id, approvedAt]
        );
        await pool.query(
          'UPDATE fund_contributions SET sponsor_details_submitted_at=$2::timestamptz WHERE id=$1',
          [contributionId, submittedAt]
        );
        assert.deepEqual(await service.sourceIssues(job.id), {
          codes: ['SPONSOR_REVIEW_REQUIRED'],
          excludedSponsorIds: [contributionId]
        });
        await pool.query(
          'UPDATE fund_contributions SET sponsor_details_submitted_at=$2::timestamptz WHERE id=$1',
          [contributionId, approvedAt]
        );
        assert.deepEqual(await service.sourceIssues(job.id), {
          codes: [],
          excludedSponsorIds: []
        });
      }
    );
    await t.test(
      'worker control persists across instances, requires confirmation and rejects stale decisions',
      async () => {
        await reset();
        const stoppedEnv = {
          SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
          SOCIAL_PUBLICATION_MODE: 'disabled'
        };
        const stopped = new PublicationAutomationService(
          pool,
          storage,
          stoppedEnv
        );
        const initial = await stopped.state();
        assert.equal(initial.workerEnabled, false);
        assert.equal(initial.workerVersion, 1);
        const enable = {
          action: 'worker',
          enabled: true,
          version: 1,
          confirmation: 'enable-worker'
        };
        await assert.rejects(
          stopped.command({ ...enable, confirmation: '' }, 'owner'),
          { code: 'CONFIRMATION_REQUIRED' }
        );
        await assert.rejects(
          stopped.command({ ...enable, enabled: 'true' }, 'owner'),
          { code: 'INVALID_COMMAND' }
        );
        await assert.rejects(
          stopped.command({ ...enable, version: 0 }, 'owner'),
          { code: 'INVALID_COMMAND' }
        );
        await pool.query(
          "UPDATE publication_feeds SET auto_prepare=TRUE WHERE id='openg20:facebook'"
        );
        await sponsor();
        await stopped.tick();
        assert.equal((await stopped.state()).deliveries.length, 0);
        await stopped.command(enable, 'owner');
        await stopped.command(enable, 'owner');
        const restarted = new PublicationAutomationService(
          pool,
          storage,
          stoppedEnv
        );
        assert.equal((await restarted.state()).workerEnabled, true);
        assert.equal((await restarted.state()).workerVersion, 2);
        await restarted.tick();
        const prepared = await restarted.state();
        assert.equal(prepared.deliveries.length, 1);
        assert.equal(prepared.deliveries[0].status, 'draft');
        assert.equal(prepared.deliveries[0].mode, 'disabled');
        assert.ok(prepared.feeds.every((f) => f.paused));
        await restarted.command(
          {
            action: 'worker',
            enabled: false,
            version: 2,
            confirmation: 'disable-worker'
          },
          'owner'
        );
        await assert.rejects(restarted.command(enable, 'stale-tab'), {
          code: 'WORKER_VERSION_CONFLICT'
        });
        assert.equal((await service.state()).workerEnabled, false);
        assert.equal((await service.state()).workerVersion, 3);
        const audit = (
          await pool.query(
            "SELECT actor,entity_type,metadata FROM admin_audit_log WHERE action='publication_automation.worker_settings' ORDER BY created_at,id"
          )
        ).rows;
        assert.equal(audit.length, 2);
        assert.ok(
          audit.every(
            (r) => r.actor === 'owner' && r.entity_type === 'publication_worker'
          )
        );
        assert.deepEqual(
          audit.map((r) => r.metadata.enabled),
          [true, false]
        );
      }
    );
    await t.test(
      'turning off prevents claims and turning on resumes only approved deliveries',
      async () => {
        await reset();
        await activate();
        const approvedId = await compose();
        await approve(approvedId);
        const draftId = await compose();
        await service.command(
          {
            action: 'worker',
            enabled: false,
            version: 1,
            confirmation: 'disable-worker'
          },
          'owner'
        );
        await service.tick(due);
        assert.equal((await record(approvedId)).status, 'approved');
        assert.equal((await record(approvedId)).attempts, 0);
        assert.equal((await record(draftId)).status, 'draft');
        await service.command(
          {
            action: 'worker',
            enabled: true,
            version: 2,
            confirmation: 'enable-worker'
          },
          'owner'
        );
        await service.tick(due);
        assert.equal((await record(approvedId)).status, 'published');
        assert.equal((await record(draftId)).status, 'draft');
      }
    );
    await t.test(
      'turning off during preflight releases the claim without losing approval',
      async () => {
        await reset();
        await activate();
        const id = await compose();
        await approve(id);
        const feeds = service.feeds;
        service.feeds = async function (db) {
          const result = await feeds.call(this, db);
          // Preflight reads feed metadata through the public facade with its
          // transaction client; the worker's earlier feed listing has none.
          if (!db) return result;
          await service.command(
            {
              action: 'worker',
              enabled: false,
              version: 1,
              confirmation: 'disable-worker'
            },
            'owner'
          );
          return result;
        };
        try {
          await service.tick(due);
        } finally {
          service.feeds = feeds;
        }
        const after = await record(id);
        assert.equal(after.status, 'approved');
        assert.equal(after.attempts, 0);
        assert.equal(after.externalPostId, null);
        assert.equal(after.errorCode, null);
        assert.equal(
          (
            await pool.query(
              'SELECT lease_until FROM publication_deliveries WHERE id=$1',
              [id]
            )
          ).rows[0].lease_until,
          null
        );
      }
    );
    await t.test('audit failure rolls back a worker state change', async () => {
      await reset();
      await pool.query(`CREATE FUNCTION fail_worker_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='publication_automation.worker_settings' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_worker_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_worker_audit();`);
      try {
        await assert.rejects(
          service.command(
            {
              action: 'worker',
              enabled: false,
              version: 1,
              confirmation: 'disable-worker'
            },
            'owner'
          ),
          /synthetic audit failure/
        );
        assert.equal((await service.state()).workerEnabled, true);
        assert.equal((await service.state()).workerVersion, 1);
      } finally {
        await pool.query(
          'DROP TRIGGER fail_worker_audit ON admin_audit_log; DROP FUNCTION fail_worker_audit()'
        );
      }
    });
    await t.test(
      'private preparation works while paused and disconnected, uses recorded promised destinations and excludes ineligible orders',
      async () => {
        await reset();
        env.SOCIAL_PUBLICATION_MODE = 'disabled';
        const valid = await sponsor({ reviewed: false });
        const noConsent = await sponsor({ reviewed: false });
        const unpaid = await sponsor({ reviewed: false });
        const rejected = await sponsor({ reviewed: false });
        const lowerTier = await sponsor({ reviewed: false, agreement: false });
        const foreignCurrency = await sponsor({
          reviewed: false,
          agreement: false
        });
        await pool.query(
          "UPDATE fund_contributions SET sponsor_feed_target=NULL,sponsor_feed_channels='[]',sponsor_public_summary=NULL,sponsor_review_status='pending_review'"
        );
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [noConsent]
        );
        await pool.query(
          "UPDATE fund_contributions SET status='pending' WHERE id=$1",
          [unpaid]
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='rejected' WHERE id=$1",
          [rejected]
        );
        await pool.query(
          'UPDATE fund_contributions SET amount_cents=5000 WHERE id=$1',
          [lowerTier]
        );
        await pool.query(
          "UPDATE fund_contributions SET currency='eur' WHERE id=$1",
          [foreignCurrency]
        );
        await pool.query(
          'UPDATE publication_feeds SET auto_prepare=TRUE WHERE id=$1',
          [feedId]
        );
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE subject_id=ANY($1::uuid[])',
              [[valid, noConsent, unpaid, rejected, lowerTier, foreignCurrency]]
            )
          ).rows[0].count,
          0
        );
        await service.tick();
        const state = await service.state();
        assert.equal(state.deliveries.length, 1);
        const job = state.deliveries[0];
        assert.equal(job.mode, 'disabled');
        assert.equal(job.status, 'draft');
        assert.equal(job.autoManaged, true);
        assert.equal(job.sponsors[0].id, valid);
        assert.equal(job.sponsors[0].reviewStatus, 'pending_review');
        assert.equal(job.feedId, feedId);
        assert.ok(job.message.includes('Merci'));
        await service.tick();
        assert.equal((await service.state()).deliveries.length, 1);
        assert.equal((await record(job.id)).approvedAt, null);
      }
    );
    await t.test(
      'partial proposals fill automatically; human edits and refusals survive later planning',
      async () => {
        await reset();
        const { job } = await pendingProposal();
        await sponsor();
        await service.prepare(feedId, 'planner');
        const filled = await record(job.id);
        assert.equal(filled.sponsors.length, 2);
        assert.equal(filled.version, job.version + 1);
        const humanMessage = await sponsorshipMessage(
          job.batchId,
          'Human editorial choice'
        );
        await service.command(
          {
            action: 'edit',
            id: job.id,
            version: filled.version,
            message: humanMessage,
            scheduledAt: filled.scheduledAt,
            mediaId: null
          },
          'reviewer'
        );
        await sponsor();
        await service.prepare(feedId, 'planner');
        assert.equal((await record(job.id)).message, humanMessage);
        assert.equal((await record(job.id)).sponsors.length, 2);
        await service.command(
          {
            action: 'reject',
            id: job.id,
            version: (await record(job.id)).version,
            confirmation: job.id,
            moderationDecision: await fixtureModerationDecision(
              pool,
              { type: 'publication_delivery', id: job.id },
              'N3'
            )
          },
          'reviewer'
        );
        await service.prepare(feedId, 'planner');
        const deliveries = (await service.state()).deliveries;
        assert.equal((await record(job.id)).status, 'rejected');
        assert.equal(
          deliveries.filter((j) => j.batchId === job.batchId).length,
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
              [job.sponsors[0].id]
            )
          ).rows[0].sponsor_review_status,
          'pending_review'
        );
      }
    );
    await t.test(
      'combined acceptance keeps profiles and media private until a separate website publication decision',
      async () => {
        await reset();
        const { contributionId, job } = await pendingProposal();
        await assert.rejects(approve(job.id), {
          code: 'SPONSOR_APPROVAL_REQUIRED'
        });
        await assert.rejects(
          service.command(await combinedApproval(job), 'reviewer'),
          { code: 'SPONSOR_MEDIA_REQUIRED' }
        );
        const mediaId = await presentation(contributionId);
        await pool.query(
          "UPDATE fund_contributions SET public_name='Fixture sponsor' WHERE id=$1",
          [contributionId]
        );
        const fresh = await record(job.id);
        await assert.rejects(
          service.command(await combinedApproval(fresh), 'reviewer'),
          { code: 'CONNECTION_REQUIRED' }
        );
        assert.equal(
          (await record(job.id)).sponsors[0].reviewStatus,
          'pending_review'
        );
        await activate();
        await service.command(
          await combinedApproval(await record(job.id)),
          'reviewer'
        );
        assert.equal((await record(job.id)).status, 'approved');
        assert.equal(
          (await record(job.id)).sponsors[0].reviewStatus,
          'approved'
        );
        assert.equal(
          (await listPublicSponsorships(pool)).sponsorships.length,
          0
        );
        assert.equal((await listPublicBuilders(pool)).builders.length, 0);
        assert.equal(await getApprovedPublicSponsorMedia(pool, mediaId), null);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='publication_automation.approve_sponsor' AND actor='reviewer'"
            )
          ).rows[0].n,
          1
        );
        const version = (
          await pool.query(
            'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
            [contributionId]
          )
        ).rows[0].version;
        const result = await updateSponsorshipPublication(pool, {
          contributionId,
          expectedVersion: version,
          publicSlug: 'fixture',
          publicSummary: 'Approved public description',
          feedTarget: 'openg20',
          feedChannels: ['facebook'],
          feedStatus: 'planned',
          feedPublicUrl: null,
          feedNotes: null
        });
        assert.equal(result.updated, true);
        assert.equal(
          (await listPublicSponsorships(pool)).sponsorships.length,
          0,
          'saving presentation settings does not authorize website publication'
        );
        assert.equal((await listPublicBuilders(pool)).builders.length, 0);
        assert.equal(await getApprovedPublicSponsorMedia(pool, mediaId), null);
        const websiteBytes = await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#345678' }
        })
          .webp()
          .toBuffer();
        await pool.query(
          'UPDATE sponsor_media_assets SET processed_size_bytes=$2,checksum_sha256=$3,width=2,height=2,updated_at=clock_timestamp() WHERE id=$1',
          [
            mediaId,
            websiteBytes.length,
            createHash('sha256').update(websiteBytes).digest('hex')
          ]
        );
        await approveFixtureSubject(pool, { type: 'media', id: mediaId });
        await approveFixtureSubject(pool, {
          type: 'sponsorship',
          id: contributionId
        });
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            {
              contributionId,
              expectedVersion: result.currentVersion,
              visible: true,
              confirmed: true
            },
            'reviewer',
            {
              readPrivateObject: async (key) =>
                key === `${mediaId}/processed` ? websiteBytes : null
            }
          ),
          'updated'
        );
        assert.equal(
          (await listPublicSponsorships(pool)).sponsorships.length,
          1
        );
        assert.equal((await listPublicBuilders(pool)).builders.length, 1);
      }
    );
    await t.test(
      'changed sponsor details and withdrawn consent invalidate combined acceptance without partial approval',
      async () => {
        await reset();
        const { contributionId, job } = await pendingProposal();
        await presentation(contributionId);
        await activate();
        const stale = await combinedApproval(job);
        await pool.query(
          "UPDATE fund_contributions SET sponsor_company_name='Changed company',updated_at=NOW() WHERE id=$1",
          [contributionId]
        );
        await assert.rejects(service.command(stale, 'reviewer'), {
          code: 'VERSION_CONFLICT'
        });
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [contributionId]
        );
        await assert.rejects(
          service.command(
            await combinedApproval(await record(job.id)),
            'reviewer'
          ),
          { code: 'SOURCE_NOT_ELIGIBLE' }
        );
        await service.prepare(feedId, 'planner');
        assert.equal((await record(job.id)).status, 'blocked');
        assert.equal((await record(job.id)).approvedAt, null);
        assert.equal(
          (await record(job.id)).sponsors[0].reviewStatus,
          'pending_review'
        );
      }
    );
    await t.test(
      'untouched overdue proposals roll into a future recurrence without authorizing a send',
      async () => {
        await reset();
        const { job } = await pendingProposal();
        const after = new Date(Date.parse(job.scheduledAt) + 1000);
        await service.prepare(feedId, 'planner', after);
        const state = await service.state();
        assert.equal((await record(job.id)).status, 'cancelled');
        const next = state.deliveries.filter((j) => j.status === 'draft');
        assert.equal(next.length, 1);
        assert.ok(Date.parse(next[0].scheduledAt) > after.getTime());
        assert.equal(next[0].sponsors[0].id, job.sponsors[0].id);
        assert.equal(next[0].approvedAt, null);
      }
    );
    await t.test(
      "legacy claiming does not return another worker's publishing job",
      async () => {
        await reset();
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',1) RETURNING id"
          )
        ).rows[0].id;
        const job = (
          await pool.query(
            "INSERT INTO social_publication_jobs(batch_id,channel,provider,mode,idempotency_key,title,body,disclosure_text,draft_ids) VALUES($1,'facebook','facebook','mock',$2,'Fixture','Fixture','Fixture','{}') RETURNING id",
            [batch, randomUUID()]
          )
        ).rows[0].id;
        const results = await Promise.all([
          markSocialPublicationJobPublishing(pool, job),
          markSocialPublicationJobPublishing(pool, job)
        ]);
        assert.equal(results.filter(Boolean).length, 1);
      }
    );
    await t.test(
      'defaults are paused, draft-only; approval binds version, time and destination',
      async () => {
        await reset();
        assert.ok((await service.state()).feeds.every((f) => f.paused));
        const id = await compose();
        await assert.rejects(approve(id), { code: 'CONNECTION_REQUIRED' });
        await activate();
        await approve(id);
        await assert.rejects(
          service.command(
            { action: 'approve', id, version: 1, confirmation: id },
            'tester'
          ),
          { code: 'VERSION_CONFLICT' }
        );
        await service.command(
          {
            action: 'edit',
            id,
            version: 2,
            message: 'Edited',
            scheduledAt: future,
            mediaId: null
          },
          'tester'
        );
        const job = await record(id);
        assert.equal(job.status, 'draft');
        assert.equal(job.approvedAt, null);
        assert.equal(job.version, 3);
        await service.tick(due);
        assert.equal((await record(id)).status, 'draft');
      }
    );
    await t.test(
      'two workers claim only once; pause holds approved jobs and audit is atomic',
      async () => {
        await reset();
        await activate();
        const id = await compose();
        await approve(id);
        await service.command({ action: 'pause-all' }, 'tester');
        await service.tick(due);
        assert.equal((await record(id)).status, 'approved');
        await activate();
        await Promise.all([
          service.tick(due),
          new PublicationAutomationService(pool, storage, env).tick(due)
        ]);
        assert.equal((await record(id)).status, 'published');
        assert.equal((await record(id)).attempts, 1);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.published'",
              [id]
            )
          ).rows[0].n,
          1
        );
      }
    );
    await t.test(
      'crashed claims are quarantined and never resent',
      async () => {
        await reset();
        await activate();
        const id = await compose();
        await approve(id);
        await pool.query(
          "UPDATE publication_deliveries SET status='publishing',lease_until=NOW()-INTERVAL '1 minute' WHERE id=$1",
          [id]
        );
        await service.tick(due);
        await service.tick(due);
        assert.equal((await record(id)).status, 'uncertain');
        assert.equal((await record(id)).attempts, 0);
        await assert.rejects(
          service.command(
            {
              action: 'cancel',
              id,
              version: (await record(id)).version,
              confirmation: id
            },
            'tester'
          ),
          { code: 'DELIVERY_LOCKED' }
        );
        await service.command(
          {
            action: 'reconcile',
            id,
            version: (await record(id)).version,
            confirmation: id,
            externalPostId: `mock-${id}`
          },
          'tester'
        );
        assert.equal((await record(id)).status, 'published');
      }
    );
    await t.test(
      'recurring preparation is idempotent, fills compatible batches and never approves',
      async () => {
        await reset();
        await activate();
        await sponsor();
        await sponsor();
        const feed = (await service.state()).feeds.find((f) => f.id === feedId);
        await service.command(
          {
            action: 'settings',
            settings: {
              ...feed,
              capacity: 2,
              horizonDays: 7,
              weekdays: [0, 1, 2, 3, 4, 5, 6]
            }
          },
          'tester'
        );
        await Promise.all([
          service.prepare(feedId, 'tester', new Date('2030-06-03T12:00:00Z')),
          service.prepare(feedId, 'tester', new Date('2030-06-03T12:00:00Z'))
        ]);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM publication_recurrences'
            )
          ).rows[0].n,
          7
        );
        const jobs = (await service.state()).deliveries;
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].status, 'draft');
        await approve(jobs[0].id);
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=(SELECT contribution_id FROM sponsor_publication_drafts WHERE batch_id=$1 LIMIT 1)',
          [jobs[0].batchId]
        );
        await service.tick(new Date(Date.parse(jobs[0].scheduledAt) + 1000));
        assert.equal((await record(jobs[0].id)).status, 'blocked');
        assert.equal(
          (await record(jobs[0].id)).errorCode,
          'SOURCE_NOT_ELIGIBLE'
        );
      }
    );
    for (const scenario of [
      'pending',
      'reapproved',
      'before-dispatch',
      'before-dispatch-pending',
      'early-transaction'
    ]) {
      await t.test(
        `submitted dossier changes require a new delivery approval: ${scenario}`,
        async (st) => {
          await reset();
          await activate();
          const contributionId = await sponsor();
          await presentation(contributionId);
          const token = 'fixture-revision-' + randomUUID();
          await pool.query(
            `UPDATE fund_contributions SET sponsorship_followup_token_hash=$2,
           sponsorship_followup_token_created_at=NOW(),sponsor_details_submitted_at=NOW()-INTERVAL '1 day'
           WHERE id=$1`,
            [contributionId, createHash('sha256').update(token).digest('hex')]
          );
          await service.prepare(feedId, 'planner');
          const job = (await service.state()).deliveries.find((j) =>
            j.sponsors.some((s) => s.id === contributionId)
          );
          // A transaction can begin before authorization and write its dossier
          // later. The submission timestamp must reflect the write, not BEGIN.
          const earlier =
            scenario === 'early-transaction' ? await pool.connect() : null;
          if (earlier) {
            st.after(async () => {
              await earlier.query('ROLLBACK');
              earlier.release();
            });
            await earlier.query('BEGIN');
            await earlier.query('SELECT NOW()');
          }
          await approve(job.id);
          const original = await record(job.id);
          const data = {
            companyName: 'Revised company',
            contactName: 'Synthetic contact',
            contactEmail: 'contact@example.test',
            websiteUrl: 'https://example.test',
            logoUrl: '',
            message: 'Private updated dossier'
          };
          const draft = await saveSponsorshipDraft(pool, token, 30, 0, data);
          await service.guardEligibility();
          assert.deepEqual(
            await record(job.id),
            original,
            'autosave preserves the approved delivery'
          );
          const submit = async () => {
            if (earlier) {
              await recordSponsorshipDetailsForContribution(earlier, {
                contributionId,
                ...data
              });
              await earlier.query('COMMIT');
            } else {
              await submitSponsorshipDraft(
                pool,
                token,
                30,
                draft.revision,
                data
              );
            }
            if (!['pending', 'before-dispatch-pending'].includes(scenario)) {
              await pool.query(
                "UPDATE fund_contributions SET sponsor_review_status='approved',sponsor_reviewed_at=NOW() WHERE id=$1",
                [contributionId]
              );
            }
          };
          if (scenario.startsWith('before-dispatch')) {
            const guard = service.guardEligibility.bind(service);
            st.mock.method(service, 'guardEligibility', async () => {
              await guard();
              await submit();
            });
            await service.tick(new Date(Date.parse(job.scheduledAt) + 1000));
            st.mock.restoreAll();
          } else {
            await submit();
            await service.guardEligibility();
            await service.guardEligibility();
          }
          const blocked = await record(job.id);
          assert.equal(blocked.status, 'blocked');
          assert.equal(
            blocked.errorCode,
            scenario.startsWith('before-dispatch')
              ? 'MODERATION_RESTRICTED'
              : 'SPONSOR_REVIEW_REQUIRED'
          );
          assert.equal(blocked.approvedAt, null);
          assert.equal(blocked.externalPostId, null);
          const claimCount = scenario.startsWith('before-dispatch') ? 1 : 0;
          assert.equal(blocked.attempts, claimCount);
          // The approved snapshot precedes any claim and the blocked transition.
          assert.equal(blocked.version, original.version + claimCount + 1);
          await assert.rejects(approve(job.id), {
            code: 'APPROVAL_UNAVAILABLE'
          });
          const audits = (
            await pool.query(
              "SELECT action,metadata FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.source_invalidated','publication_automation.blocked')",
              [job.id]
            )
          ).rows;
          assert.equal(audits.length, 1);
          if (!scenario.startsWith('before-dispatch'))
            assert.deepEqual(audits[0].metadata, {
              codes: ['SPONSOR_REVIEW_REQUIRED'],
              affected: [contributionId]
            });

          await service.command(
            {
              action: 'edit',
              id: job.id,
              version: blocked.version,
              message: await sponsorshipMessage(
                job.batchId,
                'Reviewed publication for Revised company'
              ),
              scheduledAt: job.scheduledAt,
              mediaId: null
            },
            'reviewer'
          );
          await service.command(
            await combinedApproval(await record(job.id)),
            'reviewer'
          );
          const authorized = await record(job.id);
          await submitSponsorshipDraft(pool, token, 30, draft.revision, data);
          await service.guardEligibility();
          assert.deepEqual(
            await record(job.id),
            authorized,
            'repeated submission must not revoke the new approval'
          );
          await service.tick(new Date(Date.parse(job.scheduledAt) + 1000));
          assert.equal((await record(job.id)).status, 'published');
          const after = (
            await pool.query(
              'SELECT status,amount_cents FROM fund_contributions WHERE id=$1',
              [contributionId]
            )
          ).rows[0];
          assert.equal(after.status, 'paid');
          assert.equal(Number(after.amount_cents), 25000);
        }
      );
    }
    await t.test(
      'manual batch snapshots preserve edited drafts and detect changes after approval',
      async () => {
        await reset();
        await activate();
        const c = await sponsor();
        const b = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity,status,scheduled_at) VALUES('facebook',2,'scheduled',$1) RETURNING id",
            [future]
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,batch_id) VALUES($1,'openg20','facebook','Custom title','Custom full body','Disclosure',$2)",
          [c, b]
        );
        const { id } = await service.command(
          { action: 'compose', feedId, kind: 'sponsorship', batchId: b },
          'tester'
        );
        assert.equal(
          (await record(id)).message,
          'Partenaire : Fixture sponsor\n\nCustom title\n\nCustom full body\n\nDisclosure'
        );
        await approve(id);
        await assert.rejects(
          pool.query(
            "UPDATE sponsor_publication_drafts SET body='Changed' WHERE batch_id=$1",
            [b]
          ),
          { code: '55000' }
        );
        await assert.rejects(
          pool.query(
            "UPDATE sponsor_publication_batches SET status='published' WHERE id=$1",
            [b]
          ),
          { code: '55000' }
        );
        await service.command(
          {
            action: 'edit',
            id,
            version: (await record(id)).version,
            message: await sponsorshipMessage(b, 'Reviewed final message'),
            scheduledAt: future,
            mediaId: null
          },
          'tester'
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body='Changed' WHERE batch_id=$1",
          [b]
        );
        await assert.rejects(approve(id), { code: 'SOURCE_CHANGED' });
      }
    );
    await t.test(
      'unknown remote result is quarantined and definite rate limits retry the frozen content',
      async (st) => {
        await reset();
        env.SOCIAL_PUBLICATION_MODE = 'live';
        env.SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID = '20';
        env.SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN = 'synthetic';
        const requests = [];
        let outcome = 'timeout';
        st.mock.method(globalThis, 'fetch', async (url, init) => {
          if (url.includes('/me?')) return Response.json({ id: '20' });
          if (!init.method) return new Response('{}', { status: 404 });
          requests.push(init.body.get('message'));
          if (outcome === 'timeout') throw new Error('synthetic timeout');
          if (outcome === 'limit') return new Response('{}', { status: 429 });
          return Response.json({ id: '20_1' });
        });
        await activate();
        const first = await compose();
        await approve(first);
        await service.tick(due);
        await service.tick(due);
        assert.equal((await record(first)).status, 'uncertain');
        assert.equal((await record(first)).nextAttemptAt, null);
        assert.equal(requests.length, 1);
        const uncertain = await record(first);
        await assert.rejects(
          service.command(
            {
              action: 'reconcile',
              id: first,
              version: uncertain.version,
              confirmation: first,
              externalPostId: '20_404'
            },
            'tester'
          ),
          { code: 'REMOTE_POST_UNVERIFIED', status: 503 }
        );
        assert.deepEqual(await record(first), uncertain);
        await service.command(
          {
            action: 'confirm-absent',
            id: first,
            version: uncertain.version,
            confirmation: first,
            reason:
              'Synthetic operator reviewed the complete fixture-provider history and confirmed no first post exists.'
          },
          'tester'
        );
        const second = await compose();
        await approve(second);
        await waitForFixtureAccountCooldown(pool, second);
        outcome = 'limit';
        await service.tick(due);
        assert.equal((await record(second)).status, 'approved');
        assert.ok((await record(second)).nextAttemptAt);
        outcome = 'ok';
        await pool.query(
          'UPDATE publication_deliveries SET next_attempt_at=NOW() WHERE id=$1',
          [second]
        );
        await service.tick(due);
        assert.equal((await record(second)).status, 'approved');
        assert.equal(
          requests.length,
          2,
          'An injected future worker date cannot bypass the real account cooldown.'
        );
        await waitForFixtureAccountCooldown(pool, second);
        await service.tick(due);
        assert.equal((await record(second)).status, 'published');
        assert.deepEqual(requests, [
          'Exact approved message',
          'Exact approved message',
          'Exact approved message'
        ]);
      }
    );
    for (const change of ['deleted', 'reapproved', 'after-preflight']) {
      await t.test(
        `selected media ${change} revokes authorization and requires an explicit new approval`,
        async () => {
          await reset();
          await activate();
          const contributionId = await sponsor();
          imageBytes = await sharp({
            create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
          })
            .webp()
            .toBuffer();
          const mediaId = await presentation(contributionId);
          const { id } = await service.command(
            {
              action: 'compose',
              feedId,
              kind: 'news',
              message: 'Approved media publication',
              scheduledAt: future,
              mediaId
            },
            'tester'
          );
          await approve(id);
          const authorized = await record(id);
          const remove = async () => {
            const asset = await getSponsorMediaStorageRecord(pool, mediaId);
            const result = await deleteSponsorMediaAsset(pool, {
              assetId: mediaId,
              expectedVersion: asset.version,
              allowApproved: true
            });
            assert.equal(result.status, 'updated');
          };
          if (change === 'reapproved') {
            for (const reviewStatus of ['rejected', 'approved']) {
              const asset = await getSponsorMediaStorageRecord(pool, mediaId);
              const result = await reviewSponsorMediaAsset(pool, {
                assetId: mediaId,
                expectedVersion: asset.version,
                reviewStatus,
                altText: asset.altText,
                publicStorageKey:
                  reviewStatus === 'approved' ? `${mediaId}/public` : null,
                publicUrl:
                  reviewStatus === 'approved'
                    ? 'https://example.test/image.webp'
                    : null,
                reviewedBy: 'tester',
                confirmation: mediaId,
                moderationDecision: await fixtureModerationDecision(
                  pool,
                  { type: 'media', id: mediaId },
                  reviewStatus === 'rejected' ? 'N3' : 'N0'
                )
              });
              assert.equal(result.status, 'updated');
            }
          } else if (change === 'deleted') await remove();
          if (change === 'after-preflight') {
            const original = service.guardEligibility.bind(service);
            service.guardEligibility = async () => {
              await original();
              await remove();
            };
            try {
              await service.tick(due);
            } finally {
              service.guardEligibility = original;
            }
          } else {
            await service.guardEligibility();
            await service.guardEligibility();
          }
          const blocked = await record(id);
          assert.equal(blocked.status, 'blocked');
          assert.equal(
            blocked.errorCode,
            change === 'deleted'
              ? 'MEDIA_NOT_APPROVED'
              : 'MODERATION_RESTRICTED'
          );
          assert.equal(blocked.approvedAt, null);
          const claimCount = change === 'after-preflight' ? 1 : 0;
          // The approved snapshot precedes any claim and the blocked transition.
          assert.equal(blocked.version, authorized.version + claimCount + 1);
          assert.equal(blocked.attempts, claimCount);
          assert.equal(blocked.publishedAt, null);
          const audits = (
            await pool.query(
              "SELECT action FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.media_invalidated','publication_automation.blocked')",
              [id]
            )
          ).rows;
          assert.equal(audits.length, change === 'reapproved' ? 0 : 1);
          if (change === 'reapproved')
            assert.equal(
              (
                await pool.query(
                  "SELECT COUNT(*)::int AS count FROM moderation_decisions WHERE subject_type='media' AND subject_id=$1 AND level='N3'",
                  [mediaId]
                )
              ).rows[0].count,
              1
            );
          await assert.rejects(
            service.command(
              {
                action: 'approve',
                id,
                version: authorized.version,
                confirmation: id
              },
              'tester'
            ),
            { code: 'VERSION_CONFLICT' }
          );
          await assert.rejects(
            service.command(
              {
                action: 'approve',
                id,
                version: blocked.version,
                confirmation: id
              },
              'tester'
            ),
            { code: 'APPROVAL_UNAVAILABLE' }
          );
          await service.command(
            {
              action: 'edit',
              id,
              version: blocked.version,
              message: 'Revised publication',
              scheduledAt: future,
              mediaId: change === 'reapproved' ? mediaId : null
            },
            'tester'
          );
          await approve(id);
          await service.tick(due);
          assert.equal((await record(id)).status, 'published');
          imageBytes = null;
        }
      );
    }
    await t.test(
      'media bytes and consent are rechecked, and human absence review revokes approval',
      async () => {
        await reset();
        await activate();
        const contributionId = await sponsor();
        imageBytes = await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
        })
          .webp()
          .toBuffer();
        const mediaId = randomUUID();
        await pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text,usage_rights) VALUES($1,$2,'supporting_image','approved','fixture.webp','image/webp',$7,$3,$7,$4,$5,'https://example.test/image.webp',$6,2,2,'Approved image',
          '{"state":"confirmed","channels":["website","facebook","linkedin"],"targets":["openg7","openg20"],"transformations":["technical"],"credit":null,"restrictions":null}')`,
          [
            mediaId,
            contributionId,
            `${mediaId}/original`,
            `${mediaId}/processed`,
            `${mediaId}/public`,
            createHash('sha256').update(imageBytes).digest('hex'),
            imageBytes.length
          ]
        );
        await approveFixtureSubject(pool, { type: 'media', id: mediaId });
        const { id } = await service.command(
          {
            action: 'compose',
            feedId,
            kind: 'news',
            message: 'Image publication',
            scheduledAt: future,
            mediaId
          },
          'tester'
        );
        await approve(id);
        imageBytes = await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#000000' }
        })
          .webp()
          .toBuffer();
        await service.tick(due);
        assert.equal((await record(id)).errorCode, 'MEDIA_CHANGED');
        assert.equal((await record(id)).approvedAt, null);
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=$1",
          [id]
        );
        await assert.rejects(
          service.command(
            {
              action: 'confirm-absent',
              id,
              version: (await record(id)).version,
              confirmation: id,
              reason: 'too short'
            },
            'tester'
          ),
          { code: 'ABSENCE_REVIEW_REQUIRED' }
        );
        await service.command(
          {
            action: 'confirm-absent',
            id,
            version: (await record(id)).version,
            confirmation: id,
            reason:
              'Checked the provider account history: no publication exists.'
          },
          'tester'
        );
        assert.equal((await record(id)).status, 'blocked');
        assert.equal((await record(id)).approvedAt, null);
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [contributionId]
        );
        assert.ok(
          !(await service.mediaOptions()).some((m) => m.id === mediaId)
        );
        imageBytes = null;
      }
    );
    await t.test(
      'credential rotation blocks a previously authorized destination',
      async () => {
        await reset();
        await activate();
        const id = await compose();
        await approve(id);
        env.SOCIAL_PUBLICATION_MODE = 'live';
        await service.tick(due);
        assert.equal((await record(id)).status, 'blocked');
        assert.equal((await record(id)).errorCode, 'CONNECTION_REQUIRED');
      }
    );
    await t.test(
      'an older approved truncated sponsorship is blocked before dispatch without publication projections',
      async (st) => {
        await reset();
        await activate();
        await sponsor();
        await service.prepare(feedId, 'planner');
        const job = (await service.state()).deliveries.find(
          (j) => j.status === 'draft'
        );
        assert.ok(job);
        await service.command(
          {
            action: 'edit',
            id: job.id,
            version: job.version,
            message: job.message,
            scheduledAt: future,
            mediaId: null
          },
          'tester'
        );
        await approve(job.id);
        const before = (
          await pool.query(
            'SELECT status,published_at FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
            [job.batchId]
          )
        ).rows;
        // Reproduce an authorized legacy row whose free-form message lost its
        // protected source block before the new approval controls were present.
        await pool.query(
          "UPDATE publication_deliveries SET message='Truncated thank-you without beneficiary' WHERE id=$1",
          [job.id]
        );
        st.mock.method(globalThis, 'fetch', async () =>
          assert.fail('invalid recognition must not reach a provider')
        );
        await service.tick(due);
        await service.tick(due);
        const blocked = await record(job.id);
        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.errorCode, 'MODERATION_RESTRICTED');
        assert.equal(blocked.approvedAt, null);
        assert.equal(blocked.externalPostId, null);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT status,published_at FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
              [job.batchId]
            )
          ).rows,
          before
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.published','publication_automation.provider_result_observed')",
              [job.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'current editorial N0 cannot authorize incomplete recognition in a private draft',
      async (st) => {
        await reset();
        await activate();
        await sponsor();
        await service.prepare(feedId, 'planner');
        const job = (await service.state()).deliveries.find(
          (j) => j.status === 'draft'
        );
        assert.ok(job);
        // A synthetic private legacy draft has never held a sending claim.
        await pool.query(
          "UPDATE publication_deliveries SET message='Incomplete recognition' WHERE id=$1",
          [job.id]
        );
        const subject = { type: 'publication_delivery', id: job.id };
        await approveFixtureSubject(pool, subject);
        const before = await record(job.id);
        assert.equal(before.status, 'draft');
        assert.equal(before.approvedAt, null);
        const sourcesBefore = (
          await pool.query(
            'SELECT status,approved_at,published_at FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
            [job.batchId]
          )
        ).rows;
        st.mock.method(globalThis, 'fetch', async () =>
          assert.fail('incomplete recognition must not reach a provider')
        );
        await assert.rejects(
          service.command(
            {
              action: 'approve',
              id: job.id,
              version: before.version,
              confirmation: job.id,
              moderationDecision: await fixtureModerationDecision(pool, subject)
            },
            'tester'
          ),
          { code: 'SOURCE_CONTENT_MISSING' }
        );
        assert.deepEqual(await record(job.id), before);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT status,approved_at,published_at FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id',
              [job.batchId]
            )
          ).rows,
          sourcesBefore
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.approve','publication_automation.published','publication_automation.provider_result_observed')",
              [job.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'database failure after provider success cannot turn into an automatic resend',
      async (st) => {
        await reset();
        env.SOCIAL_PUBLICATION_MODE = 'live';
        let calls = 0;
        st.mock.method(globalThis, 'fetch', async (url) =>
          url.includes('/me?')
            ? Response.json({ id: '20' })
            : (++calls, Response.json({ id: '20_2' }))
        );
        await activate();
        const id = await compose();
        await approve(id);
        const approvedVersion = (await record(id)).version;
        await pool.query(
          `CREATE FUNCTION fail_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='publication_automation.published' THEN RAISE EXCEPTION 'synthetic commit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_publication_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_publication_audit()`
        );
        try {
          await service.tick(due);
          await service.tick(due);
          assert.equal((await record(id)).status, 'uncertain');
          assert.equal((await record(id)).externalPostId, null);
          assert.equal(calls, 1);
          const observed = await pool.query(
            "SELECT actor,metadata FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.provider_result_observed'",
            [id]
          );
          assert.deepEqual(observed.rows, [
            {
              actor: 'publication-worker',
              metadata: {
                claimVersion: approvedVersion + 1,
                mode: 'live',
                feedId: 'openg20:facebook',
                externalPostId: '20_2',
                externalPostUrl: 'https://www.facebook.com/20_2'
              }
            }
          ]);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.published'",
                [id]
              )
            ).rows[0].n,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER fail_publication_audit ON admin_audit_log; DROP FUNCTION fail_publication_audit()'
          );
        }
      }
    );
  }
);

test(
  'migration 023 preserves existing authorizations and website decisions while enabling private planning',
  { timeout: 60000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    t.after(database.stop);
    const pool = database.pool;
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    for (const name of (await readdir(directory))
      .filter((n) => /^\d+_.+\.sql$/.test(n) && n < '023_')
      .sort()) {
      await pool.query(await readFile(new URL(name, directory), 'utf8'));
    }
    const contributionId = randomUUID();
    await pool.query(
      "INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name) VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved','Existing sponsor')",
      [contributionId]
    );
    await pool.query(
      "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
    );
    const existing = (
      await pool.query(
        "INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode,status,approved_at,approved_by) VALUES('openg7:facebook','news','Previously authorized','2030-06-03T14:00:00Z','fixture','mock','approved',NOW(),'reviewer') RETURNING *"
      )
    ).rows[0];
    await pool.query(
      await readFile(
        new URL('023_prepare_publications_for_human_review.sql', directory),
        'utf8'
      )
    );
    const after = (
      await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
        existing.id
      ])
    ).rows[0];
    assert.equal(after.status, 'approved');
    assert.equal(after.message, existing.message);
    assert.equal(after.version, existing.version);
    assert.deepEqual(after.approved_at, existing.approved_at);
    assert.equal(after.auto_managed, false);
    const feed = (
      await pool.query(
        "SELECT * FROM publication_feeds WHERE id='openg7:facebook'"
      )
    ).rows[0];
    assert.equal(feed.paused, false);
    assert.equal(feed.auto_prepare, true);
    const sponsor = (
      await pool.query(
        'SELECT sponsor_review_status,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
        [contributionId]
      )
    ).rows[0];
    assert.equal(sponsor.sponsor_review_status, 'approved');
    assert.equal(sponsor.sponsor_site_visibility_held, false);
    await pool.query(
      await readFile(
        new URL('026_create_publication_worker_settings.sql', directory),
        'utf8'
      )
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT enabled,version FROM publication_worker_settings'
        )
      ).rows,
      [{ enabled: null, version: 1 }]
    );
    assert.equal(
      (
        await pool.query(
          'SELECT status FROM publication_deliveries WHERE id=$1',
          [existing.id]
        )
      ).rows[0].status,
      'approved'
    );
    assert.equal(
      (
        await pool.query(
          "SELECT paused FROM publication_feeds WHERE id='openg7:facebook'"
        )
      ).rows[0].paused,
      false
    );
  }
);
