import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSponsorMediaReadiness } from '../dist/apps/funding-api/src/sponsor-media-readiness.js';

test('media inheritance and analysis require the complete schema and runtime grants before startup', async () => {
  await assertSponsorMediaReadiness({
    query: async () => ({ rows: [{ ready: true }] })
  });
  for (const pool of [
    { query: async () => ({ rows: [] }) },
    { query: async () => ({ rows: [{ ready: false }] }) },
    {
      query: async () => {
        throw new Error('private connection information');
      }
    }
  ])
    await assert.rejects(assertSponsorMediaReadiness(pool), {
      message: 'SPONSOR_MEDIA_SCHEMA_OR_GRANTS_REQUIRED'
    });
});
