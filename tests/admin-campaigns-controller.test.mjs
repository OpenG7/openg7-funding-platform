import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminCampaignsController,
  groupCampaignRows
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const row = (id) => ({
  id,
  contributionId: '10000000-0000-4000-8000-000000000001',
  reference: 'SYNTHETIC-CAMPAIGN',
  companyName: 'Synthetic sponsor',
  paidAt: '2026-10-01T12:00:00Z',
  channel: 'facebook',
  target: 'openg7',
  ordinal: 1,
  quantity: 1,
  format: 'collective_text',
  obligationState: 'pending',
  timing: null,
  preparation: {
    status: 'ready',
    version: 'synthetic-v1',
    approvedAt: null,
    blockers: []
  },
  workflow: {
    obligationId: id,
    channel: 'facebook',
    target: 'openg7',
    ordinal: 1,
    state: 'action_required',
    responsibility: 'admin',
    reason: 'publication_authorization_required',
    deliveryId: null,
    scheduledAt: null
  },
  content: null,
  proof: null,
  adminUrl: '/admin/fundraiser/sponsors'
});

const response = (...items) => ({
  generatedAt: '2026-10-18T12:00:00Z',
  items,
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: items.length,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('grouping retains server due-date order when dossiers are interleaved', () => {
  const rows = [
    row('first'),
    row('same-dossier-next'),
    { ...row('other-dossier'), contributionId: 'synthetic-other-dossier' },
    row('original-dossier-later')
  ];
  const groups = groupCampaignRows(rows, true);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.id)).size, 3);
  assert.deepEqual(
    groups.flatMap((group) => group.rows),
    rows
  );
  assert.deepEqual(
    groups[0].rows.map((item) => item.id),
    ['first', 'same-dossier-next']
  );
  assert.deepEqual(groupCampaignRows(rows, false), [{ id: '', rows }]);
});

test('replacing a filtered read cancels it and ignores a late successful response', async () => {
  const requests = [];
  const c = new AdminCampaignsController({
    list(query, signal) {
      const request = { ...deferred(), query, signal };
      requests.push(request);
      return request.promise;
    },
    unauthorized() {
      assert.fail('No authorization failure expected.');
    }
  });
  const first = c.load();
  const second = c.load({
    ...c.query(),
    channel: 'linkedin',
    sort: 'due_at',
    direction: 'asc'
  });
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve(response(row('current')));
  await second;
  requests[0].resolve(response(row('obsolete')));
  await first;
  assert.equal(c.state(), 'ready');
  assert.equal(c.data().items[0].id, 'current');
  assert.equal(c.query().channel, 'linkedin');
});

test('selection requires a current row and survives a refreshed version of that promise', async () => {
  let result = response(row('first'), row('second'));
  const c = new AdminCampaignsController({
    list: async () => result,
    unauthorized() {}
  });
  await c.load();
  assert.equal(c.selected(), null);
  c.select(row('first'));
  assert.equal(c.selected(), null);
  c.select(result.items[1]);
  const updated = {
    ...row('second'),
    content: { title: 'Current', body: 'Current draft' }
  };
  result = response(updated);
  await c.load();
  assert.equal(c.selected(), updated);
  result = response(row('first'));
  await c.load();
  assert.equal(c.selectedId(), null);
});

for (const action of ['invalidate', 'dispose']) {
  test(`${action} erases private rows, selection and any late response`, async () => {
    const pending = deferred();
    let signal;
    let pendingRead = false;
    let unauthorized = 0;
    const data = response(row('private'));
    const c = new AdminCampaignsController({
      list(_query, requestSignal) {
        signal = requestSignal;
        return pendingRead ? pending.promise : Promise.resolve(data);
      },
      unauthorized() {
        unauthorized++;
      }
    });
    await c.load();
    c.select(data.items[0]);
    pendingRead = true;
    const loading = c.load();
    c[action]();
    assert.equal(signal.aborted, true);
    assert.equal(c.data(), null);
    assert.equal(c.selectedId(), null);
    pending.reject(new AdminDashboardRequestError(401));
    await loading;
    assert.equal(unauthorized, 0);
    assert.equal(c.data(), null);
    assert.equal(c.state(), 'forbidden');
  });
}

for (const [status, state] of [
  [401, 'forbidden'],
  [403, 'forbidden'],
  [503, 'unavailable'],
  [500, 'error']
]) {
  test(`HTTP ${status} purges rows and uses ${state} without inventing an empty success`, async () => {
    let error = false;
    let unauthorized = 0;
    const data = response(row('private'));
    const c = new AdminCampaignsController({
      async list() {
        if (error) throw new AdminDashboardRequestError(status);
        return data;
      },
      unauthorized() {
        unauthorized++;
      }
    });
    await c.load();
    c.select(data.items[0]);
    error = true;
    await c.load();
    assert.equal(c.data(), null);
    assert.equal(c.selected(), null);
    assert.equal(c.state(), state);
    assert.equal(unauthorized, status === 401 ? 1 : 0);
    error = false;
    await c.load();
    assert.equal(c.state(), 'ready');
    assert.equal(c.data(), data);
  });
}
