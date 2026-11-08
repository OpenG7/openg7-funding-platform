import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminPublicationMonitorController } from '../dist/apps/funding-web/src/app/features/funding/services/admin-publication-monitor.controller.js';
import { FundingAdminSponsorshipsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-sponsorships.client.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const workshop = (contributionId = 'synthetic-dossier', changes = {}) => ({
  contributionId,
  enabled: true,
  sourceVersion: 1,
  sourceSnapshotDigest: 'synthetic-digest',
  mission: null,
  proposal: null,
  history: [],
  canPrepare: true,
  canAdopt: false,
  ...changes
});
const service = (
  contributionId = 'synthetic-dossier',
  id = 'synthetic-passage'
) => ({ contributionId, id, stage: 'to_review' });
const queue = (
  orders = [{ contributionId: 'synthetic-dossier', services: [service()] }]
) => ({ orders });
const progress = (contributionId = 'synthetic-dossier', changes = {}) => ({
  status: 'ok',
  generatedAt: '2026-11-08T12:00:00Z',
  dossier: { contributionId, version: 'v1', fulfilmentEvidence: [], ...changes }
});
const failure = (status) =>
  Object.assign(new Error('Synthetic response'), { status });
const fixture = (t) => {
  const state = {
    valid: true,
    generation: 1,
    identity: { id: 'reviewer', sessionId: 'session', role: 'operator' },
    cleared: 0
  };
  const calls = [];
  const handlers = {
    workshop: async (id) => workshop(id),
    desk: async () => queue(),
    progress: async (id) => progress(id)
  };
  const controller = new AdminPublicationMonitorController({
    identity: () => state.identity,
    sessionGeneration: () => state.generation,
    hasValidAdminSession: () => state.valid,
    getSavedAdminToken: () => 'synthetic-session',
    getSponsorshipProgress: (token, id, signal) => {
      calls.push({ method: 'progress.read', id, token, signal });
      return handlers.progress(id, signal);
    },
    clearAdminSession: () => {
      state.cleared++;
      state.valid = false;
    },
    publicationWorkshop: {
      read: (id, signal) => {
        calls.push({ method: 'workshop.read', id, signal });
        return handlers.workshop(id, signal);
      },
      prepare: () => {
        throw new Error('A monitor must never prepare');
      },
      adopt: () => {
        throw new Error('A monitor must never adopt');
      }
    },
    preflightDesk: {
      read: (query, signal) => {
        calls.push({ method: 'desk.read', query, signal });
        return handlers.desk(query, signal);
      }
    }
  });
  t.after(() => controller.dispose());
  return {
    state,
    calls,
    handlers,
    controller,
    load: (id = 'synthetic-dossier', context = 'context') =>
      controller.load(id, 'OG7-SYNTHETIC', context)
  };
};

test('refresh reads workshop and collective queue in parallel and makes no business mutation', async (t) => {
  const f = fixture(t);
  const remote = deferred(),
    desk = deferred();
  f.handlers.workshop = () => remote.promise;
  f.handlers.desk = () => desk.promise;
  const pending = f.load();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['workshop.read', 'desk.read', 'progress.read']
  );
  assert.equal(f.calls[0].signal, f.calls[1].signal);
  assert.equal(f.calls[0].signal, f.calls[2].signal);
  assert.equal(f.controller.loading(), true);
  assert.deepEqual(f.calls[1].query, {
    page: 1,
    pageSize: 50,
    stage: 'all',
    search: 'OG7-SYNTHETIC'
  });
  remote.resolve(workshop());
  desk.resolve(queue());
  await pending;
  assert.equal(f.controller.loading(), false);
  assert.equal(f.controller.workshop().contributionId, 'synthetic-dossier');
  assert.equal(f.controller.progress().contributionId, 'synthetic-dossier');
  assert.ok(Number.isFinite(Date.parse(f.controller.checkedAt())));
  assert.equal(f.state.cleared, 0);
});

test('a temporary failure retains same-session preparation with freshness while clearing uncertain queue membership', async (t) => {
  const f = fixture(t);
  await f.load();
  const prior = f.controller.workshop(),
    checkedAt = f.controller.checkedAt();
  f.handlers.workshop = async () => {
    throw failure(503);
  };
  f.handlers.desk = async () => {
    throw failure(503);
  };
  await f.load();
  assert.equal(f.controller.workshop(), prior);
  assert.equal(f.controller.checkedAt(), checkedAt);
  assert.equal(f.controller.error(), 'unavailable');
  assert.equal(f.controller.queueError(), true);
  assert.deepEqual(f.controller.services(), []);
  f.handlers.workshop = async () => workshop();
  f.handlers.desk = async () => queue();
  await f.load();
  assert.equal(f.controller.error(), '');
  assert.equal(f.controller.queueError(), false);
  assert.equal(f.controller.services().length, 1);
});

for (const source of ['workshop', 'desk', 'progress'])
  for (const status of [401, 403]) {
    test(`${source} ${status} clears every private snapshot and ${status === 401 ? 'expires' : 'preserves'} the session`, async (t) => {
      const f = fixture(t);
      await f.load();
      f.handlers[source] = async () => {
        throw failure(status);
      };
      await f.load();
      assert.equal(f.controller.workshop(), null);
      assert.equal(f.controller.progress(), null);
      assert.deepEqual(f.controller.services(), []);
      assert.equal(f.controller.checkedAt(), null);
      assert.equal(f.controller.loading(), false);
      assert.equal(
        f.controller.error(),
        status === 401 ? 'session' : 'forbidden'
      );
      assert.equal(f.state.cleared, status === 401 ? 1 : 0);
    });
  }

test('a simultaneous 401 takes precedence over a forbidden response', async (t) => {
  const f = fixture(t);
  f.handlers.workshop = async () => {
    throw failure(403);
  };
  f.handlers.desk = async () => {
    throw failure(401);
  };
  await f.load();
  assert.equal(f.controller.error(), 'session');
  assert.equal(f.state.cleared, 1);
});

test('an absent or expired session prevents every read and removes retained private facts', async (t) => {
  const f = fixture(t);
  await f.load();
  const calls = f.calls.length;
  f.state.valid = false;
  await f.load();
  assert.equal(f.calls.length, calls);
  assert.equal(f.controller.workshop(), null);
  assert.equal(f.controller.error(), 'session');
});

test('dossier changes fence responses even when the caller reuses a context string', async (t) => {
  const f = fixture(t);
  await f.load();
  const remote = deferred(),
    desk = deferred();
  f.handlers.workshop = () => remote.promise;
  f.handlers.desk = () => desk.promise;
  const old = f.load();
  const oldSignal = f.calls.at(-2).signal;
  f.handlers.workshop = async (id) => workshop(id);
  f.handlers.desk = async () =>
    queue([
      {
        contributionId: 'second-dossier',
        services: [service('second-dossier')]
      }
    ]);
  const next = f.load('second-dossier');
  assert.equal(f.controller.workshop(), null);
  assert.deepEqual(f.controller.services(), []);
  assert.equal(oldSignal.aborted, true);
  await next;
  remote.reject(failure(401));
  desk.resolve(queue());
  await old;
  assert.equal(f.controller.workshop().contributionId, 'second-dossier');
  assert.equal(f.controller.services()[0].contributionId, 'second-dossier');
  assert.equal(f.state.cleared, 0);
});

for (const dimension of ['actor', 'session', 'role', 'generation']) {
  test(`a ${dimension} change rejects late private data without clearing the replacement session`, async (t) => {
    const f = fixture(t);
    await f.load();
    const remote = deferred(),
      desk = deferred();
    f.handlers.workshop = () => remote.promise;
    f.handlers.desk = () => desk.promise;
    const pending = f.load();
    if (dimension === 'actor')
      f.state.identity = { ...f.state.identity, id: 'other-reviewer' };
    if (dimension === 'session')
      f.state.identity = { ...f.state.identity, sessionId: 'other-session' };
    if (dimension === 'role')
      f.state.identity = { ...f.state.identity, role: 'reader' };
    if (dimension === 'generation') f.state.generation++;
    remote.reject(failure(401));
    desk.resolve(queue());
    await pending;
    assert.equal(f.controller.workshop(), null);
    assert.deepEqual(f.controller.services(), []);
    assert.equal(f.controller.loading(), false);
    assert.equal(f.state.cleared, 0);
    f.handlers.workshop = async (id) => workshop(id);
    f.handlers.desk = async () => queue();
    await f.load();
    assert.equal(f.controller.workshop().contributionId, 'synthetic-dossier');
  });
}

test('queue membership comes only from the currently returned exact dossier and service owner', async (t) => {
  const f = fixture(t);
  f.handlers.desk = async () =>
    queue([
      { contributionId: 'other-dossier', services: [service('other-dossier')] },
      {
        contributionId: 'synthetic-dossier',
        services: [service(), service('other-dossier', 'foreign-service')]
      }
    ]);
  await f.load();
  assert.deepEqual(
    f.controller.services().map((entry) => entry.id),
    ['synthetic-passage']
  );
  f.handlers.desk = async () => queue([]);
  await f.load();
  assert.deepEqual(f.controller.services(), []);
  assert.equal(f.controller.queueError(), false);
});

test('a workshop response for another dossier is never adopted as the current snapshot', async (t) => {
  const f = fixture(t);
  await f.load();
  const previous = f.controller.workshop();
  f.handlers.workshop = async () => workshop('other-dossier');
  await f.load();
  assert.equal(f.controller.workshop(), previous);
  assert.equal(f.controller.error(), 'unavailable');
});

test('reset and disposal cancel reads and prevent delayed state from reappearing', async (t) => {
  const f = fixture(t);
  const remote = deferred(),
    desk = deferred();
  f.handlers.workshop = () => remote.promise;
  f.handlers.desk = () => desk.promise;
  const pending = f.load();
  const signal = f.calls[0].signal;
  f.controller.reset();
  assert.equal(signal.aborted, true);
  f.controller.dispose();
  remote.resolve(workshop());
  desk.resolve(queue());
  await pending;
  await f.load();
  assert.equal(f.calls.length, 3);
  assert.equal(f.controller.workshop(), null);
  assert.equal(f.controller.loading(), false);
});

test('observed preparation polls read-only, then stops when the mission becomes terminal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const f = fixture(t);
  f.handlers.workshop = async () =>
    workshop('synthetic-dossier', {
      mission: { status: 'received', delivery: 'acknowledged', errorCode: null }
    });
  await f.load();
  assert.equal(f.calls.length, 3);
  f.handlers.workshop = async () => workshop();
  t.mock.timers.tick(5000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.calls.length, 6);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 6);
});

test('a scheduled read never crosses into a replacement session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  const f = fixture(t);
  f.handlers.workshop = async () =>
    workshop('synthetic-dossier', {
      mission: { status: 'planning', delivery: 'acknowledged', errorCode: null }
    });
  await f.load();
  f.state.identity = { ...f.state.identity, sessionId: 'replacement' };
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 3);
  assert.equal(f.controller.workshop(), null);
});

test('refresh obtains newly confirmed delivery evidence from the current Funding dossier', async (t) => {
  const f = fixture(t);
  await f.load();
  assert.deepEqual(f.controller.progress().fulfilmentEvidence, []);
  const evidence = {
    id: 'qualified-proof',
    obligationId: 'synthetic-passage',
    provenance: 'provider_verified'
  };
  f.handlers.progress = async () =>
    progress('synthetic-dossier', {
      version: 'v2',
      fulfilmentEvidence: [evidence]
    });
  await f.load();
  assert.equal(f.controller.progress().version, 'v2');
  assert.deepEqual(f.controller.progress().fulfilmentEvidence, [evidence]);
  const prior = f.controller.progress();
  f.handlers.progress = async () => {
    throw failure(503);
  };
  await f.load();
  assert.equal(f.controller.progress(), prior);
  assert.equal(f.controller.error(), 'unavailable');
});

test('unknown or unavailable dossier responses retain stale facts without treating them as an empty agreement', async (t) => {
  const f = fixture(t);
  await f.load();
  const prior = f.controller.progress();
  for (const response of [
    { status: 'unavailable', dossier: null },
    { status: 'ok', dossier: null },
    progress('other-dossier')
  ]) {
    f.handlers.progress = async () => response;
    await f.load();
    assert.equal(f.controller.progress(), prior);
    assert.equal(f.controller.error(), 'unavailable');
  }
});

test('a confirmed missing dossier clears all snapshots and remains hidden during an unsuccessful retry', async (t) => {
  for (const response of ['empty', 'not_found', 404])
    await t.test(String(response), async (t) => {
      const f = fixture(t);
      await f.load();
      f.handlers.progress = async () => {
        if (response === 404) throw failure(404);
        return { status: response, dossier: null };
      };
      await f.load();
      assert.equal(f.controller.progress(), null);
      assert.equal(f.controller.workshop(), null);
      assert.deepEqual(f.controller.services(), []);
      assert.equal(f.controller.error(), 'not_found');
      const read = deferred();
      f.handlers.progress = () => read.promise;
      const pending = f.load();
      assert.equal(f.controller.error(), 'not_found');
      read.reject(failure(503));
      await pending;
      assert.equal(f.controller.error(), 'not_found');
    });
});

test('forbidden state remains gated until every replacement read succeeds', async (t) => {
  const f = fixture(t);
  f.handlers.desk = async () => {
    throw failure(403);
  };
  await f.load();
  assert.equal(f.controller.error(), 'forbidden');
  const read = deferred();
  f.handlers.desk = () => read.promise;
  const pending = f.load();
  assert.equal(f.controller.error(), 'forbidden');
  read.reject(failure(503));
  await pending;
  assert.equal(f.controller.error(), 'forbidden');
  f.handlers.desk = async () => queue();
  await f.load();
  assert.equal(f.controller.error(), '');
  assert.equal(f.controller.progress().contributionId, 'synthetic-dossier');
});

for (const action of ['reset', 'dispose'])
  test(`${action} aborts a hanging progress read so the whole refresh settles`, async (t) => {
    const f = fixture(t);
    f.handlers.progress = (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true
        });
      });
    const pending = f.load();
    assert.equal(f.controller.loading(), true);
    const signal = f.calls[2].signal;
    f.controller[action]();
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(f.controller.loading(), false);
    assert.equal(f.controller.progress(), null);
  });

test('the sponsorship progress client forwards optional cancellation to the authenticated transport', async () => {
  const calls = [];
  const client = new FundingAdminSponsorshipsClient({
    requestAdminData: async (path, options) => {
      calls.push({ path, options });
      return progress();
    }
  });
  const cancellation = new AbortController();
  await client.getSponsorshipProgress(
    'synthetic-session',
    'synthetic-dossier',
    cancellation.signal
  );
  assert.equal(
    calls[0].path,
    '/admin/sponsorships/progress?sponsorshipId=synthetic-dossier'
  );
  assert.equal(calls[0].options.signal, cancellation.signal);
  assert.equal(calls[0].options.abortBeforeFetch, true);
  assert.deepEqual(calls[0].options.auth, { token: 'synthetic-session' });
  await client.getSponsorshipProgress('synthetic-session', 'synthetic-dossier');
  assert.equal(calls[1].options.signal, undefined);
  assert.equal(calls[1].options.abortBeforeFetch, undefined);
});
