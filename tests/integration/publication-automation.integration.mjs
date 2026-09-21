import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { markSocialPublicationJobPublishing } from '../../dist/apps/funding-api/src/fund-admin.repository.js';

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
        'TRUNCATE publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',account_fingerprint=NULL"
      );
      env.SOCIAL_PUBLICATION_MODE = 'mock';
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
          service.prepare(feedId, 'tester'),
          service.prepare(feedId, 'tester')
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
        assert.equal(requests.length, 1);
        const second = await compose();
        await approve(second);
        outcome = 'limit';
        await service.tick(due);
        assert.equal((await record(second)).status, 'approved');
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
