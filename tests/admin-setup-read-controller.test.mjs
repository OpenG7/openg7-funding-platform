import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSetupReadController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-read-controller.js';
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

const fixture = () => {
  const calls = [];
  const denied = [];
  const ports = {
    admin: {
      getSetupStatus: async (token) => {
        calls.push(token);
        return { environment: 'test' };
      }
    },
    token: () => 'synthetic-admin-session',
    t: (key) => key,
    onAccessDenied: (status) => denied.push(status)
  };
  return {
    controller: new AdminSetupReadController(ports),
    ports,
    calls,
    denied
  };
};

test('setup consultation has no constructor effects and refreshes only confirmed reads', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.state(), 'idle');
  assert.equal(f.controller.setup(), null);
  const setup = await f.controller.load();
  assert.deepEqual(f.calls, ['synthetic-admin-session']);
  assert.equal(f.controller.setup(), setup);
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.refreshKey(), 1);
  f.ports.admin.getSetupStatus = async () => {
    throw new AdminDashboardRequestError(503);
  };
  await f.controller.load();
  assert.equal(f.controller.setup(), null);
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.controller.refreshKey(), 1);
  assert.equal(f.controller.accessError(), '');
  f.ports.admin.getSetupStatus = async () => ({ environment: 'test-restored' });
  await f.controller.load();
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.refreshKey(), 2);
});

for (const status of [401, 403]) {
  test(`setup consultation clears private state and distinguishes ${status}`, async () => {
    const f = fixture();
    await f.controller.load();
    f.ports.admin.getSetupStatus = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load();
    assert.equal(f.controller.setup(), null);
    assert.equal(f.controller.state(), 'error');
    assert.equal(
      f.controller.accessError(),
      status === 401 ? 'admin.setupEmail.expired' : 'admin.setupEmail.forbidden'
    );
    assert.deepEqual(f.denied, [status]);
    f.ports.admin.getSetupStatus = async () => ({ environment: 'test' });
    await f.controller.load();
    assert.equal(f.controller.accessError(), '');
    assert.equal(f.controller.state(), 'ready');
  });
}

for (const outcome of ['resolve', 'reject']) {
  test(`an older setup ${outcome} cannot replace a newer server read`, async () => {
    const f = fixture();
    const old = deferred();
    f.ports.admin.getSetupStatus = () => old.promise;
    const loading = f.controller.load();
    assert.equal(f.controller.state(), 'loading');
    const newest = { environment: 'latest-test' };
    f.ports.admin.getSetupStatus = async () => newest;
    await f.controller.load();
    if (outcome === 'resolve') old.resolve({ environment: 'old-test' });
    else old.reject(new AdminDashboardRequestError(401));
    assert.equal(await loading, null);
    assert.equal(f.controller.setup(), newest);
    assert.equal(f.controller.state(), 'ready');
    assert.equal(f.controller.refreshKey(), 1);
    assert.deepEqual(f.denied, []);
  });
}

for (const outcome of ['resolve', 'reject']) {
  test(`a setup ${outcome} after destruction has no effects`, async () => {
    const f = fixture();
    const pending = deferred();
    f.ports.admin.getSetupStatus = () => pending.promise;
    const loading = f.controller.load();
    f.controller.dispose();
    if (outcome === 'resolve') pending.resolve({ environment: 'late-test' });
    else pending.reject(new AdminDashboardRequestError(403));
    assert.equal(await loading, null);
    assert.equal(f.controller.setup(), null);
    assert.equal(f.controller.state(), 'loading');
    assert.equal(f.controller.refreshKey(), 0);
    assert.deepEqual(f.denied, []);
    assert.equal(await f.controller.load(), null);
  });
}

test('access loss invalidates a pending setup read instead of revealing its later response', async () => {
  const f = fixture();
  const pending = deferred();
  f.ports.admin.getSetupStatus = () => pending.promise;
  const loading = f.controller.load();
  f.controller.rejectAccess(403);
  pending.resolve({ environment: 'private-test' });
  await loading;
  assert.equal(f.controller.setup(), null);
  assert.equal(f.controller.refreshKey(), 0);
  assert.equal(f.controller.accessError(), 'admin.setupEmail.forbidden');
  assert.deepEqual(f.denied, [403]);
});
