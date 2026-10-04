import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { AdminExpensesReadController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-read-controller.js';

// The root TypeScript build emits workspaces under dist/, without package-local builds.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core') {
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});
const { AdminExpensesMutationWorkflow } =
  await import('../dist/apps/funding-web/src/app/features/funding/pages/admin-expenses-page/admin-expenses-mutation-workflow.js');
workspaceHook.deregister();

const originalVersion = '2026-10-02T12:00:00.123Z';
const nextVersion = '2026-10-02T12:01:00.456Z';
const record = (fields = {}) => ({
  id: 'allocation-a',
  project_name: 'Synthetic allocation',
  public_description: 'Public description',
  expected_outcome: 'Expected outcome',
  progress_status: 'planned',
  proof_url: 'https://example.test/proof',
  proof_source: 'Synthetic evidence',
  proof_published_at: originalVersion,
  amount_allocated: 42.5,
  currency: 'CAD',
  status: 'draft',
  published_at: originalVersion,
  created_at: originalVersion,
  updated_at: originalVersion,
  ...fields
});
const draft = (fields = {}) => ({
  projectName: ' New allocation ',
  publicDescription: ' New description ',
  expectedOutcome: ' New outcome ',
  progressStatus: 'in_progress',
  proofUrl: ' https://example.test/new-proof ',
  proofSource: ' New evidence ',
  proofPublishedAt: '2026-10-02T09:15',
  amountAllocated: '42.50',
  status: 'draft',
  ...fields
});
const emptyDraft = () =>
  draft({
    projectName: '',
    publicDescription: '',
    expectedOutcome: '',
    progressStatus: 'planned',
    proofUrl: '',
    proofSource: '',
    proofPublishedAt: '',
    amountAllocated: '',
    status: 'draft'
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
const fixture = async (initial = record()) => {
  const creates = [];
  const updates = [];
  const confirmations = [];
  const reads = [];
  let rows = [initial];
  let currentDraft = draft();
  let resets = 0;
  const readPorts = {
    admin: {
      getExpenses: async (token, expenseId) => {
        reads.push({ token, expenseId });
        return { expenses: rows, summary: { currency: 'CAD' } };
      },
      saveAdminToken: () => {}
    },
    token: () => 'synthetic-session'
  };
  const read = new AdminExpensesReadController(readPorts);
  read.setScope('allocation-a');
  await read.load();
  const ports = {
    admin: {
      createExpense: async (token, payload) => {
        creates.push({ token, payload });
        return { updated: true, expense: record() };
      },
      updateExpense: async (token, payload) => {
        updates.push({ token, payload });
        return { updated: true, expense: rows[0] };
      }
    },
    confirmation: {
      confirm: async (title, description) => {
        confirmations.push({ title, description });
        return true;
      }
    },
    read,
    token: () => 'synthetic-session',
    draft: () => currentDraft,
    resetDraftIfUnchanged: (submitted) => {
      if (
        Object.keys(submitted).every(
          (field) => currentDraft[field] === submitted[field]
        )
      ) {
        currentDraft = emptyDraft();
        resets++;
      }
    },
    t: (key) => key,
    formatMoney: (amount, currency) => `${amount} ${currency}`
  };
  return {
    workflow: new AdminExpensesMutationWorkflow(ports),
    read,
    ports,
    readPorts,
    creates,
    updates,
    reads,
    confirmations,
    draft: () => currentDraft,
    setDraft: (value) => {
      currentDraft = value;
    },
    setRows: (value) => {
      rows = value;
    },
    resets: () => resets
  };
};

test('public creation freezes confirmed contents and keeps new input while blocking a second write', async () => {
  const f = await fixture();
  f.setDraft(draft({ status: 'published' }));
  const original = { ...f.draft() };
  const confirmation = deferred();
  const pending = deferred();
  f.ports.confirmation.confirm = (title, description) => {
    f.confirmations.push({ title, description });
    return confirmation.promise;
  };
  f.ports.admin.createExpense = (token, payload) => {
    f.creates.push({ token, payload });
    return pending.promise;
  };
  const creating = f.workflow.create();
  assert.equal(f.workflow.busy(), true);
  assert.deepEqual(f.confirmations, [
    {
      title: 'admin.confirmation.publish',
      description: `${original.projectName} · 42.5 CAD · ${original.publicDescription} · ${original.expectedOutcome} · ${original.proofUrl}`
    }
  ]);
  // A port returning a mutable draft must still be treated as a snapshot.
  f.draft().projectName = 'Next allocation';
  f.draft().status = 'draft';
  await f.workflow.create();
  await f.workflow.save(record(), 'published');
  assert.equal(f.creates.length, 0);
  confirmation.resolve(true);
  await Promise.resolve();
  assert.deepEqual(f.creates, [
    {
      token: 'synthetic-session',
      payload: {
        confirmation: 'CREATE_PUBLIC_ALLOCATION',
        projectName: 'New allocation',
        publicDescription: 'New description',
        expectedOutcome: 'New outcome',
        progressStatus: 'in_progress',
        proofUrl: 'https://example.test/new-proof',
        proofSource: 'New evidence',
        proofPublishedAt: new Date(original.proofPublishedAt).toISOString(),
        amountAllocated: 42.5,
        currency: 'CAD',
        status: 'published'
      }
    }
  ]);
  await f.workflow.create();
  pending.resolve({ updated: true, expense: record() });
  await creating;
  assert.equal(f.draft().projectName, 'Next allocation');
  assert.equal(f.resets(), 0);
  assert.equal(f.reads.length, 2);
  assert.equal(f.workflow.busy(), false);
});

test('cancelled creation leaves the form unchanged without a write or reload', async () => {
  const f = await fixture();
  f.setDraft(draft({ status: 'active' }));
  const original = f.draft();
  f.ports.confirmation.confirm = async () => false;
  await f.workflow.create();
  assert.equal(f.draft(), original);
  assert.equal(f.creates.length, 0);
  assert.equal(f.reads.length, 1);
  assert.equal(f.workflow.busy(), false);
});

test('creation resets only an unchanged successful draft and retains input on failure', async () => {
  const f = await fixture();
  await f.workflow.create();
  assert.deepEqual(f.draft(), emptyDraft());
  assert.equal(f.resets(), 1);
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.creates[0].payload.confirmation, undefined);
  f.setDraft(draft());
  const before = f.draft();
  f.ports.admin.createExpense = async () => {
    throw new Error('unavailable');
  };
  await f.workflow.create();
  assert.equal(f.draft(), before);
  assert.equal(f.resets(), 1);
  assert.equal(f.reads.length, 2);
  assert.equal(f.read.state(), 'error');
  assert.equal(f.workflow.busy(), false);
});

test('invalid amounts and missing creation fields cannot reach confirmation or the API', async () => {
  for (const fields of [
    { projectName: ' ' },
    { publicDescription: ' ' },
    { expectedOutcome: ' ' },
    { amountAllocated: '0' },
    { amountAllocated: '0.001' },
    { amountAllocated: '9007199254740991' }
  ]) {
    const f = await fixture();
    f.setDraft(draft({ ...fields, status: 'published' }));
    await f.workflow.create();
    assert.equal(f.read.state(), 'error');
    assert.equal(f.workflow.busy(), false);
    assert.deepEqual(f.creates, []);
    assert.deepEqual(f.confirmations, []);
  }
  const f = await fixture();
  f.read.setEditField('allocation-a', {
    field: 'amountAllocated',
    value: '0.001'
  });
  await f.workflow.save(record(), 'published');
  assert.equal(f.read.state(), 'error');
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.confirmations, []);
});

test('an automatic read cannot authorize an old draft with a new version, and conflict preserves input', async () => {
  const f = await fixture();
  f.read.setEditField('allocation-a', {
    field: 'projectName',
    value: 'Old unsaved project'
  });
  const concurrent = record({
    project_name: 'Concurrent project',
    updated_at: nextVersion
  });
  f.setRows([concurrent]);
  await f.read.load(true);
  f.ports.admin.updateExpense = async (token, payload) => {
    f.updates.push({ token, payload });
    throw new Error('version_conflict');
  };
  const edits = f.read.expenseEdits();
  await f.workflow.save(concurrent);
  assert.equal(f.updates[0].payload.expectedVersion, originalVersion);
  assert.equal(f.read.conflict(), true);
  assert.equal(f.read.expenseEdits(), edits);
  assert.equal(f.read.baseFor('allocation-a').updated_at, originalVersion);
  assert.equal(f.reads.length, 2);
  assert.equal(f.read.state(), 'ready');
  assert.equal(f.workflow.busy(), false);
  await f.read.load();
  assert.equal(
    f.read.editFor('allocation-a').projectName,
    'Concurrent project'
  );
  assert.equal(f.read.baseFor('allocation-a').updated_at, nextVersion);
  assert.equal(f.read.conflict(), false);
});

test('publication reconciles late input before a failed reload and preserves precise unchanged dates', async () => {
  const f = await fixture();
  f.read.setEditField('allocation-a', {
    field: 'projectName',
    value: 'Submitted project'
  });
  const pending = deferred();
  f.ports.admin.updateExpense = (token, payload) => {
    f.updates.push({ token, payload });
    return pending.promise;
  };
  const saving = f.workflow.save(record(), 'published');
  await Promise.resolve();
  assert.equal(f.updates[0].payload.expectedVersion, originalVersion);
  assert.equal(f.updates[0].payload.confirmation, 'allocation-a');
  assert.equal(f.updates[0].payload.currency, 'CAD');
  assert.equal(f.updates[0].payload.amountAllocated, 42.5);
  assert.equal(f.updates[0].payload.proofPublishedAt, originalVersion);
  assert.equal(f.updates[0].payload.publishedAt, originalVersion);
  f.read.setEditField('allocation-a', {
    field: 'publicDescription',
    value: 'Next description'
  });
  f.read.setEditField('allocation-a', {
    field: 'amountAllocated',
    value: '75.25'
  });
  f.readPorts.admin.getExpenses = async () => {
    f.reads.push({ failed: true });
    throw new Error('unavailable');
  };
  const confirmed = record({
    project_name: 'Server project',
    status: 'published',
    updated_at: nextVersion
  });
  pending.resolve({ updated: true, expense: confirmed });
  await saving;
  assert.equal(f.read.editFor('allocation-a').projectName, 'Server project');
  assert.equal(
    f.read.editFor('allocation-a').publicDescription,
    'Next description'
  );
  assert.equal(f.read.editFor('allocation-a').amountAllocated, '75.25');
  assert.equal(f.read.editFor('allocation-a').status, 'published');
  assert.equal(f.read.baseFor('allocation-a').updated_at, nextVersion);
  assert.equal(f.read.response().expenses[0], confirmed);
  assert.equal(f.read.state(), 'error');
  assert.equal(f.workflow.busy(), false);
});

test('confirmation cancellation and write failure preserve edits without optimistic publication', async () => {
  const f = await fixture();
  f.read.setEditField('allocation-a', {
    field: 'projectName',
    value: 'Unsaved project'
  });
  f.ports.confirmation.confirm = async () => false;
  await f.workflow.save(record(), 'published');
  assert.equal(f.updates.length, 0);
  assert.equal(f.read.editFor('allocation-a').projectName, 'Unsaved project');
  assert.equal(f.reads.length, 1);
  f.ports.confirmation.confirm = async () => true;
  f.ports.admin.updateExpense = async () => {
    throw new Error('forbidden');
  };
  await f.workflow.save(record(), 'published');
  assert.equal(f.read.state(), 'error');
  assert.equal(f.read.response().expenses[0].status, 'draft');
  assert.equal(f.read.editFor('allocation-a').projectName, 'Unsaved project');
  assert.equal(f.read.baseFor('allocation-a').updated_at, originalVersion);
  assert.equal(f.reads.length, 1);
});

for (const status of ['private', 'archived']) {
  test(`hiding a public allocation as ${status} retains its mandatory confirmation`, async () => {
    const initial = record({ status: 'published' });
    const f = await fixture(initial);
    await f.workflow.save(initial, status);
    assert.equal(
      f.confirmations[0].title,
      'admin.confirmation.cancelPublication'
    );
    assert.equal(f.updates[0].payload.confirmation, initial.id);
    assert.equal(f.updates[0].payload.status, status);
  });
}

for (const action of ['create', 'save']) {
  for (const phase of ['confirmation', 'request']) {
    for (const ending of ['scope round trip', 'dispose']) {
      for (const outcome of ['resolve', 'reject']) {
        test(`late ${action} ${phase} ${outcome} after ${ending} cannot write, reload or change current input`, async () => {
          const f = await fixture();
          f.setDraft(draft({ status: 'published' }));
          const pending = deferred();
          if (phase === 'confirmation')
            f.ports.confirmation.confirm = () => pending.promise;
          else {
            f.ports.admin[
              action === 'create' ? 'createExpense' : 'updateExpense'
            ] = (token, payload) => {
              (action === 'create' ? f.creates : f.updates).push({
                token,
                payload
              });
              return pending.promise;
            };
          }
          const running =
            action === 'create'
              ? f.workflow.create()
              : f.workflow.save(record(), 'published');
          await Promise.resolve();
          if (ending === 'dispose') {
            f.read.dispose();
            f.workflow.dispose();
          } else {
            f.read.setScope('allocation-b');
            f.read.setScope('allocation-a');
            await f.read.load();
            f.read.setEditField('allocation-a', {
              field: 'projectName',
              value: 'Restored scope draft'
            });
            f.setDraft(draft({ projectName: 'Restored creation draft' }));
          }
          const snapshot = {
            response: f.read.response(),
            edits: f.read.expenseEdits(),
            draft: f.draft(),
            state: f.read.state(),
            conflict: f.read.conflict(),
            reads: f.reads.length,
            writes: f.creates.length + f.updates.length
          };
          if (outcome === 'resolve')
            pending.resolve(
              phase === 'confirmation'
                ? true
                : {
                    updated: true,
                    expense: record({
                      status: 'published',
                      updated_at: nextVersion
                    })
                  }
            );
          else pending.reject(new Error('version_conflict'));
          await running;
          assert.equal(f.read.response(), snapshot.response);
          assert.equal(f.read.expenseEdits(), snapshot.edits);
          assert.equal(f.draft(), snapshot.draft);
          assert.equal(f.read.state(), snapshot.state);
          assert.equal(f.read.conflict(), snapshot.conflict);
          assert.equal(f.reads.length, snapshot.reads);
          assert.equal(f.creates.length + f.updates.length, snapshot.writes);
          assert.equal(f.resets(), 0);
          assert.equal(f.workflow.busy(), false);
        });
      }
    }
  }
}
