import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAdminLoadOptions } from '../../scripts/lib/admin-load-profile.mjs';
import { runAdminLoadProfile } from './support/admin-controlled-load.mjs';

test('a preinterrupted benchmark creates no database and cannot report a successful measurement', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runAdminLoadProfile(100, parseAdminLoadOptions([]), {
    signal: controller.signal
  });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.phases.length, 0);
  assert.equal(result.totalElapsedMs, 0);
});

test(
  'bounded controlled load exercises real owner reads, pool contention and redacted plans on a disposable database',
  { timeout: 90000 },
  async () => {
    const result = await runAdminLoadProfile(
      100,
      parseAdminLoadOptions([
        '--run',
        '--profiles=100',
        '--samples=1',
        '--pool-size=1',
        '--concurrency=2'
      ])
    );
    assert.equal(result.status, 'passed');
    assert.equal(result.phases.length, 5);
    assert.equal(result.counts.obligations, 200);
    assert.equal(result.invariants.unchanged, true);
    assert.equal(result.invariants.proofs, 0);
    assert.equal(result.invariants.attempts, 0);
    const concurrent = result.phases.find(
      (phase) => phase.name === 'concurrent_work_queue'
    );
    assert.equal(concurrent.successful, 2);
    assert.equal(concurrent.latencies.samples, 2);
    assert.equal(concurrent.metrics.poolMaxTotal, 1);
    assert.ok(concurrent.metrics.poolMaxWaiting > 0);
    assert.ok(result.databaseObservation.samples > 0);
    assert.ok(result.plans.every((plan) => plan.status === 'available'));
    assert.doesNotMatch(
      JSON.stringify(result),
      /SYNTHETIC_PRIVATE|@example|password|storageKey|accountId|SELECT |INSERT |postgres:\/\//
    );
  }
);
