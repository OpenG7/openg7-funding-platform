import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminAccessController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-access-page/admin-access-controller.js';
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
const account = (changes = {}) => ({
  id: 'synthetic-operator',
  subject: 'fixture-operator',
  displayName: 'Synthetic operator',
  role: 'operator',
  disabled: false,
  ...changes
});
const emptyDraft = () => ({
  id: '',
  subject: '',
  displayName: '',
  role: 'reader',
  disabled: false
});
const snapshot = (changes = {}) => ({
  accounts: [account()],
  sessions: [
    {
      id: 'synthetic-session',
      accountId: 'synthetic-operator',
      createdAt: '2026-10-04T12:00:00Z',
      expiresAt: '2026-10-04T13:00:00Z'
    }
  ],
  ...changes
});
const fixture = (t) => {
  const calls = { reads: 0, changes: [], expirations: 0, focus: [] };
  const ports = {
    admin: {
      accessAccounts: async () => {
        calls.reads++;
        return snapshot();
      },
      updateAccess: async (input) => {
        calls.changes.push(input);
      }
    },
    onSessionExpired: () => calls.expirations++,
    restoreRevokeFocus: (id) => calls.focus.push(id)
  };
  const controller = new AdminAccessController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, calls };
};

test('access consultation starts explicitly and retains confirmed data on an ordinary read failure', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  assert.equal(c.data(), null);
  assert.equal(c.busy(), false);
  assert.equal(c.error(), '');
  assert.deepEqual(c.draft(), emptyDraft());
  assert.equal(c.confirmed(), false);
  assert.equal(c.pendingSession(), null);
  assert.equal(calls.reads, 0);
  const pending = deferred();
  const expected = snapshot();
  ports.admin.accessAccounts = () => pending.promise;
  c.error.set('previous failure');
  const read = c.load();
  assert.equal(c.busy(), true);
  assert.equal(c.error(), '');
  assert.equal(c.data(), null);
  pending.resolve(expected);
  await read;
  assert.equal(c.data(), expected);
  assert.equal(c.busy(), false);
  ports.admin.accessAccounts = async () => {
    throw new Error('Synthetic unavailable');
  };
  await c.load();
  assert.equal(c.data(), expected);
  assert.equal(c.error(), 'admin.access.error');
  assert.equal(c.busy(), false);
});

test('editing copies the account and every field change invalidates confirmation without changing server data', async (t) => {
  const { controller: c } = fixture(t);
  await c.load();
  const source = c.data().accounts[0];
  c.confirmed.set(true);
  c.edit(source);
  assert.notEqual(c.draft(), source);
  assert.deepEqual(c.draft(), source);
  assert.equal(c.confirmed(), false);
  for (const change of [
    { field: 'subject', value: 'fixture-new-subject' },
    { field: 'displayName', value: 'Synthetic updated name' },
    { field: 'role', value: 'reader' },
    { field: 'disabled', value: true }
  ]) {
    c.confirmed.set(true);
    c.changeField(change);
    assert.equal(c.draft()[change.field], change.value);
    assert.equal(c.confirmed(), false);
  }
  assert.deepEqual(source, account());
  c.confirmed.set(true);
  c.newAccount();
  assert.deepEqual(c.draft(), emptyDraft());
  assert.equal(c.confirmed(), false);
});

test('saving requires confirmation, sends the captured subject and waits for mutation plus server reread', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  await c.load();
  const original = c.data();
  c.edit(account({ displayName: 'Synthetic edited', disabled: true }));
  await c.save();
  assert.deepEqual(calls.changes, []);
  const mutation = deferred();
  const consultation = deferred();
  ports.admin.updateAccess = (input) => {
    calls.changes.push(input);
    return mutation.promise;
  };
  ports.admin.accessAccounts = () => {
    calls.reads++;
    return consultation.promise;
  };
  c.confirmed.set(true);
  const submitted = c.draft();
  const saving = c.save();
  assert.deepEqual(calls.changes, [
    { ...submitted, confirmation: 'fixture-operator' }
  ]);
  assert.notEqual(calls.changes[0], submitted);
  assert.equal(c.busy(), true);
  assert.equal(c.confirmed(), true);
  assert.equal(c.data(), original);
  assert.equal(calls.reads, 1);
  await c.save();
  c.selectSession('synthetic-session');
  await c.revoke('synthetic-session');
  c.cancelRevoke();
  assert.equal(c.pendingSession(), 'synthetic-session');
  assert.deepEqual(calls.focus, []);
  assert.equal(calls.changes.length, 1);
  mutation.resolve();
  await Promise.resolve();
  assert.equal(calls.reads, 2);
  assert.equal(c.busy(), true);
  assert.equal(c.confirmed(), true);
  assert.equal(c.data(), original);
  await c.save();
  assert.equal(calls.changes.length, 1);
  const expected = snapshot({ accounts: [submitted], sessions: [] });
  consultation.resolve(expected);
  await saving;
  assert.equal(c.data(), expected);
  assert.equal(c.busy(), false);
  assert.equal(c.confirmed(), false);
  assert.deepEqual(c.draft(), submitted);
});

test('new account saving preserves all draft fields and uses the subject as confirmation', async (t) => {
  const { controller: c, calls } = fixture(t);
  c.changeField({ field: 'subject', value: 'fixture-new-owner' });
  c.changeField({ field: 'displayName', value: 'Synthetic new owner' });
  c.changeField({ field: 'role', value: 'owner' });
  c.confirmed.set(true);
  await c.save();
  assert.deepEqual(calls.changes, [
    {
      id: '',
      subject: 'fixture-new-owner',
      displayName: 'Synthetic new owner',
      role: 'owner',
      disabled: false,
      confirmation: 'fixture-new-owner'
    }
  ]);
  assert.equal(calls.reads, 1);
  assert.equal(c.confirmed(), false);
});

for (const [failure, key] of [
  [new AdminDashboardRequestError(409, 'LAST_OWNER'), 'admin.access.lastOwner'],
  [new Error('LAST_OWNER'), 'admin.access.lastOwner'],
  [
    new AdminDashboardRequestError(503, 'ACCESS_UNAVAILABLE'),
    'admin.access.error'
  ],
  ['Synthetic non-Error failure', 'admin.access.error']
])
  test(`save failure ${failure.message ?? failure} keeps the draft and requires confirmation again`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    await c.load();
    const original = c.data();
    const edited = account({ role: 'reader', disabled: true });
    c.edit(edited);
    c.confirmed.set(true);
    ports.admin.updateAccess = async () => {
      throw failure;
    };
    await c.save();
    assert.equal(c.error(), key);
    assert.equal(c.data(), original);
    assert.deepEqual(c.draft(), edited);
    assert.equal(c.confirmed(), false);
    assert.equal(c.busy(), false);
    assert.equal(calls.reads, 1);
    await c.save();
    assert.equal(calls.reads, 1);
  });

test('a failed post-save reread retains the server snapshot and edited draft with an error', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  await c.load();
  const original = c.data();
  c.edit(account({ displayName: 'Synthetic unsynchronized edit' }));
  const edited = c.draft();
  ports.admin.accessAccounts = async () => {
    throw new Error('Synthetic consultation unavailable');
  };
  c.confirmed.set(true);
  await c.save();
  assert.equal(calls.changes.length, 1);
  assert.equal(c.data(), original);
  assert.equal(c.draft(), edited);
  assert.equal(c.error(), 'admin.access.error');
  assert.equal(c.confirmed(), false);
  assert.equal(c.busy(), false);
});

test('revocation requires the selected session and cancel restores its focus without any mutation', async (t) => {
  const { controller: c, calls } = fixture(t);
  await c.load();
  await c.revoke('synthetic-session');
  c.selectSession('synthetic-session');
  await c.revoke('different-synthetic-session');
  assert.deepEqual(calls.changes, []);
  assert.equal(c.pendingSession(), 'synthetic-session');
  c.cancelRevoke();
  assert.equal(c.pendingSession(), null);
  assert.deepEqual(calls.focus, ['synthetic-session']);
  assert.deepEqual(calls.changes, []);
});

test('revocation waits for rereading before clearing the panel and restoring focus', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  await c.load();
  const mutation = deferred();
  const consultation = deferred();
  ports.admin.updateAccess = (input) => {
    calls.changes.push(input);
    return mutation.promise;
  };
  ports.admin.accessAccounts = () => {
    calls.reads++;
    return consultation.promise;
  };
  ports.restoreRevokeFocus = (id) => {
    assert.equal(c.busy(), false);
    assert.equal(c.pendingSession(), null);
    assert.deepEqual(c.data().sessions, []);
    calls.focus.push(id);
  };
  c.selectSession('synthetic-session');
  const revoking = c.revoke('synthetic-session');
  assert.deepEqual(calls.changes, [
    { sessionId: 'synthetic-session', confirmation: 'synthetic-session' }
  ]);
  await c.revoke('synthetic-session');
  c.cancelRevoke();
  assert.equal(c.pendingSession(), 'synthetic-session');
  assert.deepEqual(calls.focus, []);
  mutation.resolve();
  await Promise.resolve();
  assert.equal(calls.reads, 2);
  assert.equal(c.busy(), true);
  assert.equal(c.pendingSession(), 'synthetic-session');
  consultation.resolve(snapshot({ sessions: [] }));
  await revoking;
  assert.deepEqual(calls.focus, ['synthetic-session']);
  assert.equal(calls.changes.length, 1);
});

test('ordinary revocation failure closes the panel after exposing its error and preserves private data', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  await c.load();
  const original = c.data();
  ports.admin.updateAccess = async () => {
    throw new Error('Synthetic revocation unavailable');
  };
  ports.restoreRevokeFocus = (id) => {
    assert.equal(c.error(), 'admin.access.error');
    assert.equal(c.busy(), false);
    assert.equal(c.pendingSession(), null);
    calls.focus.push(id);
  };
  c.selectSession('synthetic-session');
  await c.revoke('synthetic-session');
  assert.equal(c.data(), original);
  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.focus, ['synthetic-session']);
});

for (const status of [401, 403])
  for (const operation of ['read', 'save', 'revoke', 'save-reread'])
    test(`${operation} refusal ${status} clears private data, draft and confirmation before its external effects`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      await c.load();
      c.edit(account({ displayName: 'Synthetic private draft' }));
      c.confirmed.set(true);
      c.selectSession('synthetic-session');
      const assertCleared = () => {
        assert.equal(c.data(), null);
        assert.equal(c.pendingSession(), null);
        assert.deepEqual(c.draft(), emptyDraft());
        assert.equal(c.confirmed(), false);
      };
      ports.onSessionExpired = () => {
        assertCleared();
        assert.equal(c.busy(), true);
        calls.expirations++;
      };
      ports.restoreRevokeFocus = (id) => {
        assertCleared();
        assert.equal(c.busy(), false);
        calls.focus.push(id);
      };
      const refuse = async () => {
        throw new AdminDashboardRequestError(
          status,
          'Synthetic access refusal'
        );
      };
      if (operation === 'read' || operation === 'save-reread')
        ports.admin.accessAccounts = refuse;
      else ports.admin.updateAccess = refuse;
      if (operation === 'read') await c.load();
      else if (operation === 'revoke') await c.revoke('synthetic-session');
      else await c.save();
      assertCleared();
      assert.equal(c.busy(), false);
      assert.equal(calls.expirations, status === 401 ? 1 : 0);
      assert.equal(
        c.error(),
        status === 403 ? 'admin.access.ownerRequired' : ''
      );
      assert.deepEqual(calls.focus, operation === 'revoke' ? [null] : []);
    });

for (const outcome of ['resolve', 'reject'])
  test(`disposal ignores a read that later ${outcome}s and prevents further controller effects`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const pending = deferred();
    ports.admin.accessAccounts = () => {
      calls.reads++;
      return pending.promise;
    };
    const reading = c.load();
    c.dispose();
    if (outcome === 'resolve') pending.resolve(snapshot());
    else pending.reject(new AdminDashboardRequestError(401));
    await reading;
    const originalDraft = c.draft();
    c.edit(account());
    c.newAccount();
    c.changeField({ field: 'subject', value: 'fixture-after-dispose' });
    c.selectSession('synthetic-session');
    c.cancelRevoke();
    c.confirmed.set(true);
    await c.load();
    await c.save();
    await c.revoke('synthetic-session');
    assert.equal(c.data(), null);
    assert.equal(c.draft(), originalDraft);
    assert.equal(c.pendingSession(), null);
    assert.equal(calls.reads, 1);
    assert.deepEqual(calls.changes, []);
    assert.equal(calls.expirations, 0);
    assert.deepEqual(calls.focus, []);
  });

for (const operation of ['save', 'revoke'])
  for (const outcome of ['resolve', 'reject'])
    test(`disposal during ${operation} ignores a mutation that later ${outcome}s without rereading, navigation or focus`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      await c.load();
      const original = c.data();
      c.edit(account());
      c.confirmed.set(true);
      c.selectSession('synthetic-session');
      const pending = deferred();
      ports.admin.updateAccess = (input) => {
        calls.changes.push(input);
        return pending.promise;
      };
      const changing =
        operation === 'save' ? c.save() : c.revoke('synthetic-session');
      c.dispose();
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new AdminDashboardRequestError(401));
      await changing;
      assert.equal(c.data(), original);
      assert.equal(c.confirmed(), true);
      assert.equal(c.pendingSession(), 'synthetic-session');
      assert.equal(calls.changes.length, 1);
      assert.equal(calls.reads, 1);
      assert.equal(calls.expirations, 0);
      assert.deepEqual(calls.focus, []);
    });
