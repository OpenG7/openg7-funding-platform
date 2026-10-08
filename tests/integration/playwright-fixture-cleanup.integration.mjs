import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ACCOUNTING_FIXTURES,
  BACKFILL_FIXTURES,
  EMAIL_QUEUE_FIXTURE,
  SPONSORSHIP_FIXTURES,
  WEBHOOK_FIXTURES
} from '../playwright/fixtures/e2e-fixtures.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

// Capture the actual seed/cleanup SQL before Docker or the Stripe stub is
// reached. Execute it only against this test's disposable PostgreSQL instance.
function seedSql(cleanup) {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import childProcess from 'node:child_process';
       import { writeSync } from 'node:fs';
       import { syncBuiltinESMExports } from 'node:module';
       childProcess.spawnSync = (command, args, options) => {
         if (command !== 'docker' || !args.includes('psql')) process.exit(1);
         writeSync(1, options.input);
         process.exit(0);
       };
       syncBuiltinESMExports();
       ${cleanup ? "process.argv.push('--cleanup');" : ''}
       await import('./scripts/e2e-seed.mjs');`
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        OPENG7_E2E_ENV_FILE: join(tmpdir(), `absent-e2e-${randomUUID()}.env`)
      }
    }
  );
}

function probeSeedCli({
  cleanup = false,
  sqlStatus = 0,
  stubFailureAt = 0
} = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import childProcess from 'node:child_process';
       import { writeSync } from 'node:fs';
       import { syncBuiltinESMExports } from 'node:module';
       const events = [];
       const messages = [];
       let stubCalls = 0;
       console.log = (message) => messages.push(message);
       console.error = (message) => messages.push(message);
       process.on('exit', () => writeSync(1, JSON.stringify({ events, messages })));
       childProcess.spawnSync = (command, args, options) => {
         events.push({ type: 'sql', command, args, input: options.input });
         return { status: ${JSON.stringify(sqlStatus)} };
       };
       syncBuiltinESMExports();
       globalThis.fetch = async (url, options) => {
         events.push({ type: 'stub', path: new URL(url).pathname,
           payload: options.body ? JSON.parse(options.body) : null });
         return { ok: ++stubCalls !== ${stubFailureAt}, status: 503,
           text: async () => 'synthetic stub failure' };
       };
       ${cleanup ? "process.argv.push('--cleanup');" : ''}
       await import('./scripts/e2e-seed.mjs');`
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        OPENG7_E2E_ENV_FILE: join(tmpdir(), `absent-e2e-${randomUUID()}.env`)
      }
    }
  );
  assert.ifError(result.error);
  return { status: result.status, ...JSON.parse(result.stdout) };
}

test('fixture plan modules import without environment, database or network effects', () => {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import childProcess from 'node:child_process';
       import { syncBuiltinESMExports } from 'node:module';
       const unexpected = () => { throw new Error('Unexpected import effect'); };
       childProcess.spawnSync = unexpected;
       syncBuiltinESMExports();
       globalThis.fetch = unexpected;
       const environment = process.env;
       process.env = new Proxy(environment, {
         get: (target, name) => name === 'WATCH_REPORT_DEPENDENCIES'
           ? Reflect.get(target, name) : unexpected()
       });
       try {
         await import('./scripts/lib/e2e-seed/plan.mjs');
         await import('./scripts/lib/e2e-seed/stripe-stub.mjs');
       } finally {
         process.env = environment;
       }`
    ],
    { windowsHide: true, stdio: 'pipe' }
  );
});

test('seed CLI runs one SQL transaction before resetting and populating the stub', () => {
  const result = probeSeedCli();
  assert.equal(result.status, 0);
  const [database, reset, ...registrations] = result.events;
  assert.equal(database.type, 'sql');
  assert.equal(database.command, 'docker');
  assert.deepEqual(database.args.slice(0, 9), [
    'compose',
    '--profile',
    'database',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1'
  ]);
  assert.equal((database.input.match(/^BEGIN;/gm) ?? []).length, 1);
  assert.equal((database.input.match(/^COMMIT;/gm) ?? []).length, 1);
  assert.ok(database.input.startsWith('BEGIN;\n'));
  assert.ok(database.input.endsWith('\nCOMMIT;'));
  assert.equal(reset.path, '/__test__/reset');
  assert.ok(registrations.length > 0);
  assert.ok(registrations.every((event) => event.type === 'stub'));
  assert.deepEqual(result.messages, [
    `Seeded ${Object.values(SPONSORSHIP_FIXTURES).length} Playwright sponsorship fixture(s) and 1 email queue fixture.`,
    'Seeded the Stripe stub fixtures.'
  ]);
});

test('cleanup CLI commits its SQL before issuing only the stub reset', () => {
  const result = probeSeedCli({ cleanup: true });
  assert.equal(result.status, 0);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ['sql', 'stub']
  );
  assert.equal(result.events[1].path, '/__test__/reset');
  assert.equal(result.events[1].payload, null);
  assert.ok(result.events[0].input.endsWith('\nCOMMIT;'));
  assert.deepEqual(result.messages, [
    'Removed Playwright sponsorship and email queue fixtures.',
    'Reset the Stripe stub.'
  ]);
});

test('SQL failures preserve the CLI exit code and prevent every stub call', () => {
  for (const cleanup of [false, true]) {
    for (const sqlStatus of [17, null]) {
      const result = probeSeedCli({ cleanup, sqlStatus });
      assert.equal(result.status, sqlStatus ?? 1);
      assert.deepEqual(
        result.events.map((event) => event.type),
        ['sql']
      );
      assert.deepEqual(result.messages, [
        cleanup
          ? 'Failed to remove Playwright sponsorship fixtures.'
          : 'Failed to seed Playwright sponsorship fixtures.'
      ]);
    }
  }
});

test('stub failure stops the CLI after SQL success without later registrations', () => {
  const result = probeSeedCli({ stubFailureAt: 3 });
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ['sql', 'stub', 'stub', 'stub']
  );
  assert.equal(
    result.messages.at(-1),
    'Failed to seed the Stripe stub (tests/stripe-stub/). Is docker-compose.e2e.yml up?'
  );
});

test(
  'Playwright fixture cleanup respects publication guards',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const client = await database.pool.connect();
    t.after(async () => {
      client.release();
      await database.stop();
    });
    const seed = seedSql(false);
    const cleanup = seedSql(true);
    const dependencyTables = [
      'sponsorship_refund_operations',
      'contribution_activity',
      'contribution_activity_history',
      'contribution_sms_deliveries',
      'contribution_activity_presentations'
    ];
    async function run(sql) {
      try {
        return await client.query(sql);
      } catch (error) {
        // psql disconnects on ON_ERROR_STOP, rolling back the failed transaction.
        await client.query('ROLLBACK');
        throw error;
      }
    }
    async function reset() {
      await client.query(`TRUNCATE fund_contributions, sponsor_publication_batches,
      publication_deliveries, publication_recurrences,
      publication_editorial_observations CASCADE`);
      await run(seed);
    }
    async function contribution(publicReference, contactEmail = null) {
      return (
        await client.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,status,
            public_reference,sponsor_contact_email)
       VALUES('sponsorship_interest',25000,'paid',$1,$2) RETURNING id`,
          [publicReference, contactEmail]
        )
      ).rows[0].id;
    }
    async function fixtureId(
      publicReference = SPONSORSHIP_FIXTURES.publicationBatch.publicReference
    ) {
      return (
        await client.query(
          'SELECT id FROM fund_contributions WHERE public_reference=$1',
          [publicReference]
        )
      ).rows[0]?.id;
    }
    async function financialDependencies(contributionId, status = 'succeeded') {
      await client.query(
        `INSERT INTO sponsorship_refund_operations(contribution_id,expected_version,
          payment_intent_id,amount_minor,currency,reason,actor,status)
        VALUES($1,$2,$3,1,'cad','Disposable cleanup regression','fixture-cleanup-test',$4)`,
        [contributionId, randomUUID(), `pi_cleanup_${contributionId}`, status]
      );
      const activityId = (
        await client.query(
          `INSERT INTO contribution_activity(contribution_id,amount_minor,currency,confirmed_at)
          VALUES($1,1,'cad',NOW()) RETURNING id`,
          [contributionId]
        )
      ).rows[0].id;
      for (const sql of [
        `INSERT INTO contribution_activity_history(activity_id,revision,state,reasons)
        VALUES($1,0,'blocked','[]')`,
        `INSERT INTO contribution_sms_deliveries(activity_id) VALUES($1)`,
        `INSERT INTO contribution_activity_presentations(activity_id,actor)
        VALUES($1,'fixture-cleanup-test')`
      ]) {
        await client.query(sql, [activityId]);
      }
    }
    async function publication(
      contributionIds,
      status = 'approved',
      mode = 'mock'
    ) {
      const batchId = (
        await client.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',5) RETURNING id"
        )
      ).rows[0].id;
      for (const id of contributionIds) {
        await client.query(
          `INSERT INTO sponsor_publication_drafts
        (contribution_id,batch_id,feed_target,channel,title,body,disclosure_text)
        VALUES($1,$2,'openg7','facebook','Fixture','Fixture','Fixture')`,
          [id, batchId]
        );
      }
      const mediaId =
        (
          await client.query(
            'SELECT id FROM sponsor_media_assets WHERE contribution_id=$1 LIMIT 1',
            [contributionIds[0]]
          )
        ).rows[0]?.id ?? null;
      const deliveryId = (
        await client.query(
          `INSERT INTO publication_deliveries
      (feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,media_id,media_snapshot)
      VALUES('openg7:facebook','sponsorship',$1,'Fixture',NOW(),'fixture-account',$2,$3,$4,$5) RETURNING id`,
          [batchId, mode, status, mediaId, mediaId ? '{}' : null]
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO publication_editorial_observations(delivery_id,feed_id,intent)
      VALUES($1,'openg7:facebook','concise')`,
        [deliveryId]
      );
      await client.query(
        `INSERT INTO publication_recurrences(feed_id,starts_at,batch_id)
      VALUES('openg7:facebook',NOW(),$1)`,
        [batchId]
      );
      return { batchId, deliveryId };
    }
    async function snapshot(
      tables = [
        'fund_contributions',
        'sponsor_media_assets',
        'sponsor_publication_drafts',
        'sponsor_publication_batches',
        'publication_deliveries',
        'publication_editorial_observations',
        'publication_recurrences',
        'email_messages',
        'fund_allocations',
        'fund_transactions',
        'stripe_events',
        'stripe_checkout_sessions',
        ...dependencyTables
      ]
    ) {
      const result = {};
      for (const table of tables) {
        result[table] = (
          await client.query(`SELECT * FROM ${table} ORDER BY 1,2`)
        ).rows;
      }
      return result;
    }

    for (const action of ['cleanup', 'reseed']) {
      await t.test(
        `${action} removes fixture refund and activity dependencies while preserving foreign records`,
        async () => {
          await reset();
          const outsideId = await contribution(`outside-${randomUUID()}`);
          await financialDependencies(outsideId, 'uncertain');
          const outsideDependencies = await snapshot(dependencyTables);
          const outsideContribution = async () =>
            (
              await client.query(
                'SELECT * FROM fund_contributions WHERE id=$1',
                [outsideId]
              )
            ).rows;
          const outsideBefore = await outsideContribution();
          const fixtures = [
            SPONSORSHIP_FIXTURES.refund,
            WEBHOOK_FIXTURES.idempotence,
            WEBHOOK_FIXTURES.replaySponsorship,
            ACCOUNTING_FIXTURES.scenario,
            ACCOUNTING_FIXTURES.excludedExpired,
            BACKFILL_FIXTURES.matchedSession,
            BACKFILL_FIXTURES.sponsorshipSession
          ];
          const statuses = [
            'submitting',
            'uncertain',
            'pending',
            'succeeded',
            'failed'
          ];
          const ids = [];
          for (const [index, fixture] of fixtures.entries()) {
            const id =
              (await fixtureId(fixture.publicReference)) ??
              (await contribution(fixture.publicReference));
            ids.push(id);
            await financialDependencies(id, statuses[index % statuses.length]);
          }
          // A prior run may retain a changed reference with its fixture email.
          const emailOnlyId = await contribution(
            `email-only-${randomUUID()}`,
            SPONSORSHIP_FIXTURES.refund.contactEmail
          );
          ids.push(emailOnlyId);
          await financialDependencies(emailOnlyId, 'failed');
          await assert.rejects(
            client.query('DELETE FROM fund_contributions WHERE id=$1', [
              ids[0]
            ]),
            { code: '23503' }
          );
          const sql = action === 'cleanup' ? cleanup : seed;
          for (let repeat = 0; repeat < 2; repeat += 1) {
            await run(sql);
            assert.deepEqual(
              await snapshot(dependencyTables),
              outsideDependencies
            );
            assert.deepEqual(await outsideContribution(), outsideBefore);
            assert.equal(
              (
                await client.query(
                  'SELECT id FROM fund_contributions WHERE id=ANY($1::uuid[])',
                  [ids]
                )
              ).rowCount,
              0
            );
          }
        }
      );
      for (const status of ['approved', 'publishing', 'uncertain']) {
        await t.test(
          `${action} removes ${status} fixture publications and preserves unrelated authorizations`,
          async () => {
            await reset();
            const id = await fixtureId();
            const fixturePublication = await publication([id], status);
            const outsideId = await contribution(`outside-${randomUUID()}`);
            const outside = await publication([outsideId]);
            const outsideBefore = (
              await client.query(
                'SELECT * FROM publication_deliveries WHERE id=$1',
                [outside.deliveryId]
              )
            ).rows;
            await assert.rejects(
              client.query('DELETE FROM fund_contributions WHERE id=$1', [id]),
              { code: '55000' }
            );
            const sql = action === 'cleanup' ? cleanup : seed;
            await run(sql);
            await run(sql); // Both entry points remain repeatable.
            assert.equal(
              (
                await client.query(
                  'SELECT id FROM publication_deliveries WHERE id=$1',
                  [fixturePublication.deliveryId]
                )
              ).rowCount,
              0
            );
            assert.equal(
              (
                await client.query(
                  'SELECT id FROM sponsor_publication_batches WHERE id=$1',
                  [fixturePublication.batchId]
                )
              ).rowCount,
              0
            );
            assert.equal(
              (
                await client.query(
                  'SELECT id FROM fund_contributions WHERE public_reference=$1',
                  [SPONSORSHIP_FIXTURES.publicationBatch.publicReference]
                )
              ).rowCount,
              action === 'cleanup' ? 0 : 1
            );
            assert.deepEqual(
              (
                await client.query(
                  'SELECT * FROM publication_deliveries WHERE id=$1',
                  [outside.deliveryId]
                )
              ).rows,
              outsideBefore
            );
            await assert.rejects(
              client.query('DELETE FROM fund_contributions WHERE id=$1', [
                outsideId
              ]),
              { code: '55000' }
            );
          }
        );
      }
    }

    await t.test(
      'cleans publications created from webhook and backfill fixtures',
      async () => {
        await reset();
        const ids = [];
        for (const fixture of [
          WEBHOOK_FIXTURES.replaySponsorship,
          BACKFILL_FIXTURES.sponsorshipSession
        ]) {
          ids.push(await contribution(fixture.publicReference));
        }
        const { batchId } = await publication(ids);
        await run(cleanup);
        assert.equal(
          (
            await client.query(
              'SELECT id FROM fund_contributions WHERE id=ANY($1::uuid[])',
              [ids]
            )
          ).rowCount,
          0
        );
        assert.equal(
          (
            await client.query(
              'SELECT id FROM sponsor_publication_batches WHERE id=$1',
              [batchId]
            )
          ).rowCount,
          0
        );
      }
    );

    await t.test(
      'repeated seed and cleanup preserve foreign accounting records and the permanent sentinel',
      async () => {
        await reset();
        const foreign = `foreign-${randomUUID()}`;
        const eventId = WEBHOOK_FIXTURES.idempotence.stripeEventId;
        const objectId = BACKFILL_FIXTURES.matchedSession.stripePaymentIntentId;
        const sessionId = BACKFILL_FIXTURES.matchedSession.stripeSessionId;
        for (const id of [foreign, eventId]) {
          await client.query(
            `INSERT INTO stripe_events(stripe_event_id,event_type,payload)
             VALUES($1,'payment_intent.succeeded','{}')`,
            [id]
          );
        }
        for (const [event, object] of [
          [foreign, foreign],
          [eventId, foreign],
          [`backfill-${foreign}`, objectId]
        ]) {
          await client.query(
            `INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,
             amount,net,currency,status,created_at,public_category)
             VALUES($1,$2,'charge.refunded',1,1,'cad','succeeded',NOW(),'refund')`,
            [event, object]
          );
        }
        for (const id of [foreign, sessionId]) {
          await client.query(
            `INSERT INTO stripe_checkout_sessions(stripe_session_id,
             contribution_type,amount_cents) VALUES($1,'personal_support',1)`,
            [id]
          );
        }
        await client.query(
          `INSERT INTO fund_allocations(project_name,public_description,
           amount_allocated,currency) VALUES($1,'Foreign fixture',1,'cad')`,
          [foreign]
        );
        await client.query(
          `INSERT INTO email_messages(idempotency_key,template_key,
           recipient_email,from_email,subject,text_body,html_body,status)
           VALUES($1,$2,'foreign@example.invalid','sender@example.invalid',
           'Foreign fixture','Foreign fixture','<p>Foreign fixture</p>','queued')`,
          [foreign, EMAIL_QUEUE_FIXTURE.templateKey]
        );
        const identities = [
          ['stripe_events', 'stripe_event_id', foreign],
          ['fund_transactions', 'stripe_event_id', foreign],
          ['stripe_checkout_sessions', 'stripe_session_id', foreign],
          ['fund_allocations', 'project_name', foreign],
          ['email_messages', 'idempotency_key', foreign],
          [
            'fund_transactions',
            'stripe_event_id',
            'e2e-playwright-ledger-sentinel'
          ]
        ];
        const selectedRows = async () => {
          const result = [];
          for (const [table, column, identity] of identities) {
            result.push(
              (
                await client.query(
                  `SELECT * FROM ${table} WHERE ${column}=$1`,
                  [identity]
                )
              ).rows
            );
          }
          return result;
        };
        const before = await selectedRows();
        assert.ok(before.every((rows) => rows.length === 1));
        for (const sql of [seed, seed, cleanup, cleanup]) {
          await run(sql);
          assert.deepEqual(await selectedRows(), before);
          for (const [table, column, identity] of [
            ['stripe_events', 'stripe_event_id', eventId],
            ['fund_transactions', 'stripe_event_id', eventId],
            ['fund_transactions', 'stripe_object_id', objectId],
            ['stripe_checkout_sessions', 'stripe_session_id', sessionId]
          ]) {
            assert.equal(
              (
                await client.query(
                  `SELECT id FROM ${table} WHERE ${column}=$1`,
                  [identity]
                )
              ).rowCount,
              0
            );
          }
        }
      }
    );

    await t.test(
      'rolls back publication, contribution and accounting changes after a late failure',
      async () => {
        for (const sql of [seed, cleanup]) {
          await reset();
          const fixture = await fixtureId();
          await publication([fixture]);
          await financialDependencies(fixture);
          const id = await contribution(
            BACKFILL_FIXTURES.matchedSession.publicReference
          );
          await client.query(`CREATE TABLE fixture_cleanup_blocker (
          contribution_id UUID REFERENCES fund_contributions(id)
        )`);
          try {
            await client.query(
              'INSERT INTO fixture_cleanup_blocker VALUES($1)',
              [id]
            );
            const before = await snapshot();
            await assert.rejects(run(sql), { code: '23503' });
            assert.deepEqual(await snapshot(), before);
          } finally {
            await client.query('DROP TABLE fixture_cleanup_blocker');
          }
        }
      }
    );

    await t.test(
      'rejects shared batches without partially cleaning the database',
      async () => {
        await reset();
        const fixture = await fixtureId();
        await financialDependencies(fixture, 'pending');
        const outsideId = await contribution(`outside-${randomUUID()}`);
        await financialDependencies(outsideId, 'uncertain');
        await publication([fixture, outsideId]);
        const before = await snapshot();
        await assert.rejects(
          run(cleanup),
          /shared with non-fixture contributions/
        );
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'rejects live publications without removing fixtures',
      async () => {
        await reset();
        const fixture = await fixtureId();
        await financialDependencies(fixture, 'submitting');
        await publication([fixture], 'approved', 'live');
        const before = await snapshot();
        await assert.rejects(run(cleanup), /live or non-fixture publications/);
        assert.deepEqual(await snapshot(), before);
      }
    );
  }
);
