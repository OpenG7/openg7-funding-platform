import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicTransparencyCache } from '../dist/apps/funding-api/src/public-transparency-cache.js';

test('concurrent visitors share one read and cached snapshots keep their generation timestamp', async () => {
  let clock = 0;
  let calls = 0;
  let release;
  const report = { generated_at: '2026-09-30T23:59:59.000Z' };
  const read = createPublicTransparencyCache(
    async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
      return report;
    },
    { ttlMs: 60_000, now: () => clock }
  );
  const visitors = Array.from({ length: 30 }, () => read());
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  for (const result of await Promise.all(visitors))
    assert.equal(result, report);
  clock = 59_999;
  assert.equal(await read(), report);
  assert.equal(calls, 1);
  clock = 60_000;
  const fresh = read();
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  await fresh;
});

test('expired data is not returned as success after an error, and retries recover', async () => {
  let clock = 0;
  let calls = 0;
  const read = createPublicTransparencyCache(
    async () => {
      if (++calls === 2) throw new Error('upstream unavailable');
      return { total_received: calls };
    },
    { ttlMs: 10, now: () => clock }
  );
  assert.equal((await read()).total_received, 1);
  clock = 11;
  const visitors = await Promise.allSettled([read(), read()]);
  assert.ok(visitors.every((result) => result.status === 'rejected'));
  assert.equal(calls, 2);
  assert.equal((await read()).total_received, 3);
});

test('a slow read does not extend freshness and readers never share account or project data', async () => {
  let clock = 0;
  let calls = 0;
  const readA = createPublicTransparencyCache(
    async () => {
      clock += 20;
      return { total_received: ++calls };
    },
    { ttlMs: 10, now: () => clock }
  );
  const readB = createPublicTransparencyCache(async () => ({
    total_received: 100
  }));
  assert.equal((await readA()).total_received, 1);
  assert.equal((await readB()).total_received, 100);
  assert.equal((await readA()).total_received, 2);
});
