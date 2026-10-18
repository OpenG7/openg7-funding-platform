import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import sharp from 'sharp';
import { attestMediaSources } from '../dist/apps/funding-api/src/sponsor-media-workspace/source-attestation.js';

test('one hundred media attestations read at most four objects concurrently outside a DB transaction', async () => {
  const bytes = await sharp({
    create: { width: 100, height: 80, channels: 3, background: '#8899aa' }
  })
    .webp()
    .toBuffer();
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    version: 'v1',
    checksum_sha256: checksum,
    processed_storage_key: String(index),
    processed_size_bytes: bytes.length,
    width: 100,
    height: 80
  }));
  let active = 0,
    peak = 0,
    queries = 0;
  const pool = {
    query: async () => {
      queries++;
      return { rows };
    }
  };
  const storage = {
    readPrivateObject: async () => {
      active++;
      peak = Math.max(peak, active);
      await setImmediate();
      active--;
      return bytes;
    }
  };
  const results = await attestMediaSources(
    pool,
    storage,
    'synthetic-dossier',
    rows.map((row) => row.id)
  );
  assert.equal(queries, 1);
  assert.equal(results.size, 100);
  assert.equal(peak, 4);
  assert.ok([...results.values()].every((result) => result.valid));
});
