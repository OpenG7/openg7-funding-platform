import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { PublicationAutomationReadController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/publication-automation-read-controller.js';
import { AdminPublicationAutomationCommandWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-command-workflow.js';

const filter = {
  sponsorshipId: 'synthetic-sponsor',
  deliveryId: 'synthetic-delivery'
};
const serverState = (overrides = {}) => ({
  workerEnabled: true,
  workerVersion: 4,
  feeds: [{ id: 'openg7:facebook', paused: true, timezone: 'America/Toronto' }],
  deliveries: [],
  summary: {
    awaitingApproval: 0,
    scheduled: 0,
    exceptions: 0,
    publishedToday: 0
  },
  ...overrides
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
const fixture = () => {
  const error = signal('prior-error');
  const notice = signal('prior-notice');
  const guards = {
    busy: signal(false),
    workerChanging: signal(false),
    selected: signal(false),
    composing: signal(false),
    settings: signal(false)
  };
  const calls = {
    reads: [],
    errors: [],
    cleared: 0,
    scheduled: [],
    cancelled: []
  };
  const next = serverState();
  const ports = {
    api: {
      read: async (value) => {
        calls.reads.push(value);
        return next;
      }
    },
    ...guards,
    clearError: () => {
      calls.cleared++;
      error.set('');
    },
    showError: (failure) => {
      calls.errors.push(failure);
      error.set(failure instanceof Error ? failure.message : 'generic');
    },
    timer: {
      schedule: (callback, intervalMs) => {
        const handle = { callback, intervalMs };
        calls.scheduled.push(handle);
        return handle;
      },
      cancel: (handle) => calls.cancelled.push(handle)
    }
  };
  const controller = new PublicationAutomationReadController(ports);
  return { controller, ports, guards, calls, next, error, notice };
};
const workflow = (f, execute = async () => ({})) => {
  const confirmed = [];
  return {
    confirmed,
    workflow: new AdminPublicationAutomationCommandWorkflow({
      api: { execute, read: (value) => f.ports.api.read(value) },
      state: { busy: f.guards.busy, error: f.error, notice: f.notice },
      capture: () => f.controller.captureCommandContext(),
      isCurrent: (context) => f.controller.isCurrent(context),
      applyState: (next) => f.controller.applyConfirmedState(next),
      showError: (error) => f.ports.showError(error),
      confirmed: (...args) => confirmed.push(args)
    })
  };
};
const approval = {
  action: 'approve',
  id: filter.deliveryId,
  version: 3,
  confirmation: filter.deliveryId
};

test('reads capture both intersected route filters and preserve global worker, feeds and summary', async () => {
  const f = fixture();
  const context = f.controller.beginContext(filter);
  assert.equal(f.controller.isCurrent(context), true);
  assert.equal(await f.controller.load(), true);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.equal(f.controller.state(), f.next);
  assert.equal(f.controller.state().feeds, f.next.feeds);
  assert.equal(f.controller.state().workerVersion, 4);
  assert.equal(f.controller.state().summary, f.next.summary);
  assert.equal(f.error(), '');
  assert.equal(f.notice(), 'prior-notice');
});

test('navigation clears the prior snapshot and missing flag and invalidates command contexts without a read', async () => {
  const f = fixture();
  const prior = f.controller.beginContext(filter);
  await f.controller.load();
  assert.equal(f.controller.requestedDeliveryMissing(), true);
  const current = f.controller.beginContext({
    sponsorshipId: 'another-sponsor'
  });
  assert.equal(f.controller.state(), null);
  assert.equal(f.controller.requestedDeliveryMissing(), false);
  assert.equal(f.controller.sponsorshipId(), 'another-sponsor');
  assert.equal(f.controller.deliveryId(), null);
  assert.equal(f.controller.isCurrent(prior), false);
  assert.equal(f.controller.isCurrent(current), true);
  assert.deepEqual(prior.filter, filter);
  assert.equal(f.calls.reads.length, 1);
  await f.controller.load();
  assert.deepEqual(f.calls.reads[1], {
    sponsorshipId: 'another-sponsor',
    deliveryId: undefined
  });
});

test('the newest read wins over either a late successful or failed older read without stale feedback', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const f = fixture();
    const older = deferred();
    const newer = deferred();
    let count = 0;
    f.ports.api.read = async () =>
      ++count === 1 ? older.promise : newer.promise;
    const pendingOlder = f.controller.load();
    const pendingNewer = f.controller.load();
    const fresh = serverState({ workerVersion: 8 });
    newer.resolve(fresh);
    assert.equal(await pendingNewer, true);
    f.error.set('current-feedback');
    older[outcome](
      outcome === 'resolve'
        ? serverState({ workerVersion: 2 })
        : new Error('STALE_FAILURE')
    );
    assert.equal(await pendingOlder, false);
    assert.equal(f.controller.state(), fresh);
    assert.equal(f.error(), 'current-feedback');
    assert.deepEqual(f.calls.errors, []);
    assert.equal(f.calls.cleared, 1);
  }
});

test('current read failures remove the old snapshot and report the original error without claiming success', async () => {
  const f = fixture();
  await f.controller.load();
  const failure = new Error('READ_UNAVAILABLE');
  f.ports.api.read = async () => {
    throw failure;
  };
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.state(), null);
  assert.equal(f.error(), 'READ_UNAVAILABLE');
  assert.deepEqual(f.calls.errors, [failure]);
  assert.equal(f.calls.cleared, 1);
  assert.equal(f.notice(), 'prior-notice');
});

test('a late response from the prior route cannot replace the current filtered context', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const f = fixture();
    const response = deferred();
    f.controller.beginContext(filter);
    f.ports.api.read = async (value) => {
      f.calls.reads.push(value);
      return response.promise;
    };
    const pending = f.controller.load();
    const current = f.controller.beginContext({
      deliveryId: 'another-delivery'
    });
    f.error.set('new-context-feedback');
    response[outcome](
      outcome === 'resolve' ? f.next : new Error('OLD_CONTEXT_FAILURE')
    );
    assert.equal(await pending, false);
    assert.equal(f.controller.isCurrent(current), true);
    assert.equal(f.controller.state(), null);
    assert.equal(f.controller.deliveryId(), 'another-delivery');
    assert.deepEqual(f.calls.reads, [filter]);
    assert.equal(f.error(), 'new-context-feedback');
    assert.equal(f.calls.cleared, 0);
    assert.deepEqual(f.calls.errors, []);
  }
});

test('missing delivery is based on the exact requested ID and never changes selection or composes', async () => {
  const f = fixture();
  f.controller.beginContext(filter);
  f.ports.api.read = async () =>
    serverState({ deliveries: [{ id: 'another-delivery' }] });
  await f.controller.load();
  assert.equal(f.controller.requestedDeliveryMissing(), true);
  assert.equal(f.controller.deliveryId(), filter.deliveryId);
  assert.equal(f.guards.selected(), false);
  assert.equal(f.guards.composing(), false);
  f.controller.applyConfirmedState(
    serverState({ deliveries: [{ id: filter.deliveryId }] })
  );
  assert.equal(f.controller.requestedDeliveryMissing(), false);
  f.controller.applyConfirmedState(serverState());
  assert.equal(f.controller.requestedDeliveryMissing(), true);
  f.controller.beginContext({ sponsorshipId: filter.sponsorshipId });
  await f.controller.load();
  assert.equal(f.controller.requestedDeliveryMissing(), false);
});

test('command capture supersedes pending page reads while retaining the exact navigation snapshot', async () => {
  const f = fixture();
  const pageRead = deferred();
  f.controller.beginContext(filter);
  f.ports.api.read = async () => pageRead.promise;
  const pending = f.controller.load();
  const context = f.controller.captureCommandContext();
  assert.equal(f.controller.isCurrent(context), true);
  assert.deepEqual(context.filter, filter);
  pageRead.resolve(f.next);
  assert.equal(await pending, false);
  assert.equal(f.controller.state(), null);
  assert.equal(f.calls.cleared, 0);
});

test('confirmed command state supersedes reads started before capture and during the command', async () => {
  const f = fixture();
  const before = deferred();
  const during = deferred();
  const command = deferred();
  const confirmedState = serverState({
    workerVersion: 10,
    deliveries: [{ id: filter.deliveryId, status: 'approved' }]
  });
  const responses = [
    before.promise,
    during.promise,
    Promise.resolve(confirmedState)
  ];
  f.controller.beginContext(filter);
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    return responses.shift();
  };
  const pageReadBefore = f.controller.load();
  const commands = [];
  const w = workflow(f, async (value) => {
    commands.push(value);
    return command.promise;
  });
  const mutation = w.workflow.run(approval, true);
  const pageReadDuring = f.controller.load();
  command.resolve({ id: filter.deliveryId });
  await mutation;
  assert.equal(f.controller.state(), confirmedState);
  assert.equal(f.controller.requestedDeliveryMissing(), false);
  before.resolve(serverState({ workerVersion: 1 }));
  during.reject(new Error('STALE_PAGE_FAILURE'));
  assert.equal(await pageReadBefore, false);
  assert.equal(await pageReadDuring, false);
  assert.equal(f.controller.state(), confirmedState);
  assert.deepEqual(f.calls.reads, [filter, filter, filter]);
  assert.deepEqual(commands, [approval]);
  assert.equal(w.confirmed.length, 1);
  assert.equal(f.notice(), 'admin.publicationAutomation.saved');
  assert.equal(f.error(), '');
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.cleared, 0);
});

test('failed command recovery applies server facts but keeps failure feedback and never confirms or retries', async () => {
  const f = fixture();
  f.controller.beginContext(filter);
  let executions = 0;
  const w = workflow(f, async () => {
    executions++;
    throw new Error('VERSION_CONFLICT');
  });
  await w.workflow.run(approval);
  assert.equal(f.controller.state(), f.next);
  assert.equal(f.controller.requestedDeliveryMissing(), true);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.equal(executions, 1);
  assert.equal(f.error(), 'VERSION_CONFLICT');
  assert.equal(f.notice(), '');
  assert.deepEqual(w.confirmed, []);
});

test('navigation and disposal suppress a command confirming read and its panel feedback', async () => {
  for (const invalidate of ['navigate', 'dispose']) {
    const f = fixture();
    const read = deferred();
    f.controller.beginContext(filter);
    f.ports.api.read = async (value) => {
      f.calls.reads.push(value);
      return read.promise;
    };
    const w = workflow(f);
    const pending = w.workflow.run(approval, true);
    await Promise.resolve();
    if (invalidate === 'navigate')
      f.controller.beginContext({ sponsorshipId: 'new-sponsor' });
    else f.controller.dispose();
    f.error.set('current-error');
    f.notice.set('current-notice');
    read.resolve(f.next);
    await pending;
    assert.equal(f.controller.state(), null);
    assert.equal(f.error(), 'current-error');
    assert.equal(f.notice(), 'current-notice');
    assert.deepEqual(w.confirmed, []);
    assert.equal(f.guards.busy(), false);
    assert.deepEqual(f.calls.reads, [filter]);
  }
});

test('polling schedules once at 30 seconds and every existing panel guard suppresses its read', async () => {
  const f = fixture();
  f.controller.beginContext(filter);
  f.controller.startPolling();
  f.controller.startPolling();
  assert.equal(f.calls.scheduled.length, 1);
  const timer = f.calls.scheduled[0];
  assert.equal(timer.intervalMs, 30000);
  for (const guard of Object.values(f.guards)) {
    guard.set(true);
    timer.callback();
    await Promise.resolve();
    assert.deepEqual(f.calls.reads, []);
    guard.set(false);
  }
  timer.callback();
  await Promise.resolve();
  assert.deepEqual(f.calls.reads, [filter]);
  f.controller.beginContext({ deliveryId: 'current-polled-delivery' });
  timer.callback();
  await Promise.resolve();
  assert.deepEqual(f.calls.reads[1], {
    sponsorshipId: undefined,
    deliveryId: 'current-polled-delivery'
  });
  f.controller.dispose();
  f.controller.dispose();
  assert.deepEqual(f.calls.cancelled, [timer]);
  timer.callback();
  f.controller.startPolling();
  assert.equal(await f.controller.load(), false);
  assert.equal(f.calls.reads.length, 2);
  assert.equal(f.calls.scheduled.length, 1);
});

test('disposal invalidates late successful and failed reads and prevents further reads or feedback', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const f = fixture();
    const response = deferred();
    f.controller.beginContext(filter);
    const context = f.controller.captureCommandContext();
    f.ports.api.read = async (value) => {
      f.calls.reads.push(value);
      return response.promise;
    };
    const pending = f.controller.load();
    f.controller.dispose();
    response[outcome](
      outcome === 'resolve' ? f.next : new Error('LATE_FAILURE')
    );
    assert.equal(await pending, false);
    assert.equal(f.controller.isDisposed(), true);
    assert.equal(f.controller.isCurrent(context), false);
    assert.equal(f.controller.state(), null);
    f.controller.applyConfirmedState(f.next);
    assert.equal(f.controller.state(), null);
    assert.equal(await f.controller.load(), false);
    assert.equal(f.calls.reads.length, 1);
    assert.equal(f.error(), 'prior-error');
    assert.equal(f.calls.cleared, 0);
    assert.deepEqual(f.calls.errors, []);
  }
});
