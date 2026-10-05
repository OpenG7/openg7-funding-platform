import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPublicationDraftsWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-drafts-workflow.js';

const draft = (overrides = {}) => ({
  id: 'synthetic-draft',
  title: 'Server title',
  body: 'Server body',
  disclosure_text: 'Synthetic disclosure',
  public_url: null,
  scheduled_at: null,
  review_note: null,
  status: 'draft',
  ...overrides
});
const sponsorship = {
  id: 'synthetic-sponsor',
  sponsor_feed_target: 'openg20'
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const fixture = (records = [draft()]) => {
  const state = {
    actionState: signal(null),
    draftEdits: signal({}),
    dirtyDraftIds: signal(new Set()),
    showEligible: signal(true),
    selectedDraftId: signal('previous-draft'),
    statusFilter: signal('active')
  };
  const calls = [];
  const selections = new Map([['synthetic-draft', 'synthetic-batch']]);
  const write = (method, result) => async (token, payload) => {
    calls.push({ method, token, payload });
    return result;
  };
  const ports = {
    state,
    api: {
      createPublicationDraft: write('create', {
        created: true,
        draft: draft({ id: 'server-created-draft' })
      }),
      updatePublicationDraft: write('save', { updated: true }),
      assignDraftToBatch: write('assign', { updated: true }),
      unassignDraftFromBatch: write('unassign', { updated: true })
    },
    token: () => 'synthetic-session',
    reload: async () => {
      calls.push({ method: 'reload' });
    },
    confirm: async (action, target) => {
      calls.push({ method: 'confirm', action, target });
      return true;
    },
    failed: () => calls.push({ method: 'failed' }),
    notice: (key) => calls.push({ method: 'notice', key }),
    focusRequested: (id) => calls.push({ method: 'focus', id }),
    batchSelection: (id) => selections.get(id) ?? ''
  };
  const workflow = new AdminPublicationDraftsWorkflow(ports);
  workflow.reconcileDrafts(records);
  const edit = (id, changes = {}) => {
    const next = { ...workflow.editFor(id), ...changes };
    state.draftEdits.update((edits) => ({ ...edits, [id]: next }));
    state.dirtyDraftIds.update((ids) => new Set([...ids, id]));
    return next;
  };
  return { workflow, ports, state, calls, selections, edit };
};
const methods = (f) => f.calls.map(({ method }) => method);

test('reconciliation refreshes clean drafts and retains dirty revisions even when omitted', () => {
  const f = fixture([
    draft({ scheduled_at: '2030-06-03T14:00:00Z' }),
    draft({ id: 'clean-draft', scheduled_at: 'invalid' })
  ]);
  assert.equal(
    f.workflow.editFor('synthetic-draft').scheduledAt,
    '2030-06-03T10:00'
  );
  assert.equal(f.workflow.editFor('clean-draft').scheduledAt, '');
  const local = f.edit('synthetic-draft', { title: 'New local title' });
  f.workflow.reconcileDrafts([]);
  assert.deepEqual(f.state.draftEdits(), { 'synthetic-draft': local });
  f.workflow.reconcileDrafts([
    draft({ title: 'Later remote title' }),
    draft({
      id: 'clean-draft',
      title: 'Clean refresh',
      public_url: 'https://example.test/post',
      review_note: 'Review'
    })
  ]);
  assert.equal(f.workflow.editFor('synthetic-draft'), local);
  assert.deepEqual(f.workflow.editFor('clean-draft'), {
    title: 'Clean refresh',
    body: 'Server body',
    disclosureText: 'Synthetic disclosure',
    publicUrl: 'https://example.test/post',
    scheduledAt: '',
    reviewNote: 'Review'
  });
  assert.deepEqual([...f.state.dirtyDraftIds()], ['synthetic-draft']);
  assert.deepEqual(f.workflow.editFor('missing'), f.workflow.emptyEdit());
  assert.deepEqual(f.calls, []);
});

test('text-only draft edits preserve the exact original date', async () => {
  const original = draft({ scheduled_at: '2030-06-03T14:00:42.123456Z' });
  const f = fixture();
  f.workflow.reconcileDrafts([original]);
  f.edit(original.id, { reviewNote: 'Changed note only' });
  await f.workflow.saveDraft(original);
  assert.equal(
    f.calls.find((call) => call.method === 'save').payload.scheduledAt,
    original.scheduled_at
  );
});

test('save submits the exact captured payload and waits for confirmation before mutation and reload', async () => {
  const f = fixture();
  const confirmation = deferred();
  const saving = deferred();
  const reload = deferred();
  f.ports.confirm = async (action, target) => {
    f.calls.push({ method: 'confirm', action, target });
    return confirmation.promise;
  };
  f.ports.api.updatePublicationDraft = async (token, payload) => {
    f.calls.push({ method: 'save', token, payload });
    return saving.promise;
  };
  f.ports.reload = async () => {
    f.calls.push({ method: 'reload' });
    assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), false);
    return reload.promise;
  };
  f.edit('synthetic-draft', { title: 'Before confirmation' });
  const pending = f.workflow.saveDraft(draft(), 'published');
  assert.deepEqual(f.calls, [
    { method: 'confirm', action: 'publish', target: 'Server title' }
  ]);
  assert.equal(f.state.actionState(), null);
  f.edit('synthetic-draft', {
    title: 'Confirmed title',
    body: 'Confirmed body',
    disclosureText: 'Confirmed disclosure',
    publicUrl: 'https://example.test/post',
    scheduledAt: '2030-06-03T10:30',
    reviewNote: 'Confirmed note'
  });
  confirmation.resolve(true);
  await settle();
  assert.equal(f.state.actionState(), 'synthetic-draft');
  assert.deepEqual(f.calls[1], {
    method: 'save',
    token: 'synthetic-session',
    payload: {
      draftId: 'synthetic-draft',
      title: 'Confirmed title',
      body: 'Confirmed body',
      disclosureText: 'Confirmed disclosure',
      status: 'published',
      publicUrl: 'https://example.test/post',
      scheduledAt: '2030-06-03T14:30:00.000Z',
      reviewNote: 'Confirmed note'
    }
  });
  await f.workflow.saveDraft(draft(), 'rejected');
  await f.workflow.createDraft(sponsorship, 'linkedin');
  await f.workflow.assignToBatch(draft());
  await f.workflow.unassignFromBatch(draft());
  assert.deepEqual(methods(f), ['confirm', 'save']);
  saving.resolve({ updated: true });
  await settle();
  assert.deepEqual(methods(f), ['confirm', 'save', 'notice', 'reload']);
  assert.deepEqual(f.calls[2], {
    method: 'notice',
    key: 'admin.publications.saved'
  });
  assert.equal(f.state.actionState(), 'synthetic-draft');
  reload.resolve();
  await pending;
  assert.equal(f.state.actionState(), null);
});

for (const [status, action] of [
  ['rejected', 'refuse'],
  ['published', 'publish']
]) {
  test(`${status} cancellation leaves edits untouched without a mutation`, async () => {
    const f = fixture();
    const edit = f.edit('synthetic-draft', { title: 'Local title' });
    f.ports.confirm = async (confirmedAction, target) => {
      f.calls.push({ method: 'confirm', action: confirmedAction, target });
      return false;
    };
    await f.workflow.saveDraft(draft(), status);
    assert.deepEqual(f.calls, [
      { method: 'confirm', action, target: 'Server title' }
    ]);
    assert.equal(f.workflow.editFor('synthetic-draft'), edit);
    assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
    assert.equal(f.state.actionState(), null);
  });
}

test('confirmation failures retain the existing rejected promise boundary', async () => {
  const f = fixture();
  f.ports.confirm = async () => {
    throw new Error('Synthetic confirmation failure');
  };
  await assert.rejects(
    f.workflow.saveDraft(draft(), 'rejected'),
    /Synthetic confirmation failure/
  );
  assert.deepEqual(f.calls, []);
  assert.equal(f.state.actionState(), null);
});

for (const result of [undefined, {}, { updated: false }]) {
  test(`an unconfirmed save (${JSON.stringify(result) ?? 'absent response'}) retains dirty input and reports failure`, async () => {
    const f = fixture();
    const local = f.edit('synthetic-draft', { title: 'Unsaved title' });
    f.ports.api.updatePublicationDraft = async () => result;
    await f.workflow.saveDraft(draft());
    assert.deepEqual(methods(f), ['failed']);
    assert.equal(f.workflow.editFor('synthetic-draft'), local);
    assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
    assert.equal(f.state.actionState(), null);
  });
}

test('a dated conversion error is caught before HTTP and keeps the draft retryable', async () => {
  const f = fixture();
  f.edit('synthetic-draft', { scheduledAt: 'invalid' });
  await f.workflow.saveDraft(draft(), 'scheduled');
  assert.deepEqual(methods(f), ['failed']);
  assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
  assert.equal(f.state.actionState(), null);
});

for (const sameValues of [false, true]) {
  test(`save preserves a newer revision (${sameValues ? 'identical values' : 'changed values'}) received while HTTP is pending`, async () => {
    const f = fixture();
    const saving = deferred();
    f.ports.api.updatePublicationDraft = async (token, payload) => {
      f.calls.push({ method: 'save', token, payload });
      return saving.promise;
    };
    f.edit('synthetic-draft', { title: 'Submitted revision' });
    const pending = f.workflow.saveDraft(draft());
    const latest = f.edit('synthetic-draft', {
      title: sameValues ? 'Submitted revision' : 'Latest revision'
    });
    f.ports.reload = async () => {
      f.calls.push({ method: 'reload' });
      f.workflow.reconcileDrafts([]);
      f.workflow.reconcileDrafts([draft({ title: 'Submitted revision' })]);
    };
    saving.resolve({ updated: true });
    await pending;
    assert.equal(f.calls[0].payload.title, 'Submitted revision');
    assert.equal(f.calls[0].payload.scheduledAt, null);
    assert.equal(f.calls[0].payload.status, undefined);
    assert.equal(f.workflow.editFor('synthetic-draft'), latest);
    assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
    assert.deepEqual(methods(f), ['save', 'notice', 'reload']);
    assert.equal(f.state.actionState(), null);
  });
}

test('input entered during reload stays dirty after the submitted revision was cleared', async () => {
  const f = fixture();
  const reloading = deferred();
  f.ports.reload = async () => {
    f.calls.push({ method: 'reload' });
    await reloading.promise;
    f.workflow.reconcileDrafts([draft({ title: 'Submitted title' })]);
  };
  f.edit('synthetic-draft', { title: 'Submitted title' });
  const pending = f.workflow.saveDraft(draft());
  await Promise.resolve();
  assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), false);
  const latest = f.edit('synthetic-draft', { title: 'Typed during reload' });
  reloading.resolve();
  await pending;
  assert.equal(f.workflow.editFor('synthetic-draft'), latest);
  assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
});

for (const failure of ['mutation', 'reload']) {
  test(`save ${failure} failure preserves the existing feedback and cleanup order`, async () => {
    const f = fixture();
    f.edit('synthetic-draft', { title: 'Submitted title' });
    if (failure === 'mutation') {
      f.ports.api.updatePublicationDraft = async () => {
        f.calls.push({ method: 'save' });
        throw new Error('Synthetic mutation failure');
      };
    } else {
      f.ports.reload = async () => {
        f.calls.push({ method: 'reload' });
        throw new Error('Synthetic reload failure');
      };
    }
    await f.workflow.saveDraft(draft());
    assert.deepEqual(
      methods(f),
      failure === 'mutation'
        ? ['save', 'failed']
        : ['save', 'notice', 'reload', 'failed']
    );
    assert.equal(
      f.state.dirtyDraftIds().has('synthetic-draft'),
      failure === 'mutation'
    );
    assert.equal(
      f.workflow.editFor('synthetic-draft').title,
      'Submitted title'
    );
    assert.equal(f.state.actionState(), null);
  });
}

test('creation selects and focuses only the response draft after a successful reload', async () => {
  const f = fixture();
  const creating = deferred();
  const reloading = deferred();
  f.ports.api.createPublicationDraft = async (token, payload) => {
    f.calls.push({ method: 'create', token, payload });
    return creating.promise;
  };
  f.ports.reload = async () => {
    f.calls.push({ method: 'reload' });
    assert.equal(f.state.selectedDraftId(), 'previous-draft');
    return reloading.promise;
  };
  const pending = f.workflow.createDraft(sponsorship, 'linkedin');
  assert.equal(f.state.actionState(), 'synthetic-sponsorlinkedin');
  assert.deepEqual(f.calls, [
    {
      method: 'create',
      token: 'synthetic-session',
      payload: {
        contributionId: 'synthetic-sponsor',
        feedTarget: 'openg20',
        channel: 'linkedin'
      }
    }
  ]);
  await f.workflow.createDraft(sponsorship, 'facebook');
  assert.equal(f.calls.length, 1);
  creating.resolve({ draft: draft({ id: 'response-draft' }) });
  await settle();
  assert.deepEqual(methods(f), ['create', 'reload']);
  assert.equal(f.state.showEligible(), true);
  reloading.resolve();
  await pending;
  assert.equal(f.state.showEligible(), false);
  assert.equal(f.state.selectedDraftId(), 'response-draft');
  assert.equal(f.state.statusFilter(), 'all');
  assert.deepEqual(f.calls[2], { method: 'focus', id: 'response-draft' });
  assert.equal(f.state.actionState(), null);
});

test('missing feed target blocks creation and a response without draft reloads without selecting', async () => {
  const f = fixture();
  await f.workflow.createDraft(
    { ...sponsorship, sponsor_feed_target: null },
    'facebook'
  );
  assert.deepEqual(f.calls, []);
  f.ports.api.createPublicationDraft = async () => ({});
  await f.workflow.createDraft(sponsorship, 'facebook');
  assert.deepEqual(methods(f), ['reload']);
  assert.equal(f.state.showEligible(), true);
  assert.equal(f.state.selectedDraftId(), 'previous-draft');
  assert.equal(f.state.statusFilter(), 'active');
  assert.equal(f.state.actionState(), null);
});

for (const failure of ['mutation', 'reload']) {
  test(`creation ${failure} failure does not select or focus a draft`, async () => {
    const f = fixture();
    if (failure === 'mutation') {
      f.ports.api.createPublicationDraft = async () => {
        f.calls.push({ method: 'create' });
        throw new Error('Synthetic creation failure');
      };
    } else {
      f.ports.reload = async () => {
        f.calls.push({ method: 'reload' });
        throw new Error('Synthetic reload failure');
      };
    }
    await f.workflow.createDraft(sponsorship, 'facebook');
    assert.deepEqual(
      methods(f),
      failure === 'mutation'
        ? ['create', 'failed']
        : ['create', 'reload', 'failed']
    );
    assert.equal(f.state.showEligible(), true);
    assert.equal(f.state.selectedDraftId(), 'previous-draft');
    assert.equal(f.state.actionState(), null);
  });
}

test('assignment without a selected batch is ignored', async () => {
  const f = fixture();
  f.selections.clear();
  await f.workflow.assignToBatch(draft());
  assert.deepEqual(f.calls, []);
  assert.equal(f.state.actionState(), null);
});

for (const [action, method, apiMethod, payload] of [
  [
    'assignToBatch',
    'assign',
    'assignDraftToBatch',
    { draftId: 'synthetic-draft', batchId: 'synthetic-batch' }
  ],
  [
    'unassignFromBatch',
    'unassign',
    'unassignDraftFromBatch',
    { draftId: 'synthetic-draft' }
  ]
]) {
  test(`${method} captures its payload and blocks duplicate actions until reload finishes`, async () => {
    const f = fixture();
    const mutation = deferred();
    const reload = deferred();
    const local = f.edit('synthetic-draft', { title: 'Unsaved title' });
    f.ports.api[apiMethod] = async (token, body) => {
      f.calls.push({ method, token, payload: body });
      return mutation.promise;
    };
    f.ports.reload = async () => {
      f.calls.push({ method: 'reload' });
      return reload.promise;
    };
    const pending = f.workflow[action](draft());
    assert.equal(f.state.actionState(), 'synthetic-draft');
    f.selections.set('synthetic-draft', 'later-batch');
    await f.workflow[action](draft());
    assert.deepEqual(f.calls, [
      { method, token: 'synthetic-session', payload }
    ]);
    // These existing actions refresh any response envelope without treating it as a save.
    mutation.resolve({ updated: false });
    await settle();
    assert.deepEqual(methods(f), [method, 'reload']);
    assert.equal(f.state.actionState(), 'synthetic-draft');
    reload.resolve();
    await pending;
    assert.equal(f.workflow.editFor('synthetic-draft'), local);
    assert.equal(f.state.dirtyDraftIds().has('synthetic-draft'), true);
    assert.equal(f.state.actionState(), null);
  });

  for (const failure of ['mutation', 'reload']) {
    test(`${method} ${failure} failure leaves local editing and selection intact`, async () => {
      const f = fixture();
      const local = f.edit('synthetic-draft', { title: 'Unsaved title' });
      if (failure === 'mutation') {
        f.ports.api[apiMethod] = async () => {
          f.calls.push({ method });
          throw new Error('Synthetic mutation failure');
        };
      } else {
        f.ports.reload = async () => {
          f.calls.push({ method: 'reload' });
          throw new Error('Synthetic reload failure');
        };
      }
      await f.workflow[action](draft());
      assert.deepEqual(
        methods(f),
        failure === 'mutation'
          ? [method, 'failed']
          : [method, 'reload', 'failed']
      );
      assert.equal(f.workflow.editFor('synthetic-draft'), local);
      assert.equal(f.selections.get('synthetic-draft'), 'synthetic-batch');
      assert.equal(f.state.actionState(), null);
    });
  }
}
