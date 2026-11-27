import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAdminLoadOptions,
  safeLoadFailure,
  summarizeLatencies
} from '../scripts/lib/admin-load-profile.mjs';
import {
  publicationBacklogCounts,
  BACKLOG_COUNTS
} from './integration/support/publication-backlog-performance.fixtures.mjs';
import { startDisposablePostgres } from './integration/support/disposable-postgres.mjs';
import { profilePublicationPool } from './integration/support/publication-query-profile.mjs';

test('failed pool acquisitions have separate counters and safe timeout classification', async () => {
  const pool = {
    waitingCount: 1,
    totalCount: 1,
    connect: async () => {
      throw new Error('timeout exceeded when trying to connect');
    }
  };
  const p = profilePublicationPool(pool);
  await assert.rejects(
    p.measure('pool_timeout', () => p.port.query('SELECT 1'))
  );
  assert.equal(p.measurements[0].poolFailedAcquisitions, 1);
  assert.equal(p.measurements[0].queryCount, 0);
  assert.equal(
    safeLoadFailure(new Error('timeout exceeded when trying to connect')),
    'POOL_ACQUIRE_TIMEOUT'
  );
});
test('unsafe connection timeouts fail before Docker access', async () => {
  for (const connectionTimeoutMillis of [0, 30001, 1.5, '1000'])
    await assert.rejects(
      startDisposablePostgres({ connectionTimeoutMillis }),
      /connection timeout/
    );
});

test('controlled load defaults to a nonexecuting plan and refuses external targets or unbounded load', () => {
  const options = parseAdminLoadOptions([]);
  assert.equal(options.run, false);
  assert.deepEqual(options.profiles, [100, 1000, 10000]);
  assert.deepEqual(
    parseAdminLoadOptions([
      '--run',
      '--profiles=10000,100',
      '--samples=2',
      '--pool-size=1',
      '--concurrency=2'
    ]).profiles,
    [100, 10000]
  );
  for (const args of [
    ['--url=https://example.invalid'],
    ['--profiles=10001'],
    ['--profiles=100,100'],
    ['--samples=0'],
    ['--samples=11'],
    ['--pool-size=17'],
    ['--concurrency=0'],
    ['--statement-timeout-ms=60001'],
    ['--run', '--plan'],
    ['--run', '--run'],
    ['--toString=1'],
    ['--plan=true']
  ])
    assert.throws(() => parseAdminLoadOptions(args));
});
test('profile fixture scales exact quantities while preserving the legacy 3,000 dossier contract', () => {
  assert.deepEqual(BACKLOG_COUNTS, {
    dossiers: 3000,
    obligations: 6000,
    deliveries: 2000,
    batches: 150,
    members: 750,
    uncertain: 20
  });
  for (const n of [100, 1000, 10000]) {
    const c = publicationBacklogCounts(n);
    assert.equal(c.obligations, 2 * n);
    assert.equal(c.members, 5 * c.batches);
    assert.ok(c.deliveries > c.batches);
    assert.ok(c.uncertain > 0 && c.uncertain < c.deliveries);
  }
  for (const n of [0, 100.1, 10001, '100', -1])
    assert.throws(() => publicationBacklogCounts(n));
});
test('percentiles expose sample size and never turn an empty sample into a zero latency', () => {
  assert.deepEqual(summarizeLatencies([]), {
    samples: 0,
    minMs: null,
    medianMs: null,
    p95Ms: null,
    maxMs: null
  });
  const s = summarizeLatencies([9, 1, 3, 5]);
  assert.equal(s.medianMs, 4);
  assert.equal(s.p95Ms, 9);
  assert.equal(s.samples, 4);
  assert.equal(
    safeLoadFailure({ code: '57014', message: 'private' }),
    'STATEMENT_TIMEOUT'
  );
  assert.equal(
    safeLoadFailure(new Error('private credentials')),
    'MEASUREMENT_UNAVAILABLE'
  );
});
test('invalid disposable pool limits are rejected before any Docker access', async () => {
  for (const maxConnections of [0, 17, '2', 1.5])
    await assert.rejects(
      startDisposablePostgres({ maxConnections }),
      /pool size/
    );
});
test('query profiling separates pool acquisition from query execution and releases failed requests', async () => {
  let borrowed = 0,
    releases = 0;
  const source = {
    waitingCount: 0,
    totalCount: 1,
    async connect() {
      borrowed++;
      return {
        query: async (text) => {
          if (text === 'fail') throw new Error('synthetic');
          return { rows: [], rowCount: 0 };
        },
        release: () => {
          releases++;
        }
      };
    }
  };
  const p = profilePublicationPool(source);
  await p.measure('read', () => p.port.query('SELECT 1'));
  await assert.rejects(p.measure('failed', () => p.port.query('fail')));
  assert.equal(borrowed, 2);
  assert.equal(releases, 2);
  assert.equal(p.measurements[0].poolAcquisitions, 1);
  assert.equal(p.measurements[0].queryCount, 1);
  assert.equal(p.measurements[1].failedQueries, 1);
  assert.ok(p.measurements[0].poolAcquireTimeMs >= 0);
});
