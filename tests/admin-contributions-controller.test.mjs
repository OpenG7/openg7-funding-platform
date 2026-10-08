import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminContributionsController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-contributions-page/admin-contributions-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const response = (contributions = []) => ({
  contributions,
  summary: { total_received: 0, currency: 'CAD' },
  last_updated_at: '2026-10-04T12:00:00.123456Z'
});
const row = (id, values = {}) => ({
  id,
  public_reference: `reference-${id}`,
  public_name: 'Synthetic contributor',
  contribution_type: 'contribution',
  payment_status: 'paid',
  public_display_consent: true,
  updated_at: '2026-10-04T12:00:00.123456Z',
  ...values
});
const fixture = () => {
  const reads = [];
  const saved = [];
  let access = true;
  let sessionRevision = 0;
  let unauthorized = 0;
  const ports = {
    admin: {
      getContributions: async (token, contributionId) => {
        reads.push({ token, contributionId });
        return response();
      },
      saveAdminToken: (token) => saved.push(token)
    },
    token: () => 'synthetic-session',
    canExport: () => access,
    accessRevision: () => sessionRevision,
    unauthorized: () => unauthorized++
  };
  const controller = new AdminContributionsController(ports);
  return {
    controller,
    ports,
    reads,
    saved,
    unauthorized: () => unauthorized,
    invalidateSession: (notify = true) => {
      sessionRevision++;
      if (notify) controller.notifyAccessChanged();
    },
    setAccess: (value) => {
      access = value;
      controller.notifyAccessChanged();
    }
  };
};

test('contributions reads are explicit and preserve the historical target and token', async () => {
  const f = fixture();
  assert.equal(f.controller.state(), 'idle');
  assert.deepEqual(f.reads, []);
  f.controller.setRouteContribution(' old-contribution ');
  assert.equal(f.controller.selectedContributionId(), 'old-contribution');
  await f.controller.load();
  assert.deepEqual(f.reads, [
    { token: 'synthetic-session', contributionId: ' old-contribution ' }
  ]);
  assert.deepEqual(f.saved, ['synthetic-session']);
  assert.equal(f.controller.state(), 'ready');
  f.ports.admin.getContributions = async () => {
    throw new Error('Synthetic unavailable');
  };
  const confirmed = f.controller.data();
  await f.controller.load();
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.controller.data(), confirmed);
  assert.deepEqual(f.saved, ['synthetic-session']);
});

test('an authorized reload restores the historical route selection after identity refresh', async () => {
  const f = fixture();
  const historical = row('historical');
  let read = async () => response([historical]);
  f.ports.admin.getContributions = (token, contributionId) => {
    f.reads.push({ token, contributionId });
    return read();
  };
  f.controller.setRouteContribution(historical.id);
  await f.controller.load();
  assert.equal(f.controller.selectedContribution(), historical);

  f.controller.notifyAccessChanged();
  assert.equal(f.controller.data(), null);
  assert.equal(f.controller.selectedContributionId(), null);
  read = async () => {
    throw new Error('Synthetic unavailable');
  };
  await f.controller.load();
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.controller.data(), null);
  assert.equal(f.controller.selectedContribution(), null);

  const pending = deferred();
  read = () => pending.promise;
  const loading = f.controller.load();
  assert.equal(f.controller.state(), 'loading');
  assert.equal(f.controller.selectedContributionId(), null);
  pending.resolve(response([historical]));
  await loading;
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.selectedContributionId(), historical.id);
  assert.equal(f.controller.selectedContribution(), historical);
  assert.deepEqual(
    f.reads,
    Array.from({ length: 3 }, () => ({
      token: 'synthetic-session',
      contributionId: historical.id
    }))
  );
});

test('search retains all private and public searchable fields and combines the filters', async () => {
  const f = fixture();
  const privateFields = [
    'public_name',
    'email_private',
    'sponsor_company_name',
    'sponsor_contact_name',
    'sponsor_contact_email',
    'stripe_session_id',
    'stripe_payment_intent_id'
  ];
  const rows = privateFields.map((field, index) =>
    row(String(index), { [field]: 'Matching synthetic value' })
  );
  const sponsored = row('sponsored', {
    sponsor_company_name: 'Matching synthetic company',
    contribution_type: 'sponsorship_interest',
    payment_status: 'pending',
    public_display_consent: false
  });
  f.ports.admin.getContributions = async () => response([...rows, sponsored]);
  await f.controller.load();
  f.controller.setSearch(' MATCHING ');
  assert.deepEqual(f.controller.filteredContributions(), [...rows, sponsored]);
  f.controller.setTypeFilter('sponsorship_interest');
  f.controller.setStatusFilter('pending');
  f.controller.setPublicFilter('private');
  assert.deepEqual(f.controller.filteredContributions(), [sponsored]);
  f.controller.setPublicFilter('public');
  assert.deepEqual(f.controller.filteredContributions(), []);
  f.controller.setSearch('reference-0');
  f.controller.setTypeFilter('all');
  f.controller.setStatusFilter('all');
  assert.deepEqual(f.controller.filteredContributions(), [rows[0]]);
  f.controller.selectContribution('sponsored');
  assert.equal(f.controller.selectedContribution(), sponsored);
});

test('filter transitions and restored access never restore an earlier export scope', async () => {
  const f = fixture();
  for (const [setter, changed, original] of [
    ['setSearch', 'synthetic', ''],
    ['setTypeFilter', 'sponsorship_interest', 'all'],
    ['setStatusFilter', 'paid', 'all'],
    ['setPublicFilter', 'private', 'all']
  ]) {
    const revision = f.controller.exportScopeRevision();
    f.controller[setter](original);
    assert.equal(f.controller.exportScopeRevision(), revision);
    f.controller[setter](changed);
    f.controller[setter](original);
    assert.equal(f.controller.exportScopeRevision(), revision + 2);
  }
  const revision = f.controller.exportScopeRevision();
  f.setAccess(false);
  f.setAccess(true);
  assert.equal(f.controller.exportScopeRevision(), revision + 2);
  f.controller.setRouteContribution(null);
  assert.equal(f.controller.exportScopeRevision(), revision + 3);
  await f.controller.load();
  assert.equal(f.controller.exportScopeRevision(), revision + 4);
  f.controller.dispose();
  assert.equal(f.controller.exportScopeRevision(), revision + 5);
});

for (const outcome of ['resolve', 'reject']) {
  for (const transition of [
    'newer read',
    'route',
    'dispose',
    'session',
    'access'
  ]) {
    test(`a late ${outcome} after ${transition} cannot replace the current read or save a token`, async () => {
      const f = fixture();
      const pending = deferred();
      f.ports.admin.getContributions = () => pending.promise;
      const loading = f.controller.load();
      const newest = response([row('newest')]);
      if (transition === 'dispose') f.controller.dispose();
      else if (transition === 'session') f.invalidateSession();
      else if (transition === 'access') f.setAccess(false);
      else {
        if (transition === 'route') {
          f.controller.setSearch('old-filter');
          f.controller.setRouteContribution('newest');
          assert.equal(f.controller.search(), '');
          assert.equal(f.controller.data(), null);
        }
        f.ports.admin.getContributions = async () => newest;
        await f.controller.load();
      }
      const state = f.controller.state();
      const data = f.controller.data();
      const saved = [...f.saved];
      if (outcome === 'resolve') pending.resolve(response([row('old')]));
      else pending.reject(new Error('Synthetic delayed failure'));
      await loading;
      assert.equal(f.controller.state(), state);
      assert.equal(f.controller.data(), data);
      assert.deepEqual(f.saved, saved);
      if (transition === 'dispose') {
        await f.controller.load();
        f.controller.setRouteContribution('ignored');
        f.controller.setSearch('ignored');
        assert.equal(f.controller.data(), null);
        assert.equal(f.controller.search(), '');
      }
    });
  }
}

for (const status of [401, 403]) {
  test(`authorization refusal ${status} purges private data and selection`, async () => {
    const f = fixture();
    f.ports.admin.getContributions = async () =>
      response([row('private', { email_private: 'synthetic@example.test' })]);
    await f.controller.load();
    f.controller.selectContribution('private');
    f.ports.admin.getContributions = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load();
    assert.equal(f.controller.data(), null);
    assert.equal(f.controller.selectedContribution(), null);
    assert.equal(f.controller.selectedContributionId(), null);
    assert.equal(f.unauthorized(), status === 401 ? 1 : 0);
  });
}

test('a session generation change rejects a response before the page notification runs', async () => {
  const f = fixture();
  f.ports.admin.getContributions = async () =>
    response([row('previous-private')]);
  await f.controller.load();
  const saved = [...f.saved];
  const pending = deferred();
  f.ports.admin.getContributions = () => pending.promise;
  const loading = f.controller.load();
  f.invalidateSession(false);
  pending.resolve(response([row('private')]));
  await loading;
  assert.equal(f.controller.data(), null);
  assert.deepEqual(f.saved, saved);
});
