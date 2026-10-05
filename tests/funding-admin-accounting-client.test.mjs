import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingAdminAccountingClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-accounting.client.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

for (const status of [401, 403, 503]) {
  test(`contribution reads retain HTTP status ${status} for authorization and availability handling`, async () => {
    const client = new FundingAdminAccountingClient({
      requestAdminJson: async () => new Response('{}', { status })
    });
    await assert.rejects(
      client.getContributions('synthetic-session'),
      (error) =>
        error instanceof AdminDashboardRequestError && error.status === status
    );
  });
}
