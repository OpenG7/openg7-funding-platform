import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminBackupsController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-backups/admin-backups-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const requestId = '10000000-0000-4000-8000-000000000701';
const previousId = '10000000-0000-4000-8000-000000000702';
const timestamp = Date.parse('2026-10-04T12:00:00Z');
const job = (status = 'queued', id = requestId) => ({
  requestId: id,
  source: 'manual',
  status,
  createdAt: new Date(timestamp).toISOString(),
  startedAt: null,
  finishedAt: null,
  bytes: null,
  sha256: null,
  retainUntil: null
});
const snapshot = (options = {}) => ({
  scope: 'database',
  schedule: 'daily',
  retentionDays: 30,
  checkedAt: new Date(timestamp).toISOString(),
  lastWorkerAt: new Date(timestamp).toISOString(),
  workerState: 'ready',
  jobs: [],
  ...options
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const fixture = (storedId = null) => {
  const events = [];
  const reads = [];
  const writes = [];
  const browserState = { id: storedId, now: timestamp, uuids: 0, reads: 0 };
  const session = { generation: 0 };
  const presentation = { drawer: 'proof', selectedId: previousId };
  const ports = {
    admin: {
      databaseBackups: async (id, payload) => {
        if (payload) {
          assert.equal(browserState.id, payload.requestId);
          events.push('post');
          writes.push(payload);
          return job('queued', payload.requestId);
        }
        events.push('get');
        reads.push(id);
        return snapshot();
      }
    },
    browser: {
      now: () => browserState.now,
      randomUUID: () => {
        browserState.uuids++;
        events.push('uuid');
        return requestId;
      },
      readPendingId: () => {
        browserState.reads++;
        return browserState.id;
      },
      writePendingId: (id) => {
        browserState.id = id;
        events.push(id ? 'remember' : 'forget');
      }
    },
    sessionGeneration: () => session.generation,
    confirm: async (message, target) => {
      events.push('confirm');
      assert.equal(message, 'admin.backups.confirm');
      assert.equal(target, 'admin.backups.scope');
      return true;
    },
    cancelConfirmation: () => events.push('cancel-confirmation'),
    t: (key) => key,
    onAccessDenied: () => {
      presentation.drawer = null;
      presentation.selectedId = null;
      events.push('access-denied');
    },
    focusRequest: (retry) =>
      events.push(retry ? 'focus-retry' : 'focus-request'),
    focusPanel: () => events.push('focus-panel')
  };
  return {
    controller: new AdminBackupsController(ports),
    ports,
    events,
    reads,
    writes,
    browserState,
    session,
    presentation
  };
};

test('backup construction has no request or recovery effects and initialization reads once', async () => {
  const f = fixture();
  assert.deepEqual(f.events, []);
  assert.equal(f.browserState.reads, 0);
  assert.equal(f.controller.serviceState(), 'loading');
  assert.equal(f.controller.canRequest(), false);
  await f.controller.initialize();
  assert.equal(f.controller.serviceState(), 'ready');
  assert.equal(f.controller.canRequest(), true);
  await f.controller.initialize();
  assert.equal(f.browserState.reads, 1);
  assert.deepEqual(f.reads, [undefined]);
  assert.deepEqual(f.writes, []);
});

test('a confirmed request stores its UUID before the POST and rereads before focusing', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.events.length = 0;
  await f.controller.request();
  assert.deepEqual(f.writes, [{ requestId, confirmation: 'BACKUP_DATABASE' }]);
  assert.deepEqual(f.events, [
    'confirm',
    'uuid',
    'remember',
    'post',
    'forget',
    'get',
    'focus-panel'
  ]);
  assert.equal(f.controller.receipt().status, 'queued');
  assert.equal(f.controller.trackedJob().requestId, requestId);
  assert.equal(f.controller.pendingId(), null);
  assert.equal(f.controller.uncertain(), false);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.confirming(), false);
});

test('a pending UUID is reconciled in reading and never creates a second request', async () => {
  const f = fixture(requestId);
  const receipt = job('running');
  f.ports.admin.databaseBackups = async (id, payload) => {
    assert.equal(id, requestId);
    assert.equal(payload, undefined);
    f.reads.push(id);
    return snapshot({ request: receipt, jobs: [receipt] });
  };
  await f.controller.initialize();
  assert.deepEqual(f.reads, [requestId]);
  assert.equal(f.controller.receipt(), receipt);
  assert.equal(f.controller.pendingId(), null);
  assert.equal(f.browserState.id, null);
  assert.equal(f.browserState.uuids, 0);
  assert.equal(f.controller.uncertain(), false);
  assert.equal(f.controller.missing(), false);
  assert.equal(f.controller.canRequest(), false);
  await f.controller.request();
  assert.deepEqual(f.events, ['forget']);
});

test('a missing recovery receipt requires confirmation and resends the same UUID', async () => {
  const f = fixture(requestId);
  await f.controller.initialize();
  assert.deepEqual(f.reads, [requestId]);
  assert.equal(f.controller.uncertain(), true);
  assert.equal(f.controller.missing(), true);
  assert.equal(f.controller.canRequest(), false);
  await f.controller.request();
  assert.deepEqual(f.writes, []);
  f.events.length = 0;
  await f.controller.request(true);
  assert.deepEqual(f.writes, [{ requestId, confirmation: 'BACKUP_DATABASE' }]);
  assert.deepEqual(f.events, [
    'confirm',
    'remember',
    'post',
    'forget',
    'get',
    'focus-panel'
  ]);
  assert.equal(f.browserState.uuids, 0);
  assert.equal(f.controller.missing(), false);
});

for (const retry of [false, true]) {
  test(`canceling ${retry ? 'recovery' : 'a new request'} restores its trigger without writing`, async () => {
    const f = fixture(retry ? requestId : null);
    await f.controller.initialize();
    f.ports.confirm = async () => false;
    f.events.length = 0;
    await f.controller.request(retry);
    assert.deepEqual(f.events, [retry ? 'focus-retry' : 'focus-request']);
    assert.deepEqual(f.writes, []);
    assert.equal(f.browserState.uuids, 0);
    assert.equal(f.controller.confirming(), false);
    assert.equal(f.controller.pendingId(), retry ? requestId : null);
  });
}

test('a lost POST response preserves its UUID until a successful receipt read', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.ports.admin.databaseBackups = async (id, payload) => {
    if (payload) {
      f.writes.push(payload);
      throw new Error('Synthetic connection failure');
    }
    f.reads.push(id);
    return snapshot({ request: job('queued') });
  };
  await f.controller.request();
  assert.equal(f.controller.error(), 'unavailable');
  assert.equal(f.controller.pendingId(), requestId);
  assert.equal(f.browserState.id, requestId);
  assert.equal(f.controller.uncertain(), true);
  assert.equal(f.controller.missing(), false);
  assert.equal(f.reads.length, 1);
  await f.controller.request(true);
  assert.equal(f.writes.length, 1);
  await f.controller.refresh();
  assert.deepEqual(f.reads, [undefined, requestId]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.controller.receipt().requestId, requestId);
  assert.equal(f.controller.pendingId(), null);
  assert.equal(f.controller.error(), '');
});

for (const status of [400, 409, 429]) {
  test(`a recognized POST refusal ${status} releases the request without a server reread`, async () => {
    const f = fixture();
    await f.controller.initialize();
    const previous = f.controller.data();
    f.ports.admin.databaseBackups = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.request();
    assert.equal(f.controller.pendingId(), null);
    assert.equal(f.browserState.id, null);
    assert.equal(f.controller.uncertain(), false);
    assert.equal(f.controller.receipt(), null);
    assert.equal(f.controller.data(), previous);
    assert.equal(
      f.controller.error(),
      status === 429 ? 'rateLimit' : 'unavailable'
    );
    assert.equal(f.controller.fresh(), false);
    assert.equal(f.controller.serviceState(), 'unavailable');
    assert.equal(f.controller.canRequest(), false);
    assert.deepEqual(f.reads, [undefined]);
    assert.equal(f.events.at(-1), 'focus-panel');
  });
}

for (const operation of ['refresh', 'request']) {
  for (const status of [401, 403]) {
    test(`${operation} refusal ${status} clears metadata, drawers and confirmation`, async () => {
      const f = fixture();
      await f.controller.initialize();
      f.controller.receipt.set(job('succeeded', previousId));
      f.ports.admin.databaseBackups = async () => {
        if (status === 401) f.session.generation++;
        throw new AdminDashboardRequestError(status);
      };
      await f.controller[operation]();
      assert.equal(f.controller.data(), null);
      assert.equal(f.controller.receipt(), null);
      assert.equal(f.controller.accessDenied(), true);
      assert.equal(
        f.controller.error(),
        status === 401 ? 'expired' : 'forbidden'
      );
      assert.equal(f.controller.canRequest(), false);
      assert.deepEqual(f.presentation, { drawer: null, selectedId: null });
      assert.equal(
        f.events.filter((event) => event === 'access-denied').length,
        1
      );
      assert.equal(
        f.events.filter((event) => event === 'cancel-confirmation').length,
        1
      );
      const effects = [...f.events];
      await f.controller.refresh();
      await f.controller.request();
      await f.controller.request(true);
      f.controller.reconcileSession();
      assert.deepEqual(f.events, effects);
      if (operation === 'request') {
        assert.equal(f.controller.pendingId(), requestId);
        assert.equal(f.browserState.id, requestId);
      }
    });
  }
}

test('freshness, worker state and active operations gate requests without claiming a capture', async () => {
  const f = fixture();
  await f.controller.initialize();
  for (const age of [-5001, -5000, 59999, 60000]) {
    f.browserState.now = timestamp + age;
    f.controller.tick();
    assert.equal(f.controller.fresh(), age >= -5000 && age < 60000);
    assert.equal(f.controller.canRequest(), age >= -5000 && age < 60000);
  }
  f.browserState.now = timestamp;
  f.controller.tick();
  for (const workerState of ['not_configured', 'stale', 'unavailable']) {
    f.controller.data.set(snapshot({ workerState }));
    assert.equal(f.controller.canRequest(), false);
  }
  for (const status of ['queued', 'running', 'unknown']) {
    const activeJob = job(status);
    f.controller.data.set(snapshot({ jobs: [activeJob] }));
    assert.equal(f.controller.canRequest(), false);
    assert.equal(f.controller.trackedJob(), activeJob);
    assert.equal(f.controller.lastSuccess(), null);
  }
  const failed = job('failed');
  const succeeded = job('succeeded', previousId);
  f.controller.data.set(snapshot({ jobs: [failed, succeeded] }));
  assert.equal(f.controller.canRequest(), true);
  assert.equal(f.controller.lastSuccess(), succeeded);
  assert.equal(f.controller.trackedJob(), failed);
  f.controller.error.set('unavailable');
  assert.equal(f.controller.fresh(), false);
  assert.equal(f.controller.lastSuccess(), succeeded);
  assert.equal(f.controller.canRequest(), false);
});

test('a server reread updates an accepted receipt without replacing an absent receipt', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.controller.receipt.set(job());
  const updated = job('succeeded');
  f.ports.admin.databaseBackups = async () => snapshot({ jobs: [updated] });
  await f.controller.refresh();
  assert.equal(f.controller.receipt(), updated);
  f.ports.admin.databaseBackups = async () => snapshot();
  await f.controller.refresh();
  assert.equal(f.controller.receipt(), updated);
  assert.equal(f.controller.lastSuccess(), null);
});

test('reading and confirmation each prevent overlapping reads or submissions', async () => {
  const f = fixture();
  const read = deferred();
  f.ports.admin.databaseBackups = () => {
    f.reads.push(undefined);
    return read.promise;
  };
  const loading = f.controller.initialize();
  await f.controller.refresh();
  await f.controller.request();
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.busy(), true);
  read.resolve(snapshot());
  await loading;
  const confirmation = deferred();
  let confirmations = 0;
  f.ports.confirm = () => {
    confirmations++;
    return confirmation.promise;
  };
  const requesting = f.controller.request();
  await f.controller.request();
  await f.controller.refresh();
  assert.equal(confirmations, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.controller.confirming(), true);
  confirmation.resolve(false);
  await requesting;
});

for (const operation of ['refresh', 'request']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`an expired ${operation} ${outcome} cannot restore metadata or overwrite expired`, async () => {
      const f = fixture();
      await f.controller.initialize();
      const pending = deferred();
      f.ports.admin.databaseBackups = () => pending.promise;
      const running = f.controller[operation]();
      await Promise.resolve();
      f.session.generation++;
      if (outcome === 'resolve')
        pending.resolve(
          operation === 'request' ? job('succeeded') : snapshot()
        );
      else pending.reject(new AdminDashboardRequestError(503));
      await running;
      assert.equal(f.controller.data(), null);
      assert.equal(f.controller.receipt(), null);
      assert.equal(f.controller.error(), 'expired');
      assert.equal(f.controller.accessDenied(), true);
      assert.equal(f.controller.busy(), false);
      assert.equal(f.events.includes('focus-panel'), false);
      if (operation === 'request') assert.equal(f.browserState.id, requestId);
    });
  }
}

test('session expiry cancels pending confirmation and prevents accepting a later decision', async () => {
  const f = fixture();
  await f.controller.initialize();
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  f.ports.cancelConfirmation = () => {
    f.events.push('cancel-confirmation');
    confirmation.resolve(false);
  };
  const requesting = f.controller.request();
  f.session.generation++;
  f.controller.reconcileSession();
  confirmation.resolve(true);
  await requesting;
  assert.equal(f.controller.confirming(), false);
  assert.equal(f.controller.error(), 'expired');
  assert.equal(f.controller.data(), null);
  assert.equal(f.browserState.uuids, 0);
  assert.equal(f.browserState.id, null);
  assert.deepEqual(f.writes, []);
  assert.equal(f.events.includes('focus-request'), false);
});

for (const operation of ['refresh', 'request']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`a ${operation} ${outcome} after disposal has no state or browser effects`, async () => {
      const f = fixture();
      await f.controller.initialize();
      const previousData = f.controller.data();
      const pending = deferred();
      f.ports.admin.databaseBackups = () => pending.promise;
      const running = f.controller[operation]();
      await Promise.resolve();
      f.controller.dispose();
      const effects = [...f.events];
      if (outcome === 'resolve')
        pending.resolve(
          operation === 'request' ? job('succeeded') : snapshot()
        );
      else pending.reject(new AdminDashboardRequestError(403));
      await running;
      assert.equal(f.controller.data(), previousData);
      assert.equal(f.controller.receipt(), null);
      assert.equal(f.controller.error(), '');
      assert.equal(f.controller.accessDenied(), false);
      assert.deepEqual(f.events, effects);
      if (operation === 'request') assert.equal(f.browserState.id, requestId);
    });
  }
}

test('disposal cancels confirmation and prevents later initialization, ticks or commands', async () => {
  const f = fixture();
  await f.controller.initialize();
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  f.ports.cancelConfirmation = () => {
    f.events.push('cancel-confirmation');
    confirmation.resolve(false);
  };
  const requesting = f.controller.request();
  f.controller.dispose();
  await requesting;
  const effects = [...f.events];
  f.browserState.now++;
  f.session.generation++;
  f.controller.tick();
  f.controller.reconcileSession();
  await f.controller.initialize();
  await f.controller.refresh();
  await f.controller.request();
  assert.equal(f.controller.clock(), timestamp);
  assert.equal(f.controller.accessDenied(), false);
  assert.equal(f.browserState.uuids, 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.events, effects);
  assert.equal(f.events.at(-1), 'cancel-confirmation');
  const unused = fixture(requestId);
  unused.controller.dispose();
  await unused.controller.initialize();
  assert.equal(unused.browserState.reads, 0);
  assert.deepEqual(unused.reads, []);
});
