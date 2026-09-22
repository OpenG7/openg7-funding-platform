import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BACKFILL_FIXTURES,
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
    async function contribution(publicReference) {
      return (
        await client.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,status,public_reference)
       VALUES('sponsorship_interest',25000,'paid',$1) RETURNING id`,
          [publicReference]
        )
      ).rows[0].id;
    }
    async function fixtureId() {
      return (
        await client.query(
          'SELECT id FROM fund_contributions WHERE public_reference=$1',
          [SPONSORSHIP_FIXTURES.publicationBatch.publicReference]
        )
      ).rows[0].id;
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
    async function snapshot() {
      const result = {};
      for (const table of [
        'fund_contributions',
        'sponsor_media_assets',
        'sponsor_publication_drafts',
        'sponsor_publication_batches',
        'publication_deliveries',
        'publication_editorial_observations',
        'publication_recurrences',
        'email_messages'
      ]) {
        result[table] = (
          await client.query(`SELECT * FROM ${table} ORDER BY 1,2`)
        ).rows;
      }
      return result;
    }

    for (const action of ['cleanup', 'reseed']) {
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
      'rolls back earlier publication and contribution deletions after a late failure',
      async () => {
        await reset();
        const id = await fixtureId();
        await publication([id]);
        await client.query(`CREATE TABLE fixture_cleanup_blocker (
          contribution_id UUID REFERENCES fund_contributions(id)
        )`);
        try {
          await client.query('INSERT INTO fixture_cleanup_blocker VALUES($1)', [
            id
          ]);
          const before = await snapshot();
          await assert.rejects(run(cleanup), { code: '23503' });
          assert.deepEqual(await snapshot(), before);
        } finally {
          await client.query('DROP TABLE fixture_cleanup_blocker');
        }
      }
    );

    await t.test(
      'rejects shared batches without partially cleaning the database',
      async () => {
        await reset();
        const outsideId = await contribution(`outside-${randomUUID()}`);
        await publication([await fixtureId(), outsideId]);
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
        await publication([await fixtureId()], 'approved', 'live');
        const before = await snapshot();
        await assert.rejects(run(cleanup), /live or non-fixture publications/);
        assert.deepEqual(await snapshot(), before);
      }
    );
  }
);
