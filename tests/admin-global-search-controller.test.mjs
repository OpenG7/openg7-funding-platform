import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminGlobalSearchController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-search/admin-global-search-controller.js';
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

const response = (reference = 'OG7-SYNTHETIC', page = 1) => ({
  available: true,
  missingSources: [],
  groups: [
    {
      contributionId: '10000000-0000-4000-8000-000000000601',
      title: 'Synthetic sponsor',
      reference,
      amountMinor: 10050,
      currency: 'CAD',
      sponsorship: false,
      publications: []
    }
  ],
  total: 11,
  page,
  pageSize: 10
});

const fixture = () => {
  const calls = [];
  const expired = [];
  let savedToken = 'synthetic-admin-session';
  const ports = {
    admin: {
      search: async (token, request, signal) => {
        calls.push({ token, request, signal });
        return response('OG7-SYNTHETIC', request.page);
      }
    },
    token: () => savedToken,
    onSessionExpired: () => {
      expired.push({
        query: controller.query(),
        result: controller.result(),
        state: controller.state()
      });
    }
  };
  const controller = new AdminGlobalSearchController(ports);
  return {
    controller,
    ports,
    calls,
    expired,
    setToken: (value) => {
      savedToken = value;
    }
  };
};

test('search waits 300 ms after the latest input and sends trimmed pagination through its port', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  assert.equal(f.controller.state(), 'idle');
  assert.deepEqual(f.calls, []);
  f.controller.changed('Older private query');
  t.mock.timers.tick(299);
  assert.deepEqual(f.calls, []);
  f.controller.changed('  private@example.invalid  ');
  t.mock.timers.tick(299);
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.state(), 'loading');
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].token, 'synthetic-admin-session');
  assert.deepEqual(f.calls[0].request, {
    query: 'private@example.invalid',
    page: 1,
    pageSize: 10
  });
  assert.equal(f.calls[0].signal.aborted, false);
  assert.equal(f.controller.query(), '  private@example.invalid  ');
  assert.equal(f.controller.state(), 'ready');
  await f.controller.search(2);
  assert.deepEqual(f.calls[1].request, {
    query: 'private@example.invalid',
    page: 2,
    pageSize: 10
  });
  assert.equal(f.controller.result().page, 2);
  f.controller.changed('Different query');
  assert.equal(f.controller.result(), null);
  t.mock.timers.tick(300);
  await Promise.resolve();
  assert.equal(f.calls[2].request.page, 1);
  f.controller.dispose();
});

test('short input and clearing cancel debounce without sending private text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.controller.changed('private@example.invalid');
  t.mock.timers.tick(299);
  f.controller.changed(' x ');
  t.mock.timers.tick(300);
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.query(), ' x ');
  assert.equal(f.controller.state(), 'idle');
  f.controller.changed('Pending private query');
  f.controller.clear();
  t.mock.timers.tick(300);
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.query(), '');
  assert.equal(f.controller.result(), null);
  assert.equal(f.controller.state(), 'idle');
  f.controller.changed('Retry after reopening');
  t.mock.timers.tick(300);
  await Promise.resolve();
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.state(), 'ready');
  f.controller.dispose();
});

for (const outcome of ['resolve', 401, 403, 429, 503]) {
  test(`a superseded search ${outcome} is ignored even when its adapter ignores abort`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const old = deferred();
    let oldSignal;
    f.controller.changed('Old private query');
    f.ports.admin.search = (_token, _request, signal) => {
      oldSignal = signal;
      return old.promise;
    };
    const loading = f.controller.search(2);
    assert.equal(oldSignal.aborted, false);
    f.controller.changed('Current private query');
    assert.equal(oldSignal.aborted, true);
    f.ports.admin.search = async () => response('OG7-CURRENT');
    t.mock.timers.tick(300);
    await Promise.resolve();
    if (outcome === 'resolve') old.resolve(response('OG7-OLD', 2));
    else old.reject(new AdminDashboardRequestError(outcome));
    await loading;
    assert.equal(f.controller.query(), 'Current private query');
    assert.equal(f.controller.result().groups[0].reference, 'OG7-CURRENT');
    assert.equal(f.controller.state(), 'ready');
    assert.deepEqual(f.expired, []);
    f.controller.dispose();
  });
}

for (const status of [401, 403]) {
  test(`HTTP ${status} clears private query and result before reporting access loss`, async () => {
    const f = fixture();
    f.controller.changed('private@example.invalid');
    await f.controller.search();
    assert.notEqual(f.controller.result(), null);
    f.ports.admin.search = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.search();
    assert.equal(f.controller.query(), '');
    assert.equal(f.controller.result(), null);
    assert.equal(f.controller.state(), status === 401 ? 'idle' : 'forbidden');
    assert.deepEqual(
      f.expired,
      status === 401 ? [{ query: '', result: null, state: 'idle' }] : []
    );
    f.controller.dispose();
  });
}

for (const moment of ['before request', 'after response']) {
  test(`a missing token ${moment} expires the session without exposing private results`, async () => {
    const f = fixture();
    const pending = deferred();
    f.controller.changed('private@example.invalid');
    if (moment === 'before request') f.setToken('');
    else {
      f.ports.admin.search = (token, request, signal) => {
        f.calls.push({ token, request, signal });
        return pending.promise;
      };
    }
    const loading = f.controller.search();
    if (moment === 'after response') {
      f.setToken('');
      pending.resolve(response('OG7-PRIVATE'));
    }
    await loading;
    assert.equal(f.calls.length, moment === 'before request' ? 0 : 1);
    assert.equal(f.controller.query(), '');
    assert.equal(f.controller.result(), null);
    assert.equal(f.controller.state(), 'idle');
    assert.deepEqual(f.expired, [{ query: '', result: null, state: 'idle' }]);
    f.controller.dispose();
  });
}

for (const [error, state] of [
  [new AdminDashboardRequestError(429), 'limited'],
  [new AdminDashboardRequestError(503), 'error'],
  [new Error('Synthetic transport failure'), 'error']
]) {
  test(`search reports ${state} and keeps its query available for a deliberate retry`, async () => {
    const f = fixture();
    f.controller.changed('Retry private query');
    await f.controller.search();
    f.ports.admin.search = async () => {
      throw error;
    };
    await f.controller.search();
    assert.equal(f.controller.query(), 'Retry private query');
    assert.equal(f.controller.result(), null);
    assert.equal(f.controller.state(), state);
    assert.deepEqual(f.expired, []);
    f.ports.admin.search = async () => response();
    await f.controller.search();
    assert.equal(f.controller.state(), 'ready');
    f.controller.dispose();
  });
}

test('unavailable and partial sources retain their server coverage until a new search', async () => {
  const f = fixture();
  f.controller.changed('Private query');
  const unavailable = {
    ...response(),
    available: false,
    groups: [],
    missingSources: ['fund_contributions']
  };
  f.ports.admin.search = async () => unavailable;
  await f.controller.search();
  assert.equal(f.controller.state(), 'unavailable');
  assert.equal(f.controller.result(), unavailable);
  const partial = {
    ...response(),
    missingSources: ['sponsor_publication_drafts']
  };
  f.ports.admin.search = async () => partial;
  await f.controller.search();
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.result(), partial);
  f.controller.dispose();
});

for (const action of ['clear', 'dispose']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`${action} cancels an active search and ignores its late ${outcome}`, async () => {
      const f = fixture();
      const pending = deferred();
      let signal;
      f.controller.changed('Private query');
      await f.controller.search();
      f.ports.admin.search = (_token, _request, requestSignal) => {
        signal = requestSignal;
        return pending.promise;
      };
      const loading = f.controller.search(2);
      f.controller[action]();
      assert.equal(signal.aborted, true);
      assert.equal(f.controller.query(), '');
      assert.equal(f.controller.result(), null);
      assert.equal(f.controller.state(), 'idle');
      if (outcome === 'resolve') pending.resolve(response('OG7-LATE', 2));
      else pending.reject(new AdminDashboardRequestError(401));
      await loading;
      assert.equal(f.controller.query(), '');
      assert.equal(f.controller.result(), null);
      assert.equal(f.controller.state(), 'idle');
      assert.deepEqual(f.expired, []);
      f.controller.dispose();
    });
  }
}

test('destruction clears confirmed private results, cancels debounce and blocks later work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.controller.changed('Confirmed private query');
  await f.controller.search();
  assert.notEqual(f.controller.result(), null);
  f.controller.dispose();
  assert.equal(f.controller.query(), '');
  assert.equal(f.controller.result(), null);
  assert.equal(f.controller.state(), 'idle');
  f.controller.changed('Ignored private query');
  await f.controller.search(2);
  t.mock.timers.tick(300);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.query(), '');
  const pending = fixture();
  pending.controller.changed('Pending private query');
  pending.controller.dispose();
  t.mock.timers.tick(300);
  assert.deepEqual(pending.calls, []);
  assert.equal(pending.controller.query(), '');
  assert.equal(pending.controller.state(), 'idle');
});
