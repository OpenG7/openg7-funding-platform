import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildCockpitMetrics,
  getCockpitMetrics
} from '../dist/apps/funding-api/src/admin-cockpit/metrics.js';
import { createCockpitSystemsReader } from '../dist/apps/funding-api/src/admin-cockpit/systems.js';
import { connectForRead } from '../dist/apps/funding-api/src/admin-cockpit/read.js';
import { createSponsorMediaStorage } from '../dist/apps/funding-api/src/sponsor-media-storage.js';

const now = new Date('2026-09-16T14:00:00Z');
const payment = {
  currency: 'CAD',
  amount: 20000,
  fee: 600,
  refunded: 0,
  disputed: false,
  sponsorship: true,
  day: '2026-09-01'
};

test('cockpit keeps currencies separate, compares complete days and defines net before refunds', () => {
  const result = buildCockpitMetrics(
    [
      payment,
      { ...payment, amount: 10000, fee: 300, day: '2026-08-01' },
      { ...payment, currency: 'USD', fee: null, refunded: 1000, disputed: true }
    ],
    8,
    [],
    now
  );
  assert.deepEqual(result.period, { start: '2026-08-17', end: '2026-09-15' });
  const [cad, usd] = result.currencies;
  assert.equal(cad.grossMinor, 30000);
  assert.equal(cad.netReceivedMinor, 29100);
  assert.equal(cad.grossTrend.percent, 100);
  assert.equal(cad.netTrend.percent, 100);
  assert.equal(cad.grossTrend.series.length, 30);
  assert.equal(usd.grossMinor, 20000);
  assert.equal(usd.refundedMinor, 1000);
  assert.equal(usd.disputedMinor, 20000);
  assert.equal(usd.netReceivedMinor, null);
  assert.equal(usd.netAfterRefundsMinor, null);
  assert.equal(usd.missingFeeCount, 1);
});

test('late fees complete the receipt period without inventing a previous zero-period percentage', () => {
  const missing = buildCockpitMetrics([{ ...payment, fee: null }], 0, [], now)
    .currencies[0];
  assert.equal(missing.netTrend.current, null);
  assert.equal(
    missing.netTrend.series.find((p) => p.day === payment.day).value,
    null
  );
  const complete = buildCockpitMetrics([payment], 0, [], now).currencies[0];
  assert.equal(complete.netTrend.current, 19400);
  assert.equal(complete.netTrend.previous, 0);
  assert.equal(complete.netTrend.percent, null);
  assert.equal(
    complete.netTrend.series.find((p) => p.day === payment.day).value,
    19400
  );
});

test('today is excluded from comparisons and Toronto calendar periods survive DST', () => {
  const result = buildCockpitMetrics(
    [{ ...payment, day: '2026-03-09' }],
    0,
    [],
    new Date('2026-03-10T02:00:00Z')
  );
  assert.equal(result.period.end, '2026-03-08');
  assert.equal(result.currencies[0].grossMinor, 20000);
  assert.equal(result.currencies[0].grossTrend.current, 0);
  assert.equal(
    new Set(result.currencies[0].grossTrend.series.map((p) => p.day)).size,
    30
  );
});

test('undated payments invalidate affected trends and unsafe amounts fail closed', async () => {
  const result = buildCockpitMetrics([{ ...payment, day: null }], 0, [], now);
  assert.ok(result.warnings.includes('undated_payments'));
  assert.equal(result.currencies[0].grossTrend.current, null);
  for (const patch of [
    { amount: 1.5 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { refunded: 20001 },
    { fee: -1 },
    { inconsistentRefundCurrency: true }
  ]) {
    assert.throws(() =>
      buildCockpitMetrics([{ ...payment, ...patch }], 0, [], now)
    );
  }
  assert.equal((await getCockpitMetrics(null, now)).available, false);
});

const ports = () => ({
  stripeConfigured: true,
  emailConfigured: true,
  databaseConfigured: true,
  storageProvider: 'Local',
  database: async () => {},
  storage: async () => {},
  stripe: async () => ({ lastSuccess: now.toISOString(), issues: 0 }),
  email: async () => ({ lastSuccess: null, issues: 0 })
});
test('configuration alone never turns a system green and a failed probe does not hide other systems', async () => {
  const result = await createCockpitSystemsReader(
    {
      ...ports(),
      storage: async () => {
        throw new Error('private path and credentials');
      }
    },
    () => now
  )();
  assert.equal(result.systems.find((s) => s.id === 'email').state, 'unknown');
  assert.equal(
    result.systems.find((s) => s.id === 'stripe').state,
    'operational'
  );
  assert.equal(
    result.systems.find((s) => s.id === 'database').state,
    'operational'
  );
  assert.equal(
    result.systems.find((s) => s.id === 'storage').state,
    'unavailable'
  );
  assert.ok(!JSON.stringify(result).includes('credentials'));
});
test('system observations expire, errors degrade service and disabled integrations skip probes', async () => {
  let calls = 0;
  const result = await createCockpitSystemsReader(
    {
      ...ports(),
      stripeConfigured: false,
      stripe: async () => {
        calls++;
        throw new Error('must not call');
      },
      email: async () => ({ lastSuccess: now.toISOString(), issues: 2 })
    },
    () => now
  )();
  assert.equal(calls, 0);
  assert.equal(result.systems[0].state, 'not_configured');
  assert.equal(result.systems[1].state, 'degraded');
  const stale = await createCockpitSystemsReader(
    {
      ...ports(),
      stripe: async () => ({ lastSuccess: '2026-09-16T13:00:00Z', issues: 0 })
    },
    () => now
  )();
  assert.equal(stale.systems[0].state, 'unknown');
});
test('health requests share bounded probes and refresh when evidence expires', async () => {
  let clock = now;
  let calls = 0;
  const read = createCockpitSystemsReader(
    {
      ...ports(),
      stripe: async () => {
        calls++;
        return { lastSuccess: '2026-09-16T13:45:30Z', issues: 0 };
      }
    },
    () => clock
  );
  const [first, second] = await Promise.all([read(), read()]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  clock = new Date('2026-09-16T14:00:31Z');
  assert.equal((await read()).systems[0].state, 'unknown');
  assert.equal(calls, 2);
  let aborted = false;
  const blocked = createCockpitSystemsReader(
    {
      ...ports(),
      storage: (signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        })
    },
    () => now,
    20
  );
  assert.equal((await blocked()).systems[2].state, 'unavailable');
  assert.equal(aborted, true);
});
test('an acquired connection arriving after timeout is released', async () => {
  let resolve;
  let released = false;
  const connection = connectForRead(
    {
      connect: () =>
        new Promise((r) => {
          resolve = r;
        })
    },
    10
  );
  await assert.rejects(connection, /timeout/);
  resolve({
    release: () => {
      released = true;
    }
  });
  await Promise.resolve();
  assert.equal(released, true);
});

test('local storage health reads the existing directory without creating a test file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'og7-cockpit-storage-'));
  try {
    const storage = createSponsorMediaStorage({
      driver: 'local',
      localStorageDir: directory,
      s3: {}
    });
    await storage.checkReadAccess(new AbortController().signal);
    assert.deepEqual(await readdir(directory), []);
    const missing = createSponsorMediaStorage({
      driver: 'local',
      localStorageDir: path.join(directory, 'missing'),
      s3: {}
    });
    await assert.rejects(missing.checkReadAccess(new AbortController().signal));
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rmdir(directory);
  }
});
