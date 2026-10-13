import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { prepare } from '../../dist/apps/funding-api/src/publication-automation/preparation.js';
import { preparationQueue } from '../../dist/apps/funding-api/src/publication-automation/preparation-queue.js';
import { createPreparationOpportunityPlanner } from '../../dist/apps/funding-api/src/publication-automation/preparation-opportunity.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  createAdminPublicationSlot,
  assignBatchToPublicationSlot,
  assignDraftToPublicationSlot
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const now = new Date('2099-01-01T09:00:00Z');
const at = (day = 0, seconds = 0) =>
  new Date(
    Date.parse('2099-01-01T10:00:00Z') + day * 86400000 + seconds * 1000
  ).toISOString();
const gate = () => Promise.withResolvers();

test(
  'private preparation coordinates effective accounts and projects bounded future possibilities',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const env = { SOCIAL_PUBLICATION_MODE: 'live' };
    for (const target of ['OPENG7', 'OPENG20'])
      for (const channel of ['FACEBOOK', 'LINKEDIN']) {
        env[`SOCIAL_PUBLICATION_${target}_${channel}_ACCOUNT_ID`] =
          channel === 'LINKEDIN' && target === 'OPENG7'
            ? 'urn:li:organization:20'
            : '20';
        env[`SOCIAL_PUBLICATION_${target}_${channel}_ACCESS_TOKEN`] =
          'synthetic-private-preparation';
      }
    const service = new PublicationAutomationService(pool, {}, env);
    t.mock.method(globalThis, 'fetch', () => {
      throw new Error('Private preparation must not contact a provider');
    });
    const context = {
      pool,
      env,
      feeds: (db) => service.feeds(db),
      command: (...args) => service.command(...args)
    };
    const jobs = async () =>
      (
        await pool.query(
          'SELECT id,feed_id,batch_id,status,scheduled_at,approved_at,message,source_snapshot,version FROM publication_deliveries ORDER BY scheduled_at,feed_id'
        )
      ).rows;
    const drafts = async () =>
      (
        await pool.query(
          'SELECT id,contribution_id,created_at,batch_id,scheduled_at FROM sponsor_publication_drafts ORDER BY created_at,id'
        )
      ).rows;
    async function reset(horizon = 3, capacity = 1) {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_slots,publication_recurrences,sponsor_publication_batches,sponsor_publication_drafts,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=FALSE,auto_prepare=FALSE,timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time='10:00',horizon_days=$1,capacity=$2",
        [horizon, capacity]
      );
    }
    async function seed(
      target = 'openg7',
      channel = 'facebook',
      count = 1,
      specifications = {}
    ) {
      const records = [];
      for (let index = 0; index < count; index++) {
        const id = randomUUID(),
          draftId = randomUUID();
        const name = `Private calendar sponsor ${id.slice(0, 8)}`;
        const createdAt =
          specifications.createdAt ??
          new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
        const body =
          specifications.body ?? 'Complete synthetic sponsorship recognition.';
        const format = specifications.format ?? 'collective_text';
        await pool.query(
          `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_target,sponsor_feed_channels)
        VALUES($1,'sponsorship_interest',50000,'CAD','paid',TRUE,'pending_review',$2,$3,$4::jsonb)`,
          [id, name, target, JSON.stringify([channel])]
        );
        await recordFixtureSponsorshipAgreement(pool, id, {
          benefits: [{ channel, target, quantity: 1, format }]
        });
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
        VALUES($1,$2,$3,$4,'Editorial title',$5,'Paid sponsorship.',$6)`,
          [draftId, id, target, channel, body, createdAt]
        );
        records.push({ id, draftId, name, body, createdAt, format });
      }
      return records;
    }
    async function waitFor(operation) {
      for (let pass = 0; pass < 250; pass++) {
        if (await operation()) return;
        await delay(20);
      }
      assert.fail('A deterministic PostgreSQL lock barrier was not observed');
    }
    async function snapshot(filter = {}) {
      return withPostgresTransaction(
        pool,
        async (db) =>
          preparationQueue(db, await service.feeds(db), filter, now),
        { readOnlySnapshot: true }
      );
    }
    async function editorial(feedId, scheduledAt, status = 'draft') {
      const result = await service.command(
        {
          action: 'compose',
          feedId,
          kind: 'news',
          message: 'Synthetic human editorial publication.',
          scheduledAt
        },
        'calendar-fixture'
      );
      if (status !== 'draft')
        await pool.query(
          "UPDATE publication_deliveries SET status=$2,approved_at=CASE WHEN $2='approved' THEN NOW() ELSE NULL END,approved_by=CASE WHEN $2='approved' THEN 'synthetic-reviewer' ELSE NULL END WHERE id=$1",
          [result.id, status]
        );
      return result.id;
    }
    function recognized(record) {
      return {
        id: record.draftId,
        contributionId: record.id,
        name: record.name,
        title: 'Editorial title',
        body: record.body,
        disclosureText: 'Paid sponsorship.'
      };
    }

    await t.test(
      'two connections serialize before feed locks and retain different dates on a shared account',
      async () => {
        await reset();
        await seed('openg7');
        await seed('openg20');
        const held = gate(),
          release = gate();
        let backend;
        const firstContext = {
          ...context,
          pool: {
            query: pool.query.bind(pool),
            async connect() {
              const client = await pool.connect();
              backend = (await client.query('SELECT pg_backend_pid() AS id'))
                .rows[0].id;
              return {
                release: () => client.release(),
                async query(sql, params) {
                  const result = await client.query(sql, params);
                  if (sql.includes('preparation_account_mutex')) {
                    held.resolve();
                    await release.promise;
                  }
                  return result;
                }
              };
            }
          }
        };
        const first = prepare(
          firstContext,
          'openg7:facebook',
          'first-planner',
          now
        );
        await held.promise;
        const second = prepare(
          context,
          'openg20:facebook',
          'second-planner',
          now
        );
        try {
          await waitFor(async () =>
            Boolean(
              (
                await pool.query(
                  "SELECT 1 FROM pg_stat_activity WHERE pid<>$1 AND wait_event='advisory' AND query LIKE '%preparation_account_mutex%'",
                  [backend]
                )
              ).rowCount
            )
          );
          assert.equal(
            (await drafts()).filter((row) => row.batch_id).length,
            0
          );
        } finally {
          release.resolve();
        }
        await Promise.all([first, second]);
        const beforeJobs = await jobs(),
          beforeDrafts = await drafts();
        assert.deepEqual(
          beforeJobs.map((row) => [
            row.feed_id,
            row.scheduled_at.toISOString()
          ]),
          [
            ['openg7:facebook', at()],
            ['openg20:facebook', at(1)]
          ]
        );
        assert.ok(
          beforeJobs.every(
            (row) => row.status === 'draft' && row.approved_at === null
          )
        );
        await Promise.all([
          service.prepare('openg7:facebook', 'replay', now),
          service.prepare('openg20:facebook', 'replay', now)
        ]);
        assert.deepEqual(await jobs(), beforeJobs);
        assert.deepEqual(await drafts(), beforeDrafts);
      }
    );

    await t.test(
      'post-commit composition and same-feed preparation acquire advisory authority without a deadlock',
      async (t) => {
        await reset();
        const [sponsor] = await seed();
        const held = gate(),
          release = gate();
        let connections = 0,
          backend;
        const first = prepare(
          {
            ...context,
            pool: {
              query: pool.query.bind(pool),
              async connect() {
                const client = await pool.connect();
                const phase = ++connections;
                if (phase === 2)
                  backend = (
                    await client.query('SELECT pg_backend_pid() AS id')
                  ).rows[0].id;
                let paused = false;
                return {
                  release: () => client.release(),
                  async query(sql, params) {
                    const result = await client.query(sql, params);
                    // Pause after the first real advisory lock of composition.
                    // Both implementations reach this barrier; the competing
                    // planner must wait without forming a reverse dependency.
                    if (
                      phase === 2 &&
                      !paused &&
                      sql.includes('pg_advisory_xact_lock')
                    ) {
                      paused = true;
                      held.resolve();
                      await release.promise;
                    }
                    return result;
                  }
                };
              }
            }
          },
          'openg7:facebook',
          'post-commit-composer',
          now
        );
        const firstOutcome = first.then(
          () => ({ status: 'fulfilled' }),
          (reason) => ({ status: 'rejected', reason })
        );
        t.after(async () => {
          release.resolve();
          await firstOutcome;
        });
        await Promise.race([
          held.promise,
          firstOutcome.then((outcome) =>
            assert.fail(
              `Composition ended before the advisory barrier: ${outcome.reason?.code ?? outcome.status}`
            )
          )
        ]);
        const committedDrafts = await drafts();
        assert.equal(committedDrafts.length, 1);
        assert.equal(committedDrafts[0].id, sponsor.draftId);
        assert.ok(committedDrafts[0].batch_id);
        assert.equal((await jobs()).length, 0);
        const second = prepare(
          context,
          'openg7:facebook',
          'concurrent-same-feed-planner',
          now
        );
        const outcomes = Promise.all([
          firstOutcome,
          second.then(
            () => ({ status: 'fulfilled' }),
            (reason) => ({ status: 'rejected', reason })
          )
        ]);
        try {
          await waitFor(async () =>
            Boolean(
              (
                await pool.query(
                  `SELECT 1 FROM pg_stat_activity
                   WHERE pid<>$1 AND wait_event='advisory'
                     AND $1::integer=ANY(pg_blocking_pids(pid))`,
                  [backend]
                )
              ).rowCount
            )
          );
        } finally {
          release.resolve();
          await outcomes;
        }
        for (const outcome of await outcomes)
          assert.equal(
            outcome.status,
            'fulfilled',
            `Both preparations must finish without a lock cycle: ${outcome.reason?.code ?? ''}`
          );
        assert.deepEqual(await drafts(), committedDrafts);
        const deliveries = await jobs();
        assert.equal(deliveries.length, 1);
        assert.equal(deliveries[0].batch_id, committedDrafts[0].batch_id);
        assert.equal(deliveries[0].status, 'draft');
        assert.equal(deliveries[0].approved_at, null);
        assert.equal(deliveries[0].scheduled_at.toISOString(), at());
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_fulfilment_evidence'
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'a committed batch occupies its account before post-commit composition finishes',
      async () => {
        await reset();
        await seed('openg7');
        await seed('openg20');
        const composing = gate(),
          finish = gate();
        let connections = 0;
        const first = prepare(
          {
            ...context,
            pool: {
              query: pool.query.bind(pool),
              async connect() {
                const client = await pool.connect();
                const phase = ++connections;
                return {
                  release: () => client.release(),
                  async query(sql, params) {
                    if (
                      phase === 2 &&
                      sql.includes('preparation_account_mutex')
                    ) {
                      composing.resolve();
                      await finish.promise;
                    }
                    return client.query(sql, params);
                  }
                };
              }
            }
          },
          'openg7:facebook',
          'first',
          now
        );
        await composing.promise;
        try {
          await prepare(context, 'openg20:facebook', 'second', now);
        } finally {
          finish.resolve();
        }
        await first;
        assert.deepEqual(
          (await jobs()).map((row) => row.scheduled_at.toISOString()),
          [at(), at(1)]
        );
        assert.equal(
          new Set((await drafts()).map((row) => row.batch_id)).size,
          2
        );
      }
    );

    await t.test(
      'compose committed between calendar reads remains occupied with its immutable account',
      async () => {
        await reset();
        await seed('openg7');
        await seed('openg20');
        await prepare(
          { ...context, command: async () => ({}) },
          'openg7:facebook',
          'uncomposed-private-proposal',
          now
        );
        const batch = (await drafts()).find((row) => row.batch_id).batch_id;
        const read = gate(),
          resume = gate();
        const second = prepare(
          {
            ...context,
            pool: {
              query: pool.query.bind(pool),
              async connect() {
                const client = await pool.connect();
                return {
                  release: () => client.release(),
                  async query(sql, params) {
                    const result = await client.query(sql, params);
                    if (sql.includes('preparation_calendar_deliveries')) {
                      assert.equal(result.rowCount, 0);
                      read.resolve();
                      await resume.promise;
                    }
                    return result;
                  }
                };
              }
            }
          },
          'openg20:facebook',
          'parallel-planner',
          now
        );
        await read.promise;
        try {
          await service.command(
            {
              action: 'compose',
              feedId: 'openg7:facebook',
              kind: 'sponsorship',
              batchId: batch,
              publicationFormat: 'collective_text'
            },
            'internal-private-compose',
            true
          );
        } finally {
          resume.resolve();
        }
        await second;
        assert.deepEqual(
          (await jobs()).map((row) => row.scheduled_at.toISOString()),
          [at(), at(1)]
        );
        assert.ok(
          (await jobs()).every(
            (row) => row.status === 'draft' && row.approved_at === null
          )
        );
      }
    );

    await t.test(
      'LinkedIn aliases coordinate and a human proposal reserves the technical interval',
      async () => {
        await reset();
        await seed('openg7', 'linkedin');
        await seed('openg20', 'linkedin');
        await Promise.all([
          service.prepare('openg7:linkedin', 'planner', now),
          service.prepare('openg20:linkedin', 'planner', now)
        ]);
        assert.deepEqual(
          (await jobs()).map((row) => row.scheduled_at.toISOString()),
          [at(), at(1)]
        );
        await reset();
        await seed('openg7');
        const id = await editorial('openg20:facebook', at(0, 30));
        const before = (await jobs())[0];
        await service.prepare('openg7:facebook', 'planner', now);
        assert.deepEqual(
          (await jobs()).find((row) => row.id === id),
          before
        );
        assert.equal(
          (await jobs())
            .find((row) => row.feed_id === 'openg7:facebook')
            .scheduled_at.toISOString(),
          at(1)
        );
      }
    );

    await t.test(
      'a directly reserved manual source occupies the account even when its slot also has an empty batch',
      async () => {
        await reset();
        const [manual] = await seed('openg20');
        await seed('openg7');
        const slot = (
          await createAdminPublicationSlot(pool, {
            feedTarget: 'openg20',
            channel: 'facebook',
            startsAt: at(),
            capacity: 2
          })
        ).slot;
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',2) RETURNING id"
          )
        ).rows[0].id;
        assert.equal(
          (
            await assignBatchToPublicationSlot(pool, {
              slotId: slot.id,
              batchId: batch
            })
          ).updated,
          true
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET status='approved' WHERE id=$1",
          [manual.draftId]
        );
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId: slot.id,
              draftId: manual.draftId
            })
          ).updated,
          true
        );
        const before = (
          await pool.query(
            'SELECT slot_id,batch_id,status,scheduled_at FROM sponsor_publication_drafts WHERE id=$1',
            [manual.draftId]
          )
        ).rows[0];
        await service.prepare('openg7:facebook', 'planner', now);
        assert.equal((await jobs())[0].scheduled_at.toISOString(), at(1));
        assert.deepEqual(
          (
            await pool.query(
              'SELECT slot_id,batch_id,status,scheduled_at FROM sponsor_publication_drafts WHERE id=$1',
              [manual.draftId]
            )
          ).rows[0],
          before
        );
      }
    );

    await t.test(
      'authorized reservations and uncertain account leases survive preparation',
      async () => {
        await reset();
        await seed();
        const id = await editorial('openg20:facebook', at(), 'approved');
        await pool.query(
          "INSERT INTO publication_account_leases(provider,account_id,mode) VALUES('facebook','20','live')"
        );
        await pool.query(
          "INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status) VALUES($1,'facebook','20','live',$2,1,'reserved')",
          [id, at()]
        );
        const before = (await jobs()).find((row) => row.id === id);
        await service.prepare('openg7:facebook', 'planner', now);
        assert.deepEqual(
          (await jobs()).find((row) => row.id === id),
          before
        );
        assert.equal(
          (await jobs())
            .find((row) => row.feed_id === 'openg7:facebook')
            .scheduled_at.toISOString(),
          at(1)
        );
        await reset();
        const [source] = await seed();
        const uncertain = await editorial(
          'openg20:facebook',
          at(),
          'uncertain'
        );
        await pool.query(
          "INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain) VALUES('facebook','20','live',$1,1,NOW()+interval '5 minutes',TRUE)",
          [uncertain]
        );
        const uncertainBefore = await jobs();
        await service.prepare('openg7:facebook', 'planner', now);
        assert.deepEqual(await jobs(), uncertainBefore);
        assert.equal((await drafts())[0].batch_id, null);
        const entry = (await snapshot()).entries.find(
          (row) => row.draftId === source.draftId
        );
        assert.equal(
          entry.nextOpportunity.reason,
          'ACCOUNT_RECONCILIATION_REQUIRED'
        );
        assert.equal(entry.nextOpportunity.proposedAt, null);
        assert.equal(
          (await pool.query('SELECT uncertain FROM publication_account_leases'))
            .rows[0].uncertain,
          true
        );
      }
    );

    await t.test(
      'a full28-day calendar exposes the next recurrence without creating or authorizing it',
      async () => {
        await reset(28);
        const [source] = await seed();
        for (let day = 0; day < 28; day++)
          await editorial('openg20:facebook', at(day));
        await service.prepare('openg7:facebook', 'planner', now);
        const beforeJobs = await jobs(),
          beforeDrafts = await drafts();
        const auditCount = (
          await pool.query('SELECT count(*)::int AS n FROM admin_audit_log')
        ).rows[0].n;
        const queue = await snapshot(),
          filtered = await snapshot({ sponsorshipId: source.id });
        const entry = queue.entries.find(
          (row) => row.draftId === source.draftId
        );
        assert.equal(entry.reason, 'NO_SLOT_IN_HORIZON');
        assert.equal(entry.nextOpportunity.reason, 'AVAILABLE_AFTER_HORIZON');
        assert.equal(entry.nextOpportunity.proposedAt, at(28));
        assert.equal(entry.nextOpportunity.withinHorizon, false);
        assert.deepEqual(
          filtered.entries[0].nextOpportunity,
          entry.nextOpportunity
        );
        assert.deepEqual(await jobs(), beforeJobs);
        assert.deepEqual(await drafts(), beforeDrafts);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM admin_audit_log'))
            .rows[0].n,
          auditCount
        );
        assert.equal(
          (
            await pool.query(
              'SELECT horizon_days FROM publication_feeds WHERE id=$1',
              ['openg7:facebook']
            )
          ).rows[0].horizon_days,
          28
        );
        assert.ok(queue.entries.every((row) => row.deliveryStatus === null));
      }
    );

    await t.test(
      'current capacity and full text shift a possibility without changing retained membership',
      async () => {
        await reset(1, 2);
        const [first] = await seed('openg7', 'facebook', 1, {
          body: 'x'.repeat(1550)
        });
        await service.prepare('openg7:facebook', 'planner', now);
        const [second] = await seed('openg7', 'facebook', 1, {
          body: 'y'.repeat(1550),
          createdAt: '2021-01-01T00:00:00Z'
        });
        const before = await drafts();
        const queue = await snapshot();
        const entry = queue.entries.find(
          (row) => row.draftId === second.draftId
        );
        assert.equal(entry.nextOpportunity.proposedAt, at(1));
        assert.equal(entry.nextOpportunity.reason, 'AVAILABLE_AFTER_HORIZON');
        assert.equal(
          queue.entries.find((row) => row.draftId === first.draftId)
            .nextOpportunity.reason,
          'EXISTING_PROPOSAL'
        );
        assert.deepEqual(await drafts(), before);
      }
    );

    await t.test(
      'paused, invalid, manual, insufficient collection and bounded search expose actions without invented dates',
      async () => {
        await reset(1, 1);
        const [source] = await seed('openg7', 'linkedin', 1, {
          format: 'image_collection'
        });
        await seed('openg7', 'linkedin', 1, {
          format: 'image_collection',
          createdAt: '2021-01-01T00:00:00Z'
        });
        await service.prepare('openg7:linkedin', 'planner', now);
        assert.ok((await drafts()).every((row) => row.batch_id === null));
        let queue = await snapshot();
        assert.equal(
          queue.entries.find((row) => row.draftId === source.draftId)
            .nextOpportunity.reason,
          'CAPACITY_INSUFFICIENT'
        );
        await pool.query(
          "UPDATE publication_feeds SET capacity=2 WHERE id='openg7:linkedin'"
        );
        queue = await snapshot();
        assert.equal(
          queue.entries[0].nextOpportunity.reason,
          'GROUP_PARTICIPANTS_REQUIRED'
        );
        await pool.query(
          "UPDATE publication_feeds SET paused=TRUE WHERE id='openg7:linkedin'"
        );
        assert.equal(
          (await snapshot()).entries[0].nextOpportunity.reason,
          'FEED_PAUSED'
        );
        await pool.query(
          "UPDATE sponsor_publication_drafts SET body=repeat('x',3000) WHERE id=$1",
          [source.draftId]
        );
        assert.equal(
          (await snapshot()).entries.find(
            (row) => row.draftId === source.draftId
          ).nextOpportunity.reason,
          'SOURCE_CORRECTION_REQUIRED'
        );
        await reset();
        const [manual] = await seed();
        await pool.query(
          "UPDATE sponsor_publication_drafts SET status='scheduled',scheduled_at=$2 WHERE id=$1",
          [manual.draftId, at()]
        );
        assert.equal(
          (await snapshot()).entries[0].nextOpportunity.reason,
          'MANUAL_RESERVATION'
        );
        await reset();
        const [bounded] = await seed();
        await pool.query(
          "UPDATE publication_feeds SET weekdays='{}' WHERE id='openg7:facebook'"
        );
        const planner = await createPreparationOpportunityPlanner(
          pool,
          await service.feeds(),
          now
        );
        const hypothetical = planner.project(
          {
            feedId: 'openg7:facebook',
            reason: 'AWAITING_PREPARATION',
            status: 'deferred',
            publicationFormat: 'collective_text'
          },
          recognized(bounded)
        );
        assert.equal(hypothetical.reason, 'NO_COMPATIBLE_RECURRENCE');
        assert.equal(hypothetical.proposedAt, null);
      }
    );

    await t.test(
      'old deferred sources keep priority under continuous arrivals and concurrent same-feed planners',
      async () => {
        await reset(1, 1);
        const initial = await seed('openg7', 'facebook', 3);
        const ages = new Map(
          initial.map((row) => [row.draftId, row.createdAt])
        );
        const arrived = [];
        for (let round = 0; round < 3; round++) {
          arrived.push(
            ...(await seed('openg7', 'facebook', 1, {
              createdAt: new Date(
                Date.UTC(2025, 0, 1, 0, 0, round)
              ).toISOString()
            }))
          );
          // Reveal one additional future opportunity without declaring a benefit
          // fulfilled or expiring a retained private proposal.
          await pool.query(
            "UPDATE publication_feeds SET horizon_days=$1 WHERE id='openg7:facebook'",
            [round + 1]
          );
          await Promise.all([
            service.prepare('openg7:facebook', 'planner-A', now),
            service.prepare('openg7:facebook', 'planner-B', now)
          ]);
          const current = await drafts();
          assert.equal(
            current
              .find((row) => row.id === initial[round].draftId)
              .scheduled_at.toISOString(),
            at(round)
          );
          assert.ok(
            arrived.every(
              (record) =>
                current.find((row) => row.id === record.draftId).batch_id ===
                null
            )
          );
        }
        const current = await drafts();
        assert.ok(
          initial.every(
            (record) =>
              current
                .find((row) => row.id === record.draftId)
                .created_at.toISOString() === ages.get(record.draftId)
          )
        );
        assert.equal((await jobs()).length, 3);
        assert.ok(
          (await jobs()).every(
            (row) => row.status === 'draft' && row.approved_at === null
          )
        );
      }
    );

    await t.test(
      'audit rollback releases preparation mutex and leaves sources, dates and approvals untouched',
      async () => {
        await reset();
        await seed();
        const before = await drafts();
        await pool.query(
          "CREATE FUNCTION reject_calendar_prepare_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='publication_automation.prepare' THEN RAISE EXCEPTION 'synthetic preparation audit failure'; END IF; RETURN NEW; END $$"
        );
        await pool.query(
          'CREATE TRIGGER reject_calendar_prepare_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_calendar_prepare_audit()'
        );
        try {
          await assert.rejects(
            service.prepare('openg7:facebook', 'planner', now),
            /synthetic preparation audit failure/
          );
        } finally {
          await pool.query(
            'DROP TRIGGER reject_calendar_prepare_audit ON admin_audit_log'
          );
          await pool.query('DROP FUNCTION reject_calendar_prepare_audit()');
        }
        assert.deepEqual(await drafts(), before);
        assert.deepEqual(await jobs(), []);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM publication_recurrences'
            )
          ).rows[0].n,
          0
        );
        await service.prepare('openg7:facebook', 'retry', now);
        assert.equal((await jobs()).length, 1);
      }
    );

    await t.test(
      'the real dedicated runtime role can coordinate and project but cannot rewrite audit',
      async () => {
        await reset();
        await seed();
        const password = randomBytes(24).toString('hex'),
          role = 'og7_preparation_calendar_runtime';
        const name = (await pool.query('SELECT current_database() AS name'))
          .rows[0].name;
        await pool.query(
          buildRuntimeRoleSql(
            { role, database: name, password },
            { create: true }
          )
        );
        const runtime = new pg.Pool({ ...pool.options, user: role, password });
        try {
          const runtimeService = new PublicationAutomationService(
            runtime,
            {},
            env
          );
          await runtimeService.prepare(
            'openg7:facebook',
            'runtime-planner',
            now
          );
          const queue = await withPostgresTransaction(
            runtime,
            async (db) =>
              preparationQueue(db, await runtimeService.feeds(db), {}, now),
            { readOnlySnapshot: true }
          );
          assert.equal(queue.entries.length, 1);
          assert.equal(
            queue.entries[0].nextOpportunity.reason,
            'EXISTING_PROPOSAL'
          );
          await assert.rejects(
            runtime.query("UPDATE admin_audit_log SET actor='rewritten'"),
            { code: '42501' }
          );
          await assert.rejects(runtime.query('DELETE FROM admin_audit_log'), {
            code: '42501'
          });
        } finally {
          await runtime.end();
        }
      }
    );
  }
);
