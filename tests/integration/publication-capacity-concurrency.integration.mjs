import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

import {
  assignBatchToPublicationSlot,
  assignDraftToPublicationBatch,
  assignDraftToPublicationSlot,
  createAdminPublicationSlot,
  updateAdminPublicationSlot
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  complete,
  observeProviderResult
} from '../../dist/apps/funding-api/src/publication-automation/delivery-outcomes.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { capturePublicationObligations } from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { reserveAccountSchedule } from '../../dist/apps/funding-api/src/publication-automation/account-reservations.js';
import { claimNextDelivery } from '../../dist/apps/funding-api/src/publication-automation/claims.js';

const barrier = () => {
  let release;
  let opened = false;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return {
    promise,
    get opened() {
      return opened;
    },
    open() {
      opened = true;
      release();
    }
  };
};

// Each operation uses its own real PostgreSQL connection, including its reads
// and transaction. release() is deferred until the race fixture is cleaned up.
const connectionPool = (client) => ({
  query: (...args) => client.query(...args),
  connect: async () => ({
    query: (...args) => client.query(...args),
    release() {}
  })
});

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await setTimeout(15);
  }
  assert.fail(message);
};

const blockedConnections = async (pool, pids) => {
  const result = await pool.query(
    `SELECT pid FROM pg_stat_activity
     WHERE pid = ANY($1::integer[]) AND wait_event_type = 'Lock'
       AND cardinality(pg_blocking_pids(pid)) > 0`,
    [pids]
  );
  return result.rows.length;
};

// Holding the child rows makes the original single-statement COUNT/UPDATE race
// deterministic: both statements see a free place before either child changes.
// With parent locks, the second connection waits for the shared parent instead.
const race = async (
  pool,
  {
    table,
    ids,
    operations,
    waitForFirstLock = false,
    beforeRelease = async () => {}
  }
) => {
  assert.ok(
    ['sponsor_publication_drafts', 'sponsor_publication_batches'].includes(
      table
    )
  );
  const clients = await Promise.all([
    pool.connect(),
    pool.connect(),
    pool.connect()
  ]);
  const [first, second, gate] = clients;
  const pids = await Promise.all(
    [first, second].map(
      async (client) =>
        (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    )
  );
  assert.notEqual(
    pids[0],
    pids[1],
    'reservations need two independent backends'
  );
  let gateOpen = false;
  const running = [];
  try {
    await gate.query('BEGIN');
    gateOpen = true;
    await gate.query(
      `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [ids]
    );
    running.push(operations[0](connectionPool(first)));
    if (waitForFirstLock) {
      await waitFor(
        async () => (await blockedConnections(pool, [pids[0]])) === 1,
        'the first operation must reach its row lock before the second starts'
      );
    }
    let secondSettled = false;
    running.push(
      operations[1](connectionPool(second)).finally(() => {
        secondSettled = true;
      })
    );
    await waitFor(
      async () =>
        (waitForFirstLock && secondSettled) ||
        (await blockedConnections(pool, pids)) === 2,
      'both independent connections must contend before releasing the gate'
    );
    await beforeRelease();
    await gate.query('COMMIT');
    gateOpen = false;
    return await Promise.all(running);
  } finally {
    if (gateOpen) await gate.query('ROLLBACK');
    await Promise.allSettled(running);
    for (const client of clients) client.release();
  }
};

test(
  'manual publication reservations serialize the last place on disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    let sequence = 0;
    const createSlot = async (capacity = 1) => {
      const result = await createAdminPublicationSlot(pool, {
        feedTarget: 'openg7',
        channel: 'facebook',
        startsAt: new Date(Date.now() + 864000000).toISOString(),
        capacity
      });
      assert.equal(result.updated, true);
      return result.slot.id;
    };
    const createBatch = async ({ capacity = 1, slotId = null } = {}) => {
      const result = await pool.query(
        `INSERT INTO sponsor_publication_batches (channel, capacity, slot_id)
         VALUES ('facebook', $1, $2::uuid) RETURNING id::text AS id`,
        [capacity, slotId]
      );
      return result.rows[0].id;
    };
    const createDraft = async ({ batchId = null } = {}) => {
      sequence += 1;
      const contribution = await pool.query(
        `INSERT INTO fund_contributions (
          contribution_type, amount_cents, currency, status, stripe_session_id, sponsor_company_name
        ) VALUES ('sponsorship_interest', 10000, 'cad', 'paid', $1, $2)
        RETURNING id::text AS id`,
        [
          `cs_test_capacity_${sequence}`,
          `Synthetic capacity sponsor ${sequence}`
        ]
      );
      const result = await pool.query(
        `INSERT INTO sponsor_publication_drafts (
          contribution_id, feed_target, channel, title, body, disclosure_text,
          status, batch_id
        ) VALUES ($1::uuid, 'openg7', 'facebook', 'Synthetic capacity draft',
                  'Synthetic body', 'Synthetic disclosure', 'approved', $2::uuid)
        RETURNING id::text AS id`,
        [contribution.rows[0].id, batchId]
      );
      return result.rows[0].id;
    };
    const slotUsage = async (slotId) => {
      const result = await pool.query(
        `SELECT slot.capacity, COUNT(DISTINCT draft.id)::integer AS used
         FROM publication_slots slot
         LEFT JOIN sponsor_publication_batches batch ON batch.slot_id = slot.id
         LEFT JOIN sponsor_publication_drafts draft
           ON draft.slot_id = slot.id OR draft.batch_id = batch.id
         WHERE slot.id = $1::uuid GROUP BY slot.id`,
        [slotId]
      );
      return result.rows[0];
    };
    const assertOneReservation = (results) =>
      assert.equal(
        results.filter(({ updated }) => updated).length,
        1,
        'exactly one competing reservation may consume the last place'
      );

    await t.test('two drafts compete for the last batch place', async () => {
      const batchId = await createBatch();
      const ids = await Promise.all([createDraft(), createDraft()]);
      const results = await race(pool, {
        table: 'sponsor_publication_drafts',
        ids,
        operations: ids.map(
          (draftId) => (connection) =>
            assignDraftToPublicationBatch(connection, { batchId, draftId })
        )
      });
      assertOneReservation(results);
      const usage = await pool.query(
        'SELECT COUNT(*)::integer AS used FROM sponsor_publication_drafts WHERE batch_id=$1::uuid',
        [batchId]
      );
      assert.equal(usage.rows[0].used, 1);
    });

    await t.test(
      'two direct drafts compete for the last slot place',
      async () => {
        const slotId = await createSlot();
        const ids = await Promise.all([createDraft(), createDraft()]);
        assertOneReservation(
          await race(pool, {
            table: 'sponsor_publication_drafts',
            ids,
            operations: ids.map(
              (draftId) => (connection) =>
                assignDraftToPublicationSlot(connection, { slotId, draftId })
            )
          })
        );
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 1 });
      }
    );

    await t.test(
      'two collective batches compete for the last slot place',
      async () => {
        const slotId = await createSlot();
        const ids = await Promise.all([createBatch(), createBatch()]);
        for (const batchId of ids) await createDraft({ batchId });
        assertOneReservation(
          await race(pool, {
            table: 'sponsor_publication_batches',
            ids,
            operations: ids.map(
              (batchId) => (connection) =>
                assignBatchToPublicationSlot(connection, { slotId, batchId })
            )
          })
        );
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 1 });
      }
    );

    await t.test(
      'different batches share the same slot capacity guard',
      async () => {
        const slotId = await createSlot();
        const batchIds = await Promise.all([
          createBatch({ slotId }),
          createBatch({ slotId })
        ]);
        const ids = await Promise.all([createDraft(), createDraft()]);
        assertOneReservation(
          await race(pool, {
            table: 'sponsor_publication_drafts',
            ids,
            operations: ids.map(
              (draftId, index) => (connection) =>
                assignDraftToPublicationBatch(connection, {
                  batchId: batchIds[index],
                  draftId
                })
            )
          })
        );
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 1 });
      }
    );

    await t.test(
      'direct and collective reservations share the same last place',
      async () => {
        const slotId = await createSlot();
        const batchId = await createBatch({ slotId });
        const ids = await Promise.all([createDraft(), createDraft()]);
        assertOneReservation(
          await race(pool, {
            table: 'sponsor_publication_drafts',
            ids,
            operations: [
              (connection) =>
                assignDraftToPublicationSlot(connection, {
                  slotId,
                  draftId: ids[0]
                }),
              (connection) =>
                assignDraftToPublicationBatch(connection, {
                  batchId,
                  draftId: ids[1]
                })
            ]
          })
        );
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 1 });
      }
    );

    await t.test(
      'a newly attached batch invalidates a reservation that observed no slot',
      async () => {
        const slotId = await createSlot();
        const batchId = await createBatch({ capacity: 2 });
        await createDraft({ batchId });
        const draftId = await createDraft();
        const [association, addition] = await race(pool, {
          table: 'sponsor_publication_batches',
          ids: [batchId],
          waitForFirstLock: true,
          operations: [
            (connection) =>
              assignBatchToPublicationSlot(connection, { slotId, batchId }),
            (connection) =>
              assignDraftToPublicationBatch(connection, { batchId, draftId })
          ]
        });
        assert.equal(association.updated, true);
        assert.equal(addition.updated, false);
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 1 });
      }
    );

    await t.test(
      'capacity reduction waits for a reservation already in progress',
      async () => {
        const slotId = await createSlot(2);
        const assigned = await createDraft();
        assert.equal(
          (
            await assignDraftToPublicationSlot(pool, {
              slotId,
              draftId: assigned
            })
          ).updated,
          true
        );
        const draftId = await createDraft();
        const [assignment, reduction] = await race(pool, {
          table: 'sponsor_publication_drafts',
          ids: [draftId],
          waitForFirstLock: true,
          operations: [
            (connection) =>
              assignDraftToPublicationSlot(connection, { slotId, draftId }),
            (connection) =>
              updateAdminPublicationSlot(connection, { slotId, capacity: 1 })
          ]
        });
        assert.equal(assignment.updated, true);
        assert.equal(reduction.updated, false);
        assert.deepEqual(await slotUsage(slotId), { capacity: 2, used: 2 });
      }
    );

    await t.test(
      'a reservation blocked until after the slot date is refused',
      async () => {
        const slotId = await createSlot();
        const draftId = await createDraft();
        await pool.query(
          "UPDATE publication_slots SET starts_at=clock_timestamp()+interval '2 seconds' WHERE id=$1::uuid",
          [slotId]
        );
        const results = await race(pool, {
          table: 'sponsor_publication_drafts',
          ids: [draftId],
          waitForFirstLock: true,
          operations: [
            (connection) =>
              assignDraftToPublicationSlot(connection, { slotId, draftId }),
            (connection) =>
              updateAdminPublicationSlot(connection, { slotId, capacity: 2 })
          ],
          beforeRelease: () =>
            waitFor(async () => {
              const result = await pool.query(
                'SELECT starts_at <= clock_timestamp() AS elapsed FROM publication_slots WHERE id=$1::uuid',
                [slotId]
              );
              return result.rows[0].elapsed;
            }, 'the database clock must pass the slot date while the child is locked')
        });
        assert.deepEqual(
          results.map(({ updated }) => updated),
          [false, false]
        );
        assert.deepEqual(await slotUsage(slotId), { capacity: 1, used: 0 });
      }
    );

    await t.test(
      'active live completion and calendar update lock the delivery before its slot and batch',
      async () => {
        const slotId = await createSlot(2);
        const batchId = await createBatch();
        const draftId = await createDraft({ batchId });
        assert.equal(
          (await assignBatchToPublicationSlot(pool, { slotId, batchId }))
            .updated,
          true
        );
        const startsAt = new Date(Date.now() + 2500).toISOString();
        assert.equal(
          (await updateAdminPublicationSlot(pool, { slotId, startsAt }))
            .updated,
          true
        );
        await pool.query(
          `UPDATE fund_contributions SET sponsor_company_name='Synthetic capacity sponsor',
         amount_cents=25000,public_display_consent=TRUE,sponsor_review_status='approved'
         WHERE id=(SELECT contribution_id FROM sponsor_publication_drafts WHERE id=$1::uuid)`,
          [draftId]
        );
        const source = (
          await pool.query(
            `SELECT id::text,contribution_id::text,title,body,disclosure_text,feed_target,channel
         FROM sponsor_publication_drafts WHERE id=$1::uuid`,
            [draftId]
          )
        ).rows[0];
        await recordFixtureSponsorshipAgreement(pool, source.contribution_id, {
          channel: 'facebook'
        });
        await approveFixtureSubject(pool, {
          type: 'sponsorship',
          id: source.contribution_id
        });
        const message = composePublicationRecognition([
          {
            id: source.id,
            contributionId: source.contribution_id,
            name: 'Synthetic capacity sponsor',
            title: source.title,
            body: source.body,
            disclosureText: source.disclosure_text
          }
        ]);
        const initial = (
          await pool.query(
            `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,
         account_id,mode,source_snapshot,status,approved_at,approved_by)
         VALUES('openg7:facebook','sponsorship',$1::uuid,$2,$3::timestamptz,
         'synthetic-account','live',$4::jsonb,'draft',NULL,NULL) RETURNING *`,
            [batchId, message, startsAt, JSON.stringify([source])]
          )
        ).rows[0];
        await approveFixtureSubject(pool, {
          type: 'publication_delivery',
          id: initial.id
        });
        await withPostgresTransaction(pool, async (db) => {
          const snapshot = await capturePublicationObligations(db, initial);
          await reserveAccountSchedule(db, initial);
          await db.query(
            `UPDATE publication_deliveries SET obligation_snapshot=$2::jsonb,status='approved',
            version=version+1,approved_at=NOW(),approved_by='synthetic-reviewer' WHERE id=$1`,
            [initial.id, JSON.stringify(snapshot)]
          );
          await db.query(
            "UPDATE sponsor_publication_batches SET status='scheduled' WHERE id=$1",
            [batchId]
          );
        });
        await pool.query(
          "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
        );
        const [calendarClient, completionClient] = await Promise.all([
          pool.connect(),
          pool.connect()
        ]);
        const calendarPid = (
          await calendarClient.query('SELECT pg_backend_pid() AS pid')
        ).rows[0].pid;
        const completionNeedsSlot = barrier();
        const resumeCompletion = barrier();
        let calendarHeldSlot = false;
        const calendarQueries = [];
        let calendarOutcome;
        let completionOutcome;
        const calendarPool = {
          query: (...args) => pool.query(...args),
          connect: async () => ({
            async query(sql, values) {
              calendarQueries.push(sql);
              const result = await calendarClient.query(sql, values);
              if (
                sql.includes('FROM publication_slots') &&
                sql.includes('FOR UPDATE')
              ) {
                calendarHeldSlot = true;
              }
              return result;
            },
            release() {}
          })
        };
        const completionPool = {
          connect: async () => ({
            async query(sql, values) {
              // Completion holds the active delivery before requesting its slot.
              if (
                (sql.includes('FROM publication_slots') &&
                  sql.includes('FOR UPDATE')) ||
                sql.startsWith('UPDATE publication_slots')
              ) {
                completionNeedsSlot.open();
                await resumeCompletion.promise;
              }
              return completionClient.query(sql, values);
            },
            release() {}
          })
        };
        const outcome = (operation, onSettled = () => {}) =>
          operation.then(
            (value) => {
              onSettled();
              return { status: 'fulfilled', value };
            },
            (reason) => {
              onSettled();
              return { status: 'rejected', reason };
            }
          );
        try {
          await waitFor(
            async () =>
              (
                await pool.query(
                  'SELECT $1::timestamptz <= clock_timestamp() AS due',
                  [startsAt]
                )
              ).rows[0].due,
            'the delivery must be due before taking its active claim'
          );
          const row = await claimNextDelivery(
            {
              pool,
              workerSettings: async () => ({ enabled: true, version: 1 })
            },
            new Date()
          );
          assert.equal(row?.id, initial.id);
          const providerResult = {
            externalPostId: 'synthetic-capacity-post',
            externalPostUrl: 'https://example.test/capacity-post'
          };
          await observeProviderResult({ pool }, row, providerResult);
          completionOutcome = outcome(
            withPostgresTransaction(completionPool, async (db) => {
              await complete(
                db,
                row,
                providerResult.externalPostId,
                providerResult.externalPostUrl,
                'synthetic-worker',
                row.version
              );
            })
          );
          await waitFor(
            async () => completionNeedsSlot.opened,
            'completion must request its slot lock'
          );
          calendarOutcome = outcome(
            updateAdminPublicationSlot(calendarPool, { slotId, capacity: 3 })
          );
          await waitFor(
            async () => (await blockedConnections(pool, [calendarPid])) === 1,
            'the calendar must wait on the delivery while completion owns it'
          );
          assert.equal(
            calendarHeldSlot,
            false,
            'no slot lock may precede the delivery lock'
          );
          assert.ok(
            calendarQueries.some((sql) =>
              sql.includes('FOR UPDATE OF delivery')
            )
          );
          resumeCompletion.open();
          const outcomes = await Promise.all([
            calendarOutcome,
            completionOutcome
          ]);
          for (const result of outcomes)
            assert.equal(result.status, 'fulfilled', result.reason?.message);
          assert.equal(
            outcomes[0].value.updated,
            false,
            'the completed, elapsed slot cannot change capacity'
          );
          const delivered = (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE id=$1',
              [initial.id]
            )
          ).rows[0];
          assert.equal(delivered.status, 'published');
          assert.equal(
            delivered.external_post_id,
            providerResult.externalPostId
          );
          const projections = await pool.query(
            `SELECT batch.status AS batch_status,draft.status AS draft_status,slot.status AS slot_status,
           slot.capacity FROM sponsor_publication_batches batch
           JOIN sponsor_publication_drafts draft ON draft.batch_id=batch.id
           JOIN publication_slots slot ON slot.id=batch.slot_id WHERE batch.id=$1::uuid`,
            [batchId]
          );
          assert.deepEqual(projections.rows[0], {
            batch_status: 'published',
            draft_status: 'published',
            slot_status: 'published',
            capacity: 2
          });
          const audits = (
            await pool.query(
              "SELECT action FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.provider_result_observed','publication_automation.published') ORDER BY action",
              [initial.id]
            )
          ).rows.map(({ action }) => action);
          assert.deepEqual(audits, [
            'publication_automation.provider_result_observed',
            'publication_automation.published'
          ]);
        } finally {
          resumeCompletion.open();
          await Promise.allSettled([calendarOutcome, completionOutcome]);
          calendarClient.release();
          completionClient.release();
        }
      }
    );
  }
);
