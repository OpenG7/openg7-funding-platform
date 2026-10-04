import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPublicationBatchesWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-batches-workflow.js';

const batch = { id: 'synthetic-batch', channel: 'linkedin' };
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
  const events = [];
  const trackedSignal = (name, value) => {
    const field = signal(value);
    const set = field.set;
    field.set = (next) => {
      events.push([name, next]);
      set(next);
    };
    return field;
  };
  const state = {
    batchActionState: trackedSignal('action', null),
    newBatchChannel: signal('linkedin'),
    newBatchCapacity: signal('7'),
    newBatchOpen: trackedSignal('open', true),
    selectedBatchId: trackedSignal('selected', 'synthetic-previous')
  };
  const schedules = { [batch.id]: '2030-06-10T09:45' };
  const replies = {
    create: async () => ({ created: true, batch: { id: 'synthetic-created' } }),
    schedule: async () => ({ scheduled: true, batch }),
    publish: async () => ({ published: true, batch }),
    cancel: async () => ({ cancelled: true, batch }),
    reload: async () => {},
    confirm: async () => true
  };
  const mutations = [];
  const apiMethod = (action) => async (token, payload) => {
    mutations.push({ action, token, payload });
    events.push(['mutation', action]);
    return replies[action]();
  };
  const ports = {
    state,
    api: {
      createPublicationBatch: apiMethod('create'),
      schedulePublicationBatch: apiMethod('schedule'),
      publishPublicationBatch: apiMethod('publish'),
      cancelPublicationBatch: apiMethod('cancel')
    },
    token: () => 'synthetic-token',
    reload: async () => {
      events.push(['reload']);
      return replies.reload();
    },
    confirm: async (action, target) => {
      events.push(['confirm', action, target]);
      return replies.confirm();
    },
    failed: () => events.push(['failed']),
    focusRequested: (id) => events.push(['focus', id]),
    scheduleFor: (id) => schedules[id] ?? ''
  };
  return {
    workflow: new AdminPublicationBatchesWorkflow(ports),
    ports,
    state,
    schedules,
    replies,
    mutations,
    events
  };
};

const operations = [
  { method: 'createBatch', action: 'create', lock: 'create' },
  {
    method: 'scheduleBatch',
    action: 'schedule',
    flag: 'scheduled',
    lock: batch.id
  },
  {
    method: 'publishBatch',
    action: 'publish',
    flag: 'published',
    confirmation: 'publish',
    lock: batch.id
  },
  {
    method: 'cancelBatch',
    action: 'cancel',
    flag: 'cancelled',
    confirmation: 'cancelPublication',
    lock: batch.id
  }
];
const run = (f, operation) => f.workflow[operation.method](batch);

test('creation uses the existing payload and selects the server batch before reload and focus', async () => {
  const f = fixture();
  await f.workflow.createBatch();
  assert.deepEqual(f.mutations, [
    {
      action: 'create',
      token: 'synthetic-token',
      payload: { channel: 'linkedin', capacity: 7 }
    }
  ]);
  assert.deepEqual(f.events, [
    ['action', 'create'],
    ['mutation', 'create'],
    ['open', false],
    ['selected', 'synthetic-created'],
    ['reload'],
    ['focus', 'synthetic-created'],
    ['action', null]
  ]);
});

test('capacity bounds and parseInt conversion retain their current semantics', async (t) => {
  for (const value of ['', 'invalid', '0', '-1', '51']) {
    await t.test(`invalid ${JSON.stringify(value)}`, async () => {
      const f = fixture();
      f.state.newBatchCapacity.set(value);
      await f.workflow.createBatch();
      assert.deepEqual(f.events, [['failed']]);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.state.newBatchOpen(), true);
    });
  }
  for (const [value, capacity] of [
    ['1', 1],
    ['50', 50],
    ['7.5', 7],
    ['8suffix', 8]
  ]) {
    await t.test(`accepted ${value}`, async () => {
      const f = fixture();
      f.state.newBatchCapacity.set(value);
      await f.workflow.createBatch();
      assert.equal(f.mutations[0].payload.capacity, capacity);
    });
  }
});

test('creation without a batch keeps the existing close, null selection and reload behavior without focus', async (t) => {
  for (const result of [
    { created: false, batch: null },
    { created: false },
    { created: true, batch: null }
  ]) {
    await t.test(JSON.stringify(result), async () => {
      const f = fixture();
      f.replies.create = async () => result;
      await f.workflow.createBatch();
      assert.deepEqual(f.events, [
        ['action', 'create'],
        ['mutation', 'create'],
        ['open', false],
        ['selected', null],
        ['reload'],
        ['action', null]
      ]);
    });
  }
});

test('an absent creation response retains the existing close-before-result order and reports failure without refreshing', async () => {
  const f = fixture();
  f.replies.create = async () => undefined;
  await f.workflow.createBatch();
  assert.deepEqual(f.events, [
    ['action', 'create'],
    ['mutation', 'create'],
    ['open', false],
    ['failed'],
    ['action', null]
  ]);
  assert.equal(f.state.newBatchOpen(), false);
  assert.equal(f.state.selectedBatchId(), 'synthetic-previous');
});

test('creation waits for the response and reload while preserving inputs typed during both waits', async () => {
  const f = fixture();
  const response = deferred();
  const refresh = deferred();
  f.replies.create = () => response.promise;
  f.replies.reload = () => refresh.promise;
  const pending = f.workflow.createBatch();
  assert.equal(f.state.newBatchOpen(), true);
  assert.equal(f.state.selectedBatchId(), 'synthetic-previous');
  f.state.newBatchChannel.set('facebook');
  f.state.newBatchCapacity.set('11');
  f.state.selectedBatchId.set('synthetic-other');
  response.resolve({ created: true, batch: { id: 'synthetic-server' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.selectedBatchId(), 'synthetic-server');
  assert.equal(f.state.newBatchOpen(), false);
  assert.equal(f.state.batchActionState(), 'create');
  assert.equal(
    f.events.some(([event]) => event === 'focus'),
    false
  );
  f.state.newBatchCapacity.set('12');
  refresh.resolve();
  await pending;
  assert.deepEqual(f.mutations[0].payload, {
    channel: 'linkedin',
    capacity: 7
  });
  assert.equal(f.state.newBatchChannel(), 'facebook');
  assert.equal(f.state.newBatchCapacity(), '12');
  assert.deepEqual(f.events.slice(-2), [
    ['focus', 'synthetic-server'],
    ['action', null]
  ]);
});

test('schedule sends the submitted ISO date and leaves later schedule edits intact', async () => {
  const f = fixture();
  const response = deferred();
  const refresh = deferred();
  f.replies.schedule = () => response.promise;
  f.replies.reload = () => refresh.promise;
  const submitted = f.schedules[batch.id];
  const pending = f.workflow.scheduleBatch(batch);
  assert.deepEqual(f.mutations, [
    {
      action: 'schedule',
      token: 'synthetic-token',
      payload: {
        batchId: batch.id,
        scheduledAt: new Date(submitted).toISOString()
      }
    }
  ]);
  f.schedules[batch.id] = '2030-06-11T10:30';
  response.resolve({ scheduled: true, batch });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.batchActionState(), batch.id);
  f.schedules[batch.id] = '2030-06-12T11:15';
  refresh.resolve();
  await pending;
  assert.equal(f.schedules[batch.id], '2030-06-12T11:15');
  assert.deepEqual(f.events, [
    ['action', batch.id],
    ['mutation', 'schedule'],
    ['reload'],
    ['action', null]
  ]);
});

test('an empty schedule makes no request and an invalid date reports failure and releases the lock', async (t) => {
  for (const scheduledAt of ['', 'invalid']) {
    await t.test(JSON.stringify(scheduledAt), async () => {
      const f = fixture();
      f.schedules[batch.id] = scheduledAt;
      await f.workflow.scheduleBatch(batch);
      assert.deepEqual(f.mutations, []);
      assert.deepEqual(
        f.events,
        scheduledAt ? [['action', batch.id], ['failed'], ['action', null]] : []
      );
      assert.equal(f.schedules[batch.id], scheduledAt);
    });
  }
});

test('publication and cancellation confirm the target before mutation and reload', async (t) => {
  for (const operation of operations.filter((item) => item.confirmation)) {
    await t.test(operation.action, async () => {
      const f = fixture();
      const confirmation = deferred();
      f.replies.confirm = () => confirmation.promise;
      const pending = run(f, operation);
      assert.deepEqual(f.events, [
        ['confirm', operation.confirmation, batch.id]
      ]);
      assert.equal(f.state.batchActionState(), null);
      confirmation.resolve(true);
      await pending;
      assert.deepEqual(f.mutations, [
        {
          action: operation.action,
          token: 'synthetic-token',
          payload: { batchId: batch.id }
        }
      ]);
      assert.deepEqual(f.events, [
        ['confirm', operation.confirmation, batch.id],
        ['action', batch.id],
        ['mutation', operation.action],
        ['reload'],
        ['action', null]
      ]);
    });
  }
});

test('a cancelled confirmation leaves all batch inputs and selection intact', async (t) => {
  for (const operation of operations.filter((item) => item.confirmation)) {
    await t.test(operation.action, async () => {
      const f = fixture();
      f.replies.confirm = async () => false;
      await run(f, operation);
      assert.deepEqual(f.events, [
        ['confirm', operation.confirmation, batch.id]
      ]);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.state.newBatchOpen(), true);
      assert.equal(f.state.selectedBatchId(), 'synthetic-previous');
      assert.equal(f.state.newBatchCapacity(), '7');
      assert.equal(f.schedules[batch.id], '2030-06-10T09:45');
    });
  }
});

test('all manual actions honor the existing action lock without confirmation or effects', async (t) => {
  for (const operation of operations) {
    await t.test(operation.action, async () => {
      const f = fixture();
      f.state.batchActionState.set('synthetic-pending');
      f.events.length = 0;
      await run(f, operation);
      assert.deepEqual(f.events, []);
      assert.deepEqual(f.mutations, []);
      assert.equal(f.state.batchActionState(), 'synthetic-pending');
    });
  }
});

test('a deferred mutation blocks every second manual action until reload finishes', async (t) => {
  for (const operation of operations) {
    await t.test(operation.action, async () => {
      const f = fixture();
      const response = deferred();
      const refresh = deferred();
      f.replies[operation.action] = () => response.promise;
      f.replies.reload = () => refresh.promise;
      const pending = run(f, operation);
      await new Promise((resolve) => setImmediate(resolve));
      for (const other of operations) await run(f, other);
      assert.equal(f.mutations.length, 1);
      response.resolve({ batch });
      await new Promise((resolve) => setImmediate(resolve));
      for (const other of operations) await run(f, other);
      assert.equal(f.mutations.length, 1);
      assert.equal(f.state.batchActionState(), operation.lock);
      refresh.resolve();
      await pending;
      assert.equal(f.state.batchActionState(), null);
    });
  }
});

test('mutation and reload errors report failure, release the lock and preserve newer input', async (t) => {
  for (const operation of operations) {
    for (const failure of ['mutation', 'reload']) {
      await t.test(`${operation.action} ${failure}`, async () => {
        const f = fixture();
        const response = deferred();
        f.replies[operation.action] = () => response.promise;
        f.replies.reload = async () => {
          throw new Error('Synthetic refresh failure');
        };
        const pending = run(f, operation);
        await new Promise((resolve) => setImmediate(resolve));
        f.state.newBatchCapacity.set('13');
        f.schedules[batch.id] = '2030-06-14T09:30';
        if (failure === 'mutation')
          response.reject(new Error('Synthetic mutation failure'));
        else response.resolve({ batch: { id: 'synthetic-server' } });
        await pending;
        assert.deepEqual(f.events.slice(-2), [['failed'], ['action', null]]);
        assert.equal(
          f.events.some(([event]) => event === 'reload'),
          failure === 'reload'
        );
        assert.equal(
          f.events.some(([event]) => event === 'focus'),
          false
        );
        assert.equal(f.state.newBatchCapacity(), '13');
        assert.equal(f.schedules[batch.id], '2030-06-14T09:30');
        assert.equal(f.state.batchActionState(), null);
        if (operation.action === 'create') {
          assert.equal(f.state.newBatchOpen(), failure === 'mutation');
          assert.equal(
            f.state.selectedBatchId(),
            failure === 'mutation' ? 'synthetic-previous' : 'synthetic-server'
          );
        }
      });
    }
  }
});

test('lifecycle actions keep their existing reload behavior for negative or empty server results', async (t) => {
  for (const operation of operations.filter(
    (item) => item.action !== 'create'
  )) {
    for (const reply of [undefined, { [operation.flag]: false, batch: null }]) {
      await t.test(`${operation.action} ${JSON.stringify(reply)}`, async () => {
        const f = fixture();
        f.replies[operation.action] = async () => reply;
        await run(f, operation);
        assert.equal(
          f.events.some(([event]) => event === 'reload'),
          true
        );
        assert.equal(
          f.events.some(([event]) => event === 'failed'),
          false
        );
        assert.equal(f.state.selectedBatchId(), 'synthetic-previous');
        assert.equal(f.state.batchActionState(), null);
      });
    }
  }
});
