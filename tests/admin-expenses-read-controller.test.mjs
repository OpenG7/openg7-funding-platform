import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminExpensesReadController,
  expenseDateTimeLocal,
  updatedExpenseDateTime
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-read-controller.js';

const originalVersion = '2026-10-02T12:00:00.123Z';
const nextVersion = '2026-10-02T12:01:00.456Z';
const record = (id = 'allocation-a', fields = {}) => ({
  id,
  project_name: `Synthetic ${id}`,
  public_description: 'Public description',
  expected_outcome: 'Expected outcome',
  progress_status: 'planned',
  proof_url: 'https://example.test/proof',
  proof_source: 'Synthetic evidence',
  proof_published_at: originalVersion,
  amount_allocated: 42.5,
  currency: 'CAD',
  status: 'draft',
  published_at: null,
  created_at: originalVersion,
  updated_at: originalVersion,
  ...fields
});
const response = (...expenses) => ({
  data_source: 'database',
  expenses,
  summary: { total_count: expenses.length, currency: 'CAD' },
  last_updated_at: originalVersion
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
  const calls = [];
  const savedTokens = [];
  const ports = {
    admin: {
      getExpenses: async (token, expenseId) => {
        calls.push({ token, expenseId });
        return response(record());
      },
      saveAdminToken: (token) => savedTokens.push(token)
    },
    token: () => 'synthetic-session'
  };
  return {
    read: new AdminExpensesReadController(ports),
    ports,
    calls,
    savedTokens
  };
};

test('reads expose loading, authoritative data and errors without losing existing drafts', async () => {
  const f = fixture();
  assert.equal(f.read.state(), 'idle');
  assert.equal(f.read.response(), null);
  assert.deepEqual(f.calls, []);
  f.read.setScope('allocation-a');
  const pending = deferred();
  f.ports.admin.getExpenses = (token, expenseId) => {
    f.calls.push({ token, expenseId });
    return pending.promise;
  };
  const loading = f.read.load();
  assert.equal(f.read.state(), 'loading');
  const confirmed = response(record());
  pending.resolve(confirmed);
  await loading;
  assert.equal(f.read.response(), confirmed);
  assert.equal(f.read.state(), 'ready');
  assert.deepEqual(f.calls, [
    { token: 'synthetic-session', expenseId: 'allocation-a' }
  ]);
  assert.deepEqual(f.savedTokens, ['synthetic-session']);
  f.read.setEditField('allocation-a', {
    field: 'publicDescription',
    value: 'Unsaved description'
  });
  f.ports.admin.getExpenses = async () => {
    throw new Error('unavailable');
  };
  await f.read.load();
  assert.equal(f.read.state(), 'error');
  assert.equal(f.read.response(), confirmed);
  assert.equal(
    f.read.editFor('allocation-a').publicDescription,
    'Unsaved description'
  );
  assert.equal(f.read.baseFor('allocation-a').updated_at, originalVersion);
  assert.deepEqual(f.savedTokens, ['synthetic-session']);
});

test('automatic reads preserve dirty drafts and their original version while updating clean rows', async () => {
  const f = fixture();
  f.ports.admin.getExpenses = async () =>
    response(record(), record('allocation-b'));
  await f.read.load();
  const scope = f.read.scopeRevision();
  f.read.setEditField('allocation-a', {
    field: 'projectName',
    value: 'Unsaved project'
  });
  const pending = deferred();
  f.ports.admin.getExpenses = () => pending.promise;
  const reading = f.read.load(true);
  f.read.setEditField('allocation-a', {
    field: 'proofSource',
    value: 'Typed during read'
  });
  pending.resolve(
    response(
      record('allocation-a', {
        project_name: 'Concurrent project',
        updated_at: nextVersion
      }),
      record('allocation-b', {
        project_name: 'Refreshed clean project',
        updated_at: nextVersion
      })
    )
  );
  await reading;
  assert.equal(f.read.scopeRevision(), scope);
  assert.equal(f.read.editFor('allocation-a').projectName, 'Unsaved project');
  assert.equal(f.read.editFor('allocation-a').proofSource, 'Typed during read');
  assert.equal(f.read.baseFor('allocation-a').updated_at, originalVersion);
  assert.equal(f.read.response().expenses[0].updated_at, nextVersion);
  assert.equal(
    f.read.editFor('allocation-b').projectName,
    'Refreshed clean project'
  );
  assert.equal(f.read.baseFor('allocation-b').updated_at, nextVersion);
  assert.equal(f.read.conflict(), true);

  f.ports.admin.getExpenses = async () =>
    response(
      record('allocation-a', {
        project_name: 'Explicitly refreshed project',
        updated_at: nextVersion
      })
    );
  await f.read.load();
  assert.equal(
    f.read.editFor('allocation-a').projectName,
    'Explicitly refreshed project'
  );
  assert.equal(
    f.read.editFor('allocation-a').proofSource,
    'Synthetic evidence'
  );
  assert.equal(f.read.baseFor('allocation-a').updated_at, nextVersion);
  assert.equal(f.read.conflict(), false);
  assert.equal(f.read.baseFor('allocation-b'), undefined);
});

test('confirmed writes reconcile each untouched field and keep new input on the confirmed version', async () => {
  const f = fixture();
  await f.read.load();
  f.read.setEditField('allocation-a', {
    field: 'projectName',
    value: 'Submitted project'
  });
  const submitted = f.read.editFor('allocation-a');
  f.read.setEditField('allocation-a', {
    field: 'publicDescription',
    value: 'Next description'
  });
  f.read.setEditField('allocation-a', {
    field: 'amountAllocated',
    value: '100.25'
  });
  f.read.setEditField('allocation-a', {
    field: 'proofPublishedAt',
    value: '2026-10-03T09:15'
  });
  const confirmed = record('allocation-a', {
    project_name: 'Server project',
    public_description: 'Server description',
    expected_outcome: 'Server outcome',
    progress_status: 'delivered',
    proof_url: 'https://example.test/confirmed',
    proof_source: 'Server source',
    proof_published_at: nextVersion,
    amount_allocated: 50,
    status: 'published',
    published_at: nextVersion,
    updated_at: nextVersion
  });
  f.read.reconcileSavedEdit(confirmed, submitted);
  assert.deepEqual(f.read.editFor('allocation-a'), {
    projectName: 'Server project',
    publicDescription: 'Next description',
    expectedOutcome: 'Server outcome',
    progressStatus: 'delivered',
    proofUrl: 'https://example.test/confirmed',
    proofSource: 'Server source',
    proofPublishedAt: '2026-10-03T09:15',
    amountAllocated: '100.25',
    status: 'published',
    publishedAt: expenseDateTimeLocal(nextVersion)
  });
  assert.equal(f.read.baseFor('allocation-a'), confirmed);
  assert.equal(f.read.response().expenses[0], confirmed);
  f.ports.admin.getExpenses = async () => response(confirmed);
  await f.read.load(true);
  assert.equal(
    f.read.editFor('allocation-a').publicDescription,
    'Next description'
  );
  assert.equal(f.read.baseFor('allocation-a').updated_at, nextVersion);
  assert.equal(f.read.conflict(), false);
});

for (const outcome of ['resolve', 'reject']) {
  test(`older read ${outcome} cannot replace a newer read`, async () => {
    const f = fixture();
    const pending = deferred();
    f.ports.admin.getExpenses = () => pending.promise;
    const oldRead = f.read.load();
    const latest = response(
      record('allocation-a', { updated_at: nextVersion })
    );
    f.ports.admin.getExpenses = async () => latest;
    await f.read.load();
    if (outcome === 'resolve') pending.resolve(response(record()));
    else pending.reject(new Error('unavailable'));
    await oldRead;
    assert.equal(f.read.response(), latest);
    assert.equal(f.read.state(), 'ready');
    assert.deepEqual(f.savedTokens, ['synthetic-session']);
  });
}

for (const ending of ['scope round trip', 'dispose']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`late read ${outcome} after ${ending} cannot affect the current context`, async () => {
      const f = fixture();
      f.read.setScope('allocation-a');
      const revision = f.read.scopeRevision();
      const pending = deferred();
      f.ports.admin.getExpenses = () => pending.promise;
      const loading = f.read.load();
      if (ending === 'dispose') f.read.dispose();
      else {
        f.read.setScope('allocation-b');
        f.read.setScope('allocation-a');
        f.ports.admin.getExpenses = async () => response(record());
        await f.read.load();
        f.read.setEditField('allocation-a', {
          field: 'projectName',
          value: 'New scope draft'
        });
      }
      assert.equal(f.read.isCurrentScope(revision), false);
      const currentResponse = f.read.response();
      const currentEdits = f.read.expenseEdits();
      const currentState = f.read.state();
      const savedCount = f.savedTokens.length;
      if (outcome === 'resolve')
        pending.resolve(
          response(record('allocation-a', { updated_at: nextVersion }))
        );
      else pending.reject(new Error('unavailable'));
      await loading;
      assert.equal(f.read.response(), currentResponse);
      assert.equal(f.read.expenseEdits(), currentEdits);
      assert.equal(f.read.state(), currentState);
      assert.equal(f.savedTokens.length, savedCount);
      if (ending === 'dispose') {
        await f.read.load();
        f.read.setScope('allocation-b');
        assert.equal(f.read.response(), currentResponse);
      }
    });
  }
}

test('local minute fields preserve original date precision and use the browser timezone for changes', () => {
  const date = new Date(originalVersion);
  const pad = (value) => String(value).padStart(2, '0');
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.equal(expenseDateTimeLocal(originalVersion), local);
  assert.equal(updatedExpenseDateTime(local, originalVersion), originalVersion);
  assert.equal(
    updatedExpenseDateTime('2026-10-03T09:15', originalVersion),
    new Date('2026-10-03T09:15').toISOString()
  );
  assert.equal(expenseDateTimeLocal(null), '');
  assert.equal(expenseDateTimeLocal('invalid'), '');
  assert.equal(updatedExpenseDateTime('', originalVersion), null);
});
