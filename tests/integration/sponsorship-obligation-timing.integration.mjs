import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { sponsorshipOfferFingerprint } from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  executeSponsorshipTimingCommand,
  loadSponsorshipObligationTimings,
  loadSponsorshipTimingSummary,
  initializeSponsorshipObligationTiming
} from '../../dist/apps/funding-api/src/sponsorship-obligation-timing.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { SponsorshipPublicVisibilityWorker } from '../../dist/apps/funding-api/src/sponsorship-timing/visibility-worker.js';
import { PublicObservationHttpError } from '../../dist/apps/funding-api/src/sponsorship-timing/visibility-http.js';
import { listPublicSponsorships } from '../../dist/apps/funding-api/src/public-sponsorships.repository.js';
import { getApprovedPublicSponsorMedia } from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { createPublicFundingHttpHandler } from '../../dist/apps/funding-api/src/public-funding.http.js';
import { createPublicSponsorMediaHttpHandler } from '../../dist/apps/funding-api/src/public-sponsor-media.http.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationDecision,
  fixtureModerationActor as actor
} from './support/moderation-fixture.mjs';
import { recordModerationDecision } from '../../dist/apps/funding-api/src/moderation/repository.js';

test(
  'commercial timing preserves unknown history and requires explicit duration evidence with exact current sources',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#56789a' }
    })
      .webp()
      .toBuffer();
    const storage = { readPrivateObject: async () => bytes };
    const seed = async ({
      deadlineDays = 7,
      durationDays = 1,
      originUnknown = false,
      quantity = 1
    } = {}) => {
      const session = 'cs_timing_' + randomUUID();
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_session_id,
      sponsor_company_name,sponsor_public_summary,email_private,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
      VALUES('sponsorship_interest',5000,'cad','paid',NOW(),$1,'Synthetic timing sponsor','Public presentation','timing@example.invalid',TRUE,'approved',TRUE) RETURNING id`,
          [session]
        )
      ).rows[0].id;
      await withPostgresTransaction(pool, async (db) => {
        await activateSponsorshipCommitments(db, { stripeSessionId: session });
        const offer = {
          ...createSponsorshipOfferSnapshot(5000, 'CAD'),
          version: 'historical-qualification-v1',
          benefits: createSponsorshipOfferSnapshot(5000, 'CAD').benefits.map(
            (b) => ({ ...b, deadlineDays, durationDays, quantity })
          )
        };
        if (originUnknown) {
          // Explicit pre-051-style fixture: no application inference of its historical origin.
          const offerId = (
            await db.query(
              `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
            VALUES($1,$2,$3,5000,'CAD',$4::jsonb,'historical_qualification') RETURNING id`,
              [
                id,
                offer.version,
                sponsorshipOfferFingerprint(offer),
                JSON.stringify(offer)
              ]
            )
          ).rows[0].id;
          const commitmentId = (
            await db.query(
              `UPDATE sponsorship_commitments SET offer_id=$2,provenance='qualified_historical',state='active',activated_at=NOW() WHERE contribution_id=$1 RETURNING id`,
              [id, offerId]
            )
          ).rows[0].id;
          const obligationId = (
            await db.query(
              `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal)
            VALUES($1,$2,'website_mention','website','openg7',1) RETURNING id`,
              [commitmentId, id]
            )
          ).rows[0].id;
          await db.query(
            'INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,duration_days) VALUES($1,$2,$3)',
            [obligationId, deadlineDays, durationDays]
          );
        } else
          await qualifySponsorshipCommitment(
            db,
            {
              requestId: randomUUID(),
              contributionId: id,
              expectedVersion: 1,
              confirmation: id,
              reason: 'Synthetic timing agreement',
              evidenceReference: 'synthetic://timing-agreement',
              offer
            },
            actor
          );
      });

      const mediaId = (
        await pool.query(
          `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,
      original_storage_key,processed_size_bytes,processed_storage_key,public_url,checksum_sha256,width,height,usage_rights)
      VALUES($1,'supporting_image','approved','synthetic.webp','image/webp',$2,'synthetic-original-'||$1::uuid::text,$2,'synthetic-processed-'||$1::uuid::text,
        '/api/public/sponsor-media/'||gen_random_uuid(),$3,40,30,$4::jsonb) RETURNING id`,
          [
            id,
            bytes.length,
            createHash('sha256').update(bytes).digest('hex'),
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
      const ob = (await loadSponsorshipCommitment(pool, id)).obligations[0];
      return { id, ob, mediaId };
    };
    const timing = async (obId) =>
      (await loadSponsorshipObligationTimings(pool, [obId])).get(obId);
    const command = async (obId, kind, extra = {}) => ({
      requestId: randomUUID(),
      obligationId: obId,
      expectedVersion: (await timing(obId)).version,
      confirmation: obId,
      reason: 'Synthetic owner timing decision',
      kind,
      ...extra
    });
    const visibility = async (id, visible = true) =>
      setSponsorshipWebsiteVisibility(
        pool,
        {
          contributionId: id,
          expectedVersion: (
            await pool.query(
              'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
              [id]
            )
          ).rows[0].version,
          visible,
          confirmed: true
        },
        actor,
        storage
      );
    const backdatedObservation = async (obId) => {
      // Controlled disposable fixture only: insert a dated start, preserving the immutable real snapshot.
      // This checks interval boundaries without claiming a real one-day public exposure.
      return (
        await pool.query(
          `INSERT INTO sponsorship_website_exposure_observations(obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,observed_at,actor)
      SELECT obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,clock_timestamp()-INTERVAL '2 days',actor
      FROM sponsorship_website_exposure_observations WHERE obligation_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 RETURNING id`,
          [obId]
        )
      ).rows[0].id;
    };
    const durationCommand = async (obId, startId) =>
      command(obId, 'duration', {
        startObservationId: startId,
        evidenceReference: 'synthetic://continuous-exposure-review',
        continuityConfirmed: true
      });

    // Real public HTTP handlers and PostgreSQL readers, with only transport/storage supplied locally.
    // No listener, DNS lookup or external HTTP request is started by this fixture.
    const publicGet =
      (mediaStorage = storage) =>
      async (path) => {
        let reply;
        const writeJson = (_request, _response, status, payload) => {
          reply = {
            status,
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify(payload))
          };
        };
        const request = { method: 'GET', url: path };
        const response = {};
        const funding = createPublicFundingHttpHandler({
          publicBaseOrigin: 'https://controlled.example.invalid',
          writeJson,
          listPublicSponsorships: (pagination) =>
            listPublicSponsorships(pool, pagination),
          reportFailure: () => assert.fail('Public directory handler failed')
        });
        if (await funding(request, response)) return reply;
        const media = createPublicSponsorMediaHttpHandler({
          writeJson,
          writeBinary: (_request, _response, status, body, contentType) => {
            reply = { status, body, contentType };
          },
          routeAssetId: (url) =>
            /^\/api\/public\/sponsor-media\/([0-9a-f-]{36})$/i.exec(url)?.[1] ??
            null,
          getApprovedPublicSponsorMedia: (assetId) =>
            getApprovedPublicSponsorMedia(pool, assetId),
          sponsorMediaStorage: mediaStorage,
          getSponsorLogoFilenameFromUrl: () => null,
          reportFailure: () => assert.fail('Public media handler failed')
        });
        assert.equal(await media(request, response), true);
        return reply;
      };
    const observerConfig = {
      enabled: true,
      origin: 'https://controlled.example.invalid',
      intervalMs: 900000,
      batchSize: 5
    };
    await t.test(
      'periodic samples use the actual public directory/media handlers, stay open, and are immutable without duplicating a due check',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const worker = new SponsorshipPublicVisibilityWorker(
          pool,
          observerConfig,
          publicGet()
        );
        assert.deepEqual(await worker.tick(), { checked: 1, incidents: 0 });
        const current = await timing(ob.id);
        assert.equal(current.durationState, 'awaiting_review');
        assert.equal(current.latestPublicObservation.status, 'visible');
        assert.equal(current.latestPublicObservation.reason, 'MATCH');
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'pending'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_obligation_duration_attestations'
            )
          ).rows[0].n,
          0
        );
        assert.deepEqual(await worker.tick(), { checked: 0, incidents: 0 });
        const row = (
          await pool.query(
            'SELECT * FROM sponsorship_public_visibility_observations WHERE obligation_id=$1',
            [ob.id]
          )
        ).rows[0];
        assert.equal(row.request_count, 2);
        await assert.rejects(
          pool.query(
            'UPDATE sponsorship_public_visibility_observations SET status=$2 WHERE id=$1',
            [row.id, 'unknown']
          ),
          { code: '23514' }
        );
        await assert.rejects(
          pool.query(
            'DELETE FROM sponsorship_public_visibility_observations WHERE id=$1',
            [row.id]
          ),
          { code: '23514' }
        );
        assert.equal(Object.keys(current.latestPublicObservation).length, 4);
      }
    );
    await t.test(
      'a real controlled media 404 prevents duration completion even after elapsed time and a later healthy sample',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const startId = await backdatedObservation(ob.id);
        let release, started;
        const waiting = new Promise((resolve) => {
          release = resolve;
        });
        const ready = new Promise((resolve) => {
          started = resolve;
        });
        let first = true;
        const get = publicGet({ readPrivateObject: async () => null });
        const worker = new SponsorshipPublicVisibilityWorker(
          pool,
          observerConfig,
          async (...args) => {
            if (first) {
              first = false;
              started();
              await waiting;
            }
            return get(...args);
          }
        );
        const running = worker.tick();
        await ready;
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          ),
          { code: 'DURATION_OBSERVATION_IN_PROGRESS' }
        );
        // Origin changes only the timing version; it must not erase the HTTP result for this same start.
        await executeSponsorshipTimingCommand(
          pool,
          await command(ob.id, 'origin', {
            originAt: new Date(Date.now() - 86400000).toISOString(),
            evidenceReference: 'synthetic://contract-origin'
          }),
          actor,
          storage
        );
        release();
        assert.deepEqual(await running, { checked: 1, incidents: 1 });
        assert.equal(
          (await timing(ob.id)).latestPublicObservation.status,
          'not_visible'
        );
        assert.equal((await timing(ob.id)).durationState, 'restart_required');
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          ),
          { code: 'DURATION_SOURCE_CHANGED' }
        );
        // Explicit immutable synthetic later sample; it must not erase the earlier interruption.
        await pool.query(
          `INSERT INTO sponsorship_public_visibility_observations(request_id,obligation_id,contribution_id,start_observation_id,
        obligation_version,content_fingerprint,started_at,checked_at,status,reason,http_status,request_count,next_directory_page)
        SELECT $2::uuid,obligation_id,contribution_id,start_observation_id,obligation_version,content_fingerprint,
          clock_timestamp(),clock_timestamp(),'visible','MATCH',200,2,1
        FROM sponsorship_public_visibility_observations WHERE obligation_id=$1 ORDER BY checked_at DESC,id DESC LIMIT 1`,
          [ob.id, randomUUID()]
        );
        assert.equal(
          (await timing(ob.id)).latestPublicObservation.status,
          'visible'
        );
        assert.equal((await timing(ob.id)).durationState, 'restart_required');
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          ),
          { code: 'DURATION_SOURCE_CHANGED' }
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'pending'
        );
        const restarted = await executeSponsorshipTimingCommand(
          pool,
          await command(ob.id, 'observe'),
          actor,
          storage
        );
        assert.notEqual(restarted.timing.startObservation.id, startId);
        assert.equal(restarted.timing.durationState, 'awaiting_review');
        assert.equal(restarted.timing.latestPublicObservation, null);
        // Explicit skew fixture: a late timestamp belongs to the old start, never the replacement period.
        await pool.query(
          `INSERT INTO sponsorship_public_visibility_observations(request_id,obligation_id,contribution_id,start_observation_id,
          obligation_version,content_fingerprint,started_at,checked_at,status,reason,http_status,request_count,next_directory_page)
          SELECT $2::uuid,obligation_id,contribution_id,start_observation_id,obligation_version,content_fingerprint,
            clock_timestamp()+INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 minute','not_visible','PUBLIC_MEDIA_MISSING',404,2,1
          FROM sponsorship_public_visibility_observations WHERE obligation_id=$1 AND start_observation_id=$3 ORDER BY checked_at DESC,id DESC LIMIT 1`,
          [ob.id, randomUUID(), startId]
        );
        assert.equal((await timing(ob.id)).durationState, 'awaiting_review');
        assert.equal((await timing(ob.id)).latestPublicObservation, null);
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, restarted.timing.startObservation.id),
            actor,
            storage
          ),
          { code: 'DURATION_NOT_ELAPSED' }
        );
      }
    );
    await t.test(
      'cross-process sampling is fenced and a concurrent human start supersedes HTTP without an open transaction or false visible result',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        let release, started;
        const waiting = new Promise((resolve) => {
          release = resolve;
        });
        const ready = new Promise((resolve) => {
          started = resolve;
        });
        let first = true;
        const get = publicGet();
        const worker = new SponsorshipPublicVisibilityWorker(
          pool,
          observerConfig,
          async (path, ...args) => {
            if (first) {
              first = false;
              started();
              await waiting;
            }
            return get(path, ...args);
          }
        );
        const old = (await timing(ob.id)).startObservation.id;
        const running = worker.tick();
        await ready;
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
            )
          ).rows[0].n,
          0
        );
        assert.deepEqual(
          await new SponsorshipPublicVisibilityWorker(
            pool,
            observerConfig,
            () => assert.fail('Second worker may not perform HTTP')
          ).tick(),
          { checked: 0, incidents: 0 }
        );
        await executeSponsorshipTimingCommand(
          pool,
          await command(ob.id, 'observe'),
          actor,
          storage
        );
        release();
        await running;
        const row = (
          await pool.query(
            'SELECT status,reason FROM sponsorship_public_visibility_observations WHERE obligation_id=$1 AND start_observation_id=$2',
            [ob.id, old]
          )
        ).rows[0];
        assert.deepEqual(row, { status: 'unknown', reason: 'SOURCE_CHANGED' });
        assert.equal((await timing(ob.id)).latestPublicObservation, null);
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'pending'
        );
      }
    );
    await t.test(
      'an audit failure rolls back the observation but persists scheduler advancement so the next dossier progresses',
      async () => {
        for (let index = 0; index < 2; index++) {
          const { id } = await seed();
          await visibility(id);
        }
        const failing = {
          connect: async () => {
            const client = await pool.connect();
            return {
              query: (sql, params) => {
                if (/INSERT INTO admin_audit_log/.test(sql))
                  throw new Error('Synthetic audit outage');
                return client.query(sql, params);
              },
              release: (discard) => client.release(discard)
            };
          }
        };
        const before = (
          await pool.query(
            'SELECT count(*)::int AS n FROM sponsorship_public_visibility_observations'
          )
        ).rows[0].n;
        await assert.rejects(
          new SponsorshipPublicVisibilityWorker(
            failing,
            { ...observerConfig, batchSize: 1 },
            publicGet()
          ).tick(),
          /Synthetic audit outage/
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_public_visibility_observations'
            )
          ).rows[0].n,
          before
        );
        const failedCursor = (
          await pool.query(
            'SELECT cursor_obligation_id FROM sponsorship_public_visibility_worker'
          )
        ).rows[0].cursor_obligation_id;
        assert.equal(
          (
            await new SponsorshipPublicVisibilityWorker(
              pool,
              { ...observerConfig, batchSize: 1 },
              publicGet()
            ).tick()
          ).checked,
          1
        );
        assert.notEqual(
          (
            await pool.query(
              'SELECT cursor_obligation_id FROM sponsorship_public_visibility_worker'
            )
          ).rows[0].cursor_obligation_id,
          failedCursor
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_obligation_duration_attestations'
            )
          ).rows[0].n,
          0
        );
      }
    );

    await t.test(
      'a byte-exhausted run leaves followers unobserved and starts different dossiers on its next persistent cursor',
      async () => {
        for (let index = 0; index < 5; index++) {
          const { id } = await seed();
          await visibility(id);
        }
        const known = new Set(
          (
            await pool.query(
              'SELECT id FROM sponsorship_public_visibility_observations'
            )
          ).rows.map((row) => row.id)
        );
        const get = publicGet();
        let imageAttempts = 0,
          allowances = 0,
          directoryBytes = 0;
        const worker = new SponsorshipPublicVisibilityWorker(
          pool,
          observerConfig,
          async (path, maxBytes, ...args) => {
            if (path.includes('sponsor-media')) {
              imageAttempts++;
              allowances += maxBytes;
              throw new PublicObservationHttpError('HTTP_TOO_LARGE');
            }
            const result = await get(path, maxBytes, ...args);
            directoryBytes += result.body.byteLength;
            return result;
          }
        );
        assert.deepEqual(await worker.tick(), { checked: 2, incidents: 2 });
        const first = (
          await pool.query(
            'SELECT id,obligation_id,request_count FROM sponsorship_public_visibility_observations'
          )
        ).rows.filter((row) => !known.has(row.id));
        assert.equal(first.length, 2);
        assert.equal(imageAttempts, 2);
        assert.ok(allowances + directoryBytes <= 16 * 1024 * 1024);
        assert.ok(first.every((row) => row.request_count > 0));
        imageAttempts = allowances = directoryBytes = 0;
        assert.deepEqual(await worker.tick(), { checked: 2, incidents: 2 });
        const all = (
          await pool.query(
            'SELECT id,obligation_id,request_count FROM sponsorship_public_visibility_observations'
          )
        ).rows.filter((row) => !known.has(row.id));
        assert.equal(all.length, 4);
        assert.equal(new Set(all.map((row) => row.obligation_id)).size, 4);
        assert.ok(all.every((row) => row.request_count > 0));
        assert.equal(imageAttempts, 2);
        assert.ok(allowances + directoryBytes <= 16 * 1024 * 1024);
      }
    );
    await t.test(
      'a deadline-exhausted run does not stamp unstarted followers and the next run continues to another dossier',
      async (subtest) => {
        for (let index = 0; index < 5; index++) {
          const { id } = await seed();
          await visibility(id);
        }
        const known = new Set(
          (
            await pool.query(
              'SELECT id FROM sponsorship_public_visibility_observations'
            )
          ).rows.map((row) => row.id)
        );
        let logicalNow = Date.now();
        const clock = subtest.mock.method(Date, 'now', () => logicalNow);
        const get = publicGet();
        let exhaust = true;
        const worker = new SponsorshipPublicVisibilityWorker(
          pool,
          observerConfig,
          async (...args) => {
            if (exhaust) {
              exhaust = false;
              logicalNow += 45001;
              throw new PublicObservationHttpError('HTTP_TIMEOUT');
            }
            return get(...args);
          }
        );
        try {
          assert.deepEqual(await worker.tick(), { checked: 1, incidents: 1 });
          const first = (
            await pool.query(
              'SELECT id,obligation_id,request_count FROM sponsorship_public_visibility_observations'
            )
          ).rows.filter((row) => !known.has(row.id));
          assert.equal(first.length, 1);
          assert.equal(first[0].request_count, 1);
          const second = await worker.tick();
          assert.ok(second.checked >= 1);
          const following = (
            await pool.query(
              'SELECT id,obligation_id,request_count FROM sponsorship_public_visibility_observations'
            )
          ).rows.filter((row) => !known.has(row.id) && row.id !== first[0].id);
          assert.ok(following.length >= 1);
          assert.ok(
            following.every(
              (row) =>
                row.obligation_id !== first[0].obligation_id &&
                row.request_count > 0
            )
          );
        } finally {
          clock.mock.restore();
        }
      }
    );

    await t.test(
      'a checkpoint that exhausts the deadline creates no HTTP observation and keeps the unstarted dossier first',
      async (subtest) => {
        for (let index = 0; index < 2; index++) {
          const { id } = await seed();
          await visibility(id);
        }
        const before = (
          await pool.query(
            'SELECT cursor_obligation_id FROM sponsorship_public_visibility_worker'
          )
        ).rows[0].cursor_obligation_id;
        const known = new Set(
          (
            await pool.query(
              'SELECT id FROM sponsorship_public_visibility_observations'
            )
          ).rows.map((row) => row.id)
        );
        let logicalNow = Date.now(),
          firstId;
        const clock = subtest.mock.method(Date, 'now', () => logicalNow);
        const slowCheckpoint = {
          connect: async () => {
            const client = await pool.connect();
            return {
              release: (discard) => client.release(discard),
              query: async (sql, params) => {
                const result = await client.query(sql, params);
                if (sql.includes('SELECT ob.id,ob.contribution_id,ob.version'))
                  firstId = result.rows[0].id;
                if (/UPDATE sponsorship_public_visibility_worker/.test(sql))
                  logicalNow += 45001;
                return result;
              }
            };
          }
        };
        try {
          assert.deepEqual(
            await new SponsorshipPublicVisibilityWorker(
              slowCheckpoint,
              { ...observerConfig, batchSize: 1 },
              () =>
                assert.fail(
                  'No HTTP attempt may start after the checkpoint deadline'
                )
            ).tick(),
            { checked: 0, incidents: 0 }
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM sponsorship_public_visibility_observations'
              )
            ).rows[0].n,
            known.size
          );
          assert.equal(
            (
              await pool.query(
                'SELECT cursor_obligation_id FROM sponsorship_public_visibility_worker'
              )
            ).rows[0].cursor_obligation_id,
            before
          );
        } finally {
          clock.mock.restore();
        }
        assert.deepEqual(
          await new SponsorshipPublicVisibilityWorker(
            pool,
            { ...observerConfig, batchSize: 1 },
            publicGet()
          ).tick(),
          { checked: 1, incidents: 0 }
        );
        const stored = (
          await pool.query(
            'SELECT id,obligation_id,request_count FROM sponsorship_public_visibility_observations'
          )
        ).rows.filter((row) => !known.has(row.id));
        assert.equal(stored.length, 1);
        assert.equal(stored[0].obligation_id, firstId);
        assert.ok(stored[0].request_count > 0);
      }
    );

    await t.test(
      'new qualification keeps its contractual anchor unknown until the owner documents it; replay never rebases',
      async () => {
        const { ob } = await seed({ durationDays: null });
        const before = await timing(ob.id);
        assert.equal(before.originProvenance, null);
        assert.equal(before.deadlineDays, 7);
        assert.equal(before.overdue, false);
        assert.equal(before.originAt, null);
        assert.equal(before.dueAt, null);
        const receipt = await executeSponsorshipTimingCommand(
          pool,
          await command(ob.id, 'origin', {
            originAt: new Date(Date.now() - 86400000).toISOString(),
            evidenceReference: 'synthetic://explicit-agreement-anchor'
          }),
          actor
        );
        assert.equal(
          Date.parse(receipt.timing.dueAt) -
            Date.parse(receipt.timing.originAt),
          7 * 86400000
        );
        await initializeSponsorshipObligationTiming(pool, ob.commitmentId);
        assert.deepEqual(await timing(ob.id), receipt.timing);
      }
    );
    await t.test(
      'historical timing without origin needs explicit owner evidence, remains unchanged on replay and creates only internal lateness',
      async () => {
        const { ob } = await seed({ durationDays: null, originUnknown: true });
        assert.equal((await timing(ob.id)).originAt, null);
        assert.equal((await timing(ob.id)).overdue, false);
        const input = await command(ob.id, 'origin', {
          originAt: new Date(Date.now() - 8 * 86400000).toISOString(),
          evidenceReference: 'synthetic://origin-document'
        });
        const beforeOb = (
          await loadSponsorshipCommitment(pool, ob.contributionId)
        ).obligations[0];
        const receipt = await executeSponsorshipTimingCommand(
          pool,
          input,
          actor
        );
        assert.equal(receipt.timing.overdue, true);
        assert.equal(receipt.timing.originProvenance, 'owner_recorded');
        assert.deepEqual(
          await executeSponsorshipTimingCommand(pool, input, actor),
          receipt
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, ob.contributionId))
            .obligations[0].version,
          beforeOb.version
        );
        assert.ok((await loadSponsorshipTimingSummary(pool)).overdueCount >= 1);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            { ...input, reason: 'Changed replay' },
            actor
          ),
          { code: 'COMMITMENT_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await command(ob.id, 'origin', {
              originAt: new Date().toISOString(),
              evidenceReference: 'synthetic://replacement'
            }),
            actor
          ),
          { code: 'TIMING_ORIGIN_ALREADY_RECORDED' }
        );
        await assert.rejects(
          pool.query(
            'UPDATE sponsorship_obligation_timing SET deadline_days=1,version=version+1 WHERE obligation_id=$1',
            [ob.id]
          ),
          { code: '23514' }
        );
      }
    );
    await t.test(
      'show and elapsed clock alone never complete duration; confirmation, proof and minimum interval are mandatory',
      async () => {
        const { id, ob } = await seed();
        assert.equal(await visibility(id), 'updated');
        const current = await timing(ob.id);
        assert.equal(current.durationState, 'awaiting_review');
        assert.ok(current.startObservation);
        assert.equal(
          Date.parse(current.startObservation.earliestCompletionAt) -
            Date.parse(current.startObservation.observedAt),
          86400000
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0]
            .fulfilmentEvidenceId,
          null
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, current.startObservation.id),
            actor,
            storage
          ),
          { code: 'DURATION_NOT_ELAPSED' }
        );
        for (const invalid of [
          { continuityConfirmed: false },
          { evidenceReference: '' },
          { confirmation: 'wrong' }
        ]) {
          const input = {
            ...(await durationCommand(ob.id, current.startObservation.id)),
            ...invalid
          };
          await assert.rejects(
            executeSponsorshipTimingCommand(pool, input, actor, storage)
          );
        }
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'human-supported duration with exact observed sources completes once and replay needs no storage',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const startId = await backdatedObservation(ob.id);
        const input = await durationCommand(ob.id, startId);
        const receipt = await executeSponsorshipTimingCommand(
          pool,
          input,
          actor,
          storage
        );
        assert.equal(receipt.timing.durationState, 'attested');
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'fulfilled'
        );
        assert.deepEqual(
          await executeSponsorshipTimingCommand(pool, input, actor),
          receipt
        );
        const counts = await pool.query(
          `SELECT (SELECT count(*) FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1)::int AS evidence,
      (SELECT count(*) FROM sponsorship_obligation_duration_attestations WHERE obligation_id=$1)::int AS attestations,
      (SELECT count(*) FROM email_messages WHERE metadata->>'obligationId'=$1::uuid::text AND metadata->>'event'='fulfilled')::int AS notifications`,
          [ob.id]
        );
        assert.deepEqual(counts.rows[0], {
          evidence: 1,
          attestations: 1,
          notifications: 1
        });
        await assert.rejects(
          pool.query(
            'UPDATE sponsorship_obligation_duration_attestations SET continuity_confirmed=FALSE WHERE obligation_id=$1',
            [ob.id]
          ),
          { code: '23514' }
        );
      }
    );
    await t.test(
      'known hide and re-show invalidate the original continuous period, without deleting history',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const startId = await backdatedObservation(ob.id);
        const priorStart = (await timing(ob.id)).startObservation;
        assert.equal(await visibility(id, false), 'updated');
        const interrupted = await timing(ob.id);
        assert.equal(interrupted.durationState, 'restart_required');
        assert.deepEqual(interrupted.startObservation, priorStart);
        assert.equal(await visibility(id), 'updated');
        assert.equal((await timing(ob.id)).durationState, 'awaiting_review');
        assert.notEqual(
          (await timing(ob.id)).startObservation.id,
          priorStart.id
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          ),
          { code: 'DURATION_SOURCE_CHANGED' }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
        assert.ok(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_website_exposure_observations WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n >= 3
        );
      }
    );
    await t.test(
      'withdrawn and restored media rights require a new duration start',
      async () => {
        const { id, ob, mediaId } = await seed();
        await visibility(id);
        const startId = await backdatedObservation(ob.id);
        const usage = (
          await pool.query(
            'SELECT usage_rights FROM sponsor_media_assets WHERE id=$1',
            [mediaId]
          )
        ).rows[0].usage_rights;
        await pool.query(
          'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1',
          [mediaId, JSON.stringify({ ...usage, state: 'withdrawn' })]
        );
        assert.equal((await timing(ob.id)).durationState, 'restart_required');
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          )
        );
        await pool.query(
          'UPDATE sponsor_media_assets SET usage_rights=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1',
          [mediaId, JSON.stringify(usage)]
        );
        await approveFixtureSubject(pool, { type: 'media', id: mediaId });
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
        await visibility(id);
        assert.equal((await timing(ob.id)).durationState, 'restart_required');
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            storage
          ),
          { code: 'DURATION_SOURCE_CHANGED' }
        );
        const restarted = await executeSponsorshipTimingCommand(
          pool,
          await command(ob.id, 'observe'),
          actor,
          storage
        );
        assert.equal(restarted.timing.durationState, 'awaiting_review');
        assert.notEqual(restarted.timing.startObservation.id, startId);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'moderation holds are visible as a required new start and restored N0 never reuses the earlier observation',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const old = (await timing(ob.id)).startObservation;
        const subject = { type: 'sponsorship', id },
          decision = await fixtureModerationDecision(pool, subject, 'N1');
        await withPostgresTransaction(pool, (db) =>
          recordModerationDecision(db, { subject, decision, actor })
        );
        const held = await timing(ob.id);
        assert.equal(held.durationState, 'restart_required');
        assert.deepEqual(held.startObservation, old);
        await approveFixtureSubject(pool, subject);
        assert.equal((await timing(ob.id)).durationState, 'restart_required');
        await visibility(id);
        const restored = await timing(ob.id);
        assert.equal(restored.durationState, 'awaiting_review');
        assert.notEqual(restored.startObservation.id, old.id);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'successive duration passages cannot share the same period, and earlier fulfilment replay preserves its evidence',
      async () => {
        const { id, ob: first } = await seed({ quantity: 2 });
        await visibility(id);
        const second = (
          await loadSponsorshipCommitment(pool, id)
        ).obligations.find((ob) => ob.ordinal === 2);
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await command(second.id, 'observe'),
            actor,
            storage
          ),
          { code: 'DURATION_PREVIOUS_PASSAGE_OPEN' }
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(
              second.id,
              (await timing(first.id)).startObservation.id
            ),
            actor,
            storage
          ),
          { code: 'DURATION_PREVIOUS_PASSAGE_OPEN' }
        );
        const firstInput = await durationCommand(
          first.id,
          await backdatedObservation(first.id)
        );
        const firstReceipt = await executeSponsorshipTimingCommand(
          pool,
          firstInput,
          actor,
          storage
        );
        const firstProof = (
          await pool.query(
            'SELECT id,delivered_at,content_fingerprint FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
            [first.id]
          )
        ).rows[0];
        // A controlled fixture represents an older overlapping observation; it must remain unusable after passage one closes.
        const overlapping = (
          await pool.query(
            `INSERT INTO sponsorship_website_exposure_observations(obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,observed_at,actor)
        SELECT $2::uuid,contribution_id,1,content_fingerprint,message,source_snapshot,media_snapshot,clock_timestamp()-INTERVAL '2 days',actor
        FROM sponsorship_website_exposure_observations WHERE obligation_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 RETURNING id`,
            [first.id, second.id]
          )
        ).rows[0].id;
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(second.id, overlapping),
            actor,
            storage
          ),
          { code: 'DURATION_PERIOD_OVERLAP' }
        );
        const next = await executeSponsorshipTimingCommand(
          pool,
          await command(second.id, 'observe'),
          actor,
          storage
        );
        assert.ok(
          Date.parse(next.timing.startObservation.observedAt) >=
            firstProof.delivered_at.getTime()
        );
        assert.ok(
          Date.parse(next.timing.startObservation.earliestCompletionAt) >
            Date.now()
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations.find(
            (ob) => ob.ordinal === 2
          ).state,
          'pending'
        );
        assert.deepEqual(
          await executeSponsorshipTimingCommand(pool, firstInput, actor),
          firstReceipt
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT id,delivered_at,content_fingerprint FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [first.id]
            )
          ).rows[0],
          firstProof
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE contribution_id=$1',
              [id]
            )
          ).rows[0].n,
          1
        );
      }
    );
    await t.test(
      'concurrent timing commands with one version produce one observation and one explicit conflict',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const input = await command(ob.id, 'observe');
        const before = (
          await pool.query(
            'SELECT count(*)::int AS n FROM sponsorship_website_exposure_observations WHERE obligation_id=$1',
            [ob.id]
          )
        ).rows[0].n;
        const outcomes = await Promise.allSettled([
          executeSponsorshipTimingCommand(pool, input, actor, storage),
          executeSponsorshipTimingCommand(
            pool,
            { ...input, requestId: randomUUID() },
            actor,
            storage
          )
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === 'fulfilled').length,
          1
        );
        assert.equal(
          outcomes.find((result) => result.status === 'rejected').reason.code,
          'TIMING_VERSION_CONFLICT'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_website_exposure_observations WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          before + 1
        );
      }
    );
    await t.test(
      'missing bytes, stale timing versions, another dossier observation and replay conflicts fail without fulfilment',
      async () => {
        const { id, ob } = await seed();
        await visibility(id);
        const startId = await backdatedObservation(ob.id);
        const input = await command(ob.id, 'observe');
        const observed = await executeSponsorshipTimingCommand(
          pool,
          input,
          actor,
          storage
        );
        assert.equal(observed.timing.version, input.expectedVersion + 1);
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            { ...input, requestId: randomUUID() },
            actor,
            storage
          ),
          { code: 'TIMING_VERSION_CONFLICT' }
        );
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, startId),
            actor,
            { readPrivateObject: async () => null }
          ),
          { code: 'MEDIA_UNAVAILABLE' }
        );
        const other = await seed();
        await visibility(other.id);
        const foreign = await backdatedObservation(other.ob.id);
        await assert.rejects(
          executeSponsorshipTimingCommand(
            pool,
            await durationCommand(ob.id, foreign),
            actor,
            storage
          ),
          { code: 'DURATION_OBSERVATION_NOT_FOUND' }
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
              [ob.id]
            )
          ).rows[0].n,
          0
        );
      }
    );
  }
);

test(
  'migration 051 preserves an existing agreement and leaves its historical origin unknown',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({
      migrate: false
    });
    t.after(stop);
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    const migrations = (await readdir(directory))
      .filter(
        (name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) < 51
      )
      .sort();
    for (const migration of migrations)
      await pool.query(await readFile(new URL(migration, directory), 'utf8'));
    const id = (
      await pool.query(
        `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_session_id)
    VALUES('sponsorship_interest',5000,'cad','paid','2007-01-01T00:00:00Z',$1) RETURNING id`,
        ['cs_timing_before_051_' + randomUUID()]
      )
    ).rows[0].id;
    const offer = {
      ...createSponsorshipOfferSnapshot(5000, 'CAD'),
      version: 'historical-qualification-v1',
      benefits: createSponsorshipOfferSnapshot(5000, 'CAD').benefits.map(
        (b) => ({ ...b, deadlineDays: 7, durationDays: 30 })
      )
    };
    const offerId = (
      await pool.query(
        `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
    VALUES($1,$2,$3,5000,'CAD',$4::jsonb,'historical_qualification') RETURNING id`,
        [
          id,
          offer.version,
          sponsorshipOfferFingerprint(offer),
          JSON.stringify(offer)
        ]
      )
    ).rows[0].id;
    const commitmentId = (
      await pool.query(
        `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
    VALUES($1,$2,'qualified_historical','active','2010-01-01T00:00:00Z') RETURNING id`,
        [id, offerId]
      )
    ).rows[0].id;
    const obId = (
      await pool.query(
        `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal)
    VALUES($1,$2,'website_mention','website','openg7',1) RETURNING id`,
        [commitmentId, id]
      )
    ).rows[0].id;
    const before = (
      await pool.query(
        'SELECT status,amount_cents,paid_at FROM fund_contributions WHERE id=$1',
        [id]
      )
    ).rows[0];
    await pool.query(
      await readFile(
        new URL('051_sponsorship_obligation_timing.sql', directory),
        'utf8'
      )
    );
    const current = (
      await pool.query(
        'SELECT version,deadline_days,duration_days,origin_at,origin_provenance,due_at FROM sponsorship_obligation_timing WHERE obligation_id=$1',
        [obId]
      )
    ).rows[0];
    assert.deepEqual(current, {
      version: 1,
      deadline_days: 7,
      duration_days: 30,
      origin_at: null,
      origin_provenance: null,
      due_at: null
    });
    await initializeSponsorshipObligationTiming(pool, commitmentId);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT version,deadline_days,duration_days,origin_at,origin_provenance,due_at FROM sponsorship_obligation_timing WHERE obligation_id=$1',
          [obId]
        )
      ).rows[0],
      current
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT status,amount_cents,paid_at FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0],
      before
    );
    assert.equal(
      (
        await pool.query(
          'SELECT state,fulfilment_evidence_id FROM sponsorship_obligations WHERE id=$1',
          [obId]
        )
      ).rows[0].state,
      'pending'
    );
    await assert.rejects(
      pool.query(
        'DELETE FROM sponsorship_obligation_timing WHERE obligation_id=$1',
        [obId]
      ),
      { code: '23514' }
    );
  }
);
