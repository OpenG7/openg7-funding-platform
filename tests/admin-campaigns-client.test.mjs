import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingAdminCampaignsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-campaigns.client.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

test('campaign reads share saved authentication, private cache policy and cancellation', async () => {
  const calls = [];
  const data = { items: [], pagination: { page: 2 } };
  const signal = new AbortController().signal;
  const client = new FundingAdminCampaignsClient({
    async requestAdminJson(path, options) {
      calls.push({ path, options });
      return Response.json(data);
    }
  });
  assert.deepEqual(
    await client.list(
      {
        page: 2,
        pageSize: 50,
        channel: 'linkedin',
        target: 'openg20',
        state: 'waiting',
        search: 'Synthetic & Company',
        sort: 'preparation',
        direction: 'desc',
        unexpected: 'must not be transmitted'
      },
      signal
    ),
    data
  );
  const url = new URL(calls[0].path, 'https://synthetic.invalid');
  assert.equal(url.pathname, '/admin/campaigns');
  assert.equal(url.searchParams.get('search'), 'Synthetic & Company');
  assert.equal(url.searchParams.get('channel'), 'linkedin');
  assert.equal(url.searchParams.get('unexpected'), null);
  assert.deepEqual(calls[0].options, {
    auth: 'saved',
    cache: 'no-store',
    signal,
    abortBeforeFetch: true
  });
});

for (const status of [401, 403, 429, 503]) {
  test(`campaign HTTP ${status} is preserved for the page recovery policy`, async () => {
    const client = new FundingAdminCampaignsClient({
      async requestAdminJson() {
        return Response.json({ code: 'SYNTHETIC_CAMPAIGN_ERROR' }, { status });
      }
    });
    await assert.rejects(
      client.list({
        page: 1,
        pageSize: 25,
        sort: 'preparation',
        direction: 'desc'
      }),
      (error) =>
        error instanceof AdminDashboardRequestError &&
        error.status === status &&
        error.code === 'SYNTHETIC_CAMPAIGN_ERROR'
    );
  });
}
