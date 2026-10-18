import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPreparationAssistanceReadiness } from '../dist/apps/funding-api/src/preparation-assistance-readiness.js';

test('assistance startup requires migration tables and runtime grants without exposing database diagnostics', async () => {
  await assertPreparationAssistanceReadiness({
    query: async () => ({ rows: [{ ready: true }] })
  });
  for (const pool of [
    { query: async () => ({ rows: [{ ready: false }] }) },
    { query: async () => ({ rows: [] }) },
    {
      query: async () => {
        throw new Error('private credential');
      }
    }
  ]) {
    await assert.rejects(assertPreparationAssistanceReadiness(pool), {
      message: 'PREPARATION_ASSISTANCE_SCHEMA_OR_GRANTS_REQUIRED'
    });
  }
});
