import assert from 'node:assert/strict';
import test from 'node:test';

import { getAdminDashboard } from '../dist/apps/funding-api/src/fund-contributions.repository.js';

test('a dashboard without PostgreSQL reports unavailable data instead of a confirmed empty fund', async () => {
  const result = await getAdminDashboard(null);
  assert.equal(result.data_available, false);
});
