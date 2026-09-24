import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { markSocialPublicationJobPublishing } from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import {
  listPublicSponsorships,
  recordSponsorshipDetailsForContribution,
  updateSponsorshipPublication
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { listPublicBuilders } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
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
  { timeout: 180000 },
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
    const future = new Date(Date.now() + 60000).toISOString();
    const due = new Date(Date.now() + 120000);
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
        { action: 'approve', id, version: j.version, confirmation: id },
        'tester'
      );
    }
    async function record(id) {
      return (await service.state()).deliveries.find((j) => j.id === id);
    }
    async function sponsor() {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels) VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved','Fixture sponsor','Approved public summary','openg20','["facebook"]')`,
        [id]
      );
      return id;
    }
    async function presentation(contributionId) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text) VALUES($1,$2,'supporting_image','approved','fixture.png','image/png',1,$3,1,$4,$5,'https://example.test/image.webp',$6,2,2,'Approved image')`,
        [
          id,
          contributionId,
          `${id}/original`,
          `${id}/processed`,
          `${id}/public`,
          '0'.repeat(64)
        ]
      );
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
    function combinedApproval(job) {
      return {
        action: 'approve',
        id: job.id,
        version: job.version,
        confirmation: job.id,
        approveSponsors: job.sponsors
          .filter((s) => s.reviewStatus === 'pending_review')
          .map(({ id, version }) => ({ id, version }))
      };
    }
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
        const ready = service.ready;
        service.ready = async function (...args) {
          const media = await ready.apply(this, args);
          await service.command(
            {
              action: 'worker',
              enabled: false,
              version: 1,
              confirmation: 'disable-worker'
            },
            'owner'
          );
          return media;
        };
        try {
          await service.tick(due);
        } finally {
          service.ready = ready;
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
      'private preparation works while paused and disconnected, derives promised destinations and excludes ineligible orders',
      async () => {
        await reset();
        env.SOCIAL_PUBLICATION_MODE = 'disabled';
        const valid = await sponsor();
        const noConsent = await sponsor();
        const unpaid = await sponsor();
        const rejected = await sponsor();
        const lowerTier = await sponsor();
        const foreignCurrency = await sponsor();
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
          "UPDATE publication_feeds SET auto_prepare=TRUE WHERE id='openg7:facebook'"
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
        assert.equal(job.feedId, 'openg7:facebook');
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
        await service.command(
          {
            action: 'edit',
            id: job.id,
            version: filled.version,
            message: 'Human editorial choice',
            scheduledAt: filled.scheduledAt,
            mediaId: null
          },
          'reviewer'
        );
        await sponsor();
        await service.prepare(feedId, 'planner');
        assert.equal((await record(job.id)).message, 'Human editorial choice');
        assert.equal((await record(job.id)).sponsors.length, 2);
        await service.command(
          {
            action: 'reject',
            id: job.id,
            version: (await record(job.id)).version,
            confirmation: job.id
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
      'combined acceptance is explicit and atomic and keeps website profiles and media private',
      async () => {
        await reset();
        const { contributionId, job } = await pendingProposal();
        await assert.rejects(approve(job.id), {
          code: 'SPONSOR_APPROVAL_REQUIRED'
        });
        await assert.rejects(
          service.command(combinedApproval(job), 'reviewer'),
          { code: 'SPONSOR_MEDIA_REQUIRED' }
        );
        const mediaId = await presentation(contributionId);
        await pool.query(
          "UPDATE fund_contributions SET public_name='Fixture sponsor' WHERE id=$1",
          [contributionId]
        );
        const fresh = await record(job.id);
        await assert.rejects(
          service.command(combinedApproval(fresh), 'reviewer'),
          { code: 'CONNECTION_REQUIRED' }
        );
        assert.equal(
          (await record(job.id)).sponsors[0].reviewStatus,
          'pending_review'
        );
        await activate();
        await service.command(
          combinedApproval(await record(job.id)),
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
        const stale = combinedApproval(job);
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
          service.command(combinedApproval(await record(job.id)), 'reviewer'),
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
          assert.equal(blocked.errorCode, 'SPONSOR_REVIEW_REQUIRED');
          assert.equal(blocked.approvedAt, null);
          assert.equal(blocked.externalPostId, null);
          assert.equal(
            blocked.attempts,
            scenario.startsWith('before-dispatch') ? 1 : 0
          );
          assert.equal(blocked.version, original.version + 1);
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
              message: 'Reviewed publication for Revised company',
              scheduledAt: job.scheduledAt,
              mediaId: null
            },
            'reviewer'
          );
          await service.command(
            combinedApproval(await record(job.id)),
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
          'Custom title\n\nCustom full body\n\nDisclosure'
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
            message: 'Reviewed final message',
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
        const second = await compose();
        await approve(second);
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
                reviewedBy: 'tester'
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
            change === 'reapproved' ? 'MEDIA_CHANGED' : 'MEDIA_NOT_APPROVED'
          );
          assert.equal(blocked.approvedAt, null);
          assert.equal(blocked.version, authorized.version + 1);
          assert.equal(blocked.attempts, change === 'after-preflight' ? 1 : 0);
          assert.equal(blocked.publishedAt, null);
          const audits = (
            await pool.query(
              "SELECT action FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.media_invalidated','publication_automation.blocked')",
              [id]
            )
          ).rows;
          assert.equal(audits.length, 1);
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
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text) VALUES($1,$2,'supporting_image','approved','fixture.png','image/png',1,$3,1,$4,$5,'https://example.test/image.webp',$6,2,2,'Approved image')`,
          [
            mediaId,
            contributionId,
            `${mediaId}/original`,
            `${mediaId}/processed`,
            `${mediaId}/public`,
            '0'.repeat(64)
          ]
        );
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
        await pool.query(
          `CREATE FUNCTION fail_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='publication_automation.published' THEN RAISE EXCEPTION 'synthetic commit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_publication_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_publication_audit()`
        );
        try {
          await service.tick(due);
          await service.tick(due);
          assert.equal((await record(id)).status, 'uncertain');
          assert.equal(calls, 1);
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
