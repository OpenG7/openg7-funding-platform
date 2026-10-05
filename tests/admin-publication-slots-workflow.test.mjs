import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPublicationSlotsWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publications-page/panels/admin-publication-slots-workflow.js';

const timestamp = '2030-06-01T14:00:00Z';
const slot = (changes = {}) => ({
  id: 'synthetic-slot',
  feedTarget: 'openg20',
  channel: 'linkedin',
  startsAt: '2030-06-03T14:00:00Z',
  timezone: 'Europe/Paris',
  capacity: 5,
  capacityUsed: 3,
  capacityAvailable: 2,
  status: 'scheduled',
  notes: null,
  assignedBatchIds: [],
  assignedDraftIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...changes
});
const draft = (changes = {}) => ({
  id: 'synthetic-draft',
  contribution_id: 'synthetic-contribution',
  sponsor_company_name: 'Synthetic company',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_public_summary: null,
  feed_target: 'openg20',
  channel: 'linkedin',
  title: 'Synthetic title',
  body: 'Synthetic publication',
  disclosure_text: 'Commandite',
  status: 'approved',
  public_url: null,
  scheduled_at: null,
  approved_at: timestamp,
  published_at: null,
  review_note: null,
  batch_id: null,
  slot_id: null,
  created_at: timestamp,
  updated_at: timestamp,
  ...changes
});
const batch = (changes = {}) => ({
  id: 'synthetic-batch',
  channel: 'linkedin',
  capacity: 5,
  capacityUsed: 2,
  capacityAvailable: 3,
  status: 'open',
  slotId: null,
  scheduledAt: null,
  publishedAt: null,
  notes: null,
  assignedDraftIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...changes
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
const operations = {
  createSlot: 'createPublicationSlot',
  updateSlot: 'updatePublicationSlot',
  assignBatchToSlot: 'assignBatchToPublicationSlot',
  assignDraftToSlot: 'assignDraftToPublicationSlot',
  publishSlot: 'publishPublicationSlot',
  cancelSlot: 'cancelPublicationSlot'
};
const fixture = () => {
  const calls = [];
  const effects = [];
  const state = {
    slotActionState: signal(null),
    slotEdits: signal({}),
    dirtySlotIds: signal(new Set()),
    newSlotFeedTarget: signal('openg20'),
    newSlotChannel: signal('linkedin'),
    newSlotStartsAt: signal('2030-06-03T15:45'),
    newSlotTimezone: signal(''),
    newSlotCapacity: signal('7'),
    newSlotNotes: signal(' Exact synthetic notes '),
    newSlotOpen: signal(true),
    selectedSlotId: signal(null)
  };
  let batches = [batch()];
  let drafts = [draft()];
  let batchSelection = 'synthetic-batch';
  let draftSelection = 'synthetic-draft';
  const ports = {
    state,
    api: Object.fromEntries(
      Object.values(operations).map((method) => [
        method,
        async (token, payload) => {
          calls.push({ method, token, payload });
          effects.push('mutation');
          return { updated: true, slot: slot({ id: 'server-created-slot' }) };
        }
      ])
    ),
    token: () => 'synthetic-session',
    reload: async () => {
      effects.push('reload');
    },
    confirm: async (action, target) => {
      effects.push({ confirm: action, target });
      return true;
    },
    failed: () => effects.push('failed'),
    focusRequested: (id) => effects.push({ focus: id }),
    batchSelection: () => batchSelection,
    draftSelection: () => draftSelection,
    batches: () => batches,
    drafts: () => drafts
  };
  const workflow = new AdminPublicationSlotsWorkflow(ports);
  workflow.reconcileSlots([slot()]);
  const edit = (changes = {}, id = 'synthetic-slot') => {
    state.dirtySlotIds.update((ids) => new Set([...ids, id]));
    const value = { ...workflow.editFor(id), ...changes };
    state.slotEdits.update((edits) => ({ ...edits, [id]: value }));
    return value;
  };
  return {
    workflow,
    ports,
    state,
    calls,
    effects,
    edit,
    setBatches: (records) => (batches = records),
    setDrafts: (records) => (drafts = records),
    selectBatch: (id) => (batchSelection = id),
    selectDraft: (id) => (draftSelection = id)
  };
};

test('text-only slot edits preserve the original instant, precision and selected repeated time', async () => {
  for (const original of [
    slot({ startsAt: '2030-06-03T14:00:42.123456Z' }),
    slot({ startsAt: '2030-11-03T06:30:00Z', timezone: 'America/Toronto' })
  ]) {
    const f = fixture();
    f.workflow.reconcileSlots([original]);
    f.edit({ notes: 'Changed note only' });
    await f.workflow.updateSlot(original);
    assert.equal(f.calls[0].payload.startsAt, original.startsAt);
  }
});

test('slot creation respects an explicit zone independently of the browser timezone', async () => {
  const f = fixture();
  f.state.newSlotTimezone.set('Europe/Paris');
  await f.workflow.createSlot();
  assert.equal(f.calls[0].payload.startsAt, '2030-06-03T13:45:00.000Z');
});

test('slot workflow construction is SSR-safe and resolves effect ports only when used', () => {
  const f = fixture();
  const unavailable = () => {
    throw new Error('Effect accessed during construction');
  };
  new AdminPublicationSlotsWorkflow({
    ...f.ports,
    api: new Proxy({}, { get: unavailable }),
    token: unavailable,
    reload: unavailable,
    confirm: unavailable,
    failed: unavailable,
    focusRequested: unavailable
  });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.effects, []);
});

test('slot creation preserves exact payload, Toronto fallback and server-selected focus after reload', async () => {
  const f = fixture();
  f.state.newSlotTimezone.set('   ');
  f.ports.reload = async () => {
    assert.equal(f.state.selectedSlotId(), 'server-created-slot');
    assert.equal(f.state.newSlotOpen(), false);
    assert.equal(f.state.slotActionState(), 'create');
    f.effects.push('reload');
  };
  await f.workflow.createSlot();
  assert.deepEqual(f.calls, [
    {
      method: 'createPublicationSlot',
      token: 'synthetic-session',
      payload: {
        feedTarget: 'openg20',
        channel: 'linkedin',
        startsAt: '2030-06-03T19:45:00.000Z',
        timezone: 'America/Toronto',
        capacity: 7,
        notes: ' Exact synthetic notes '
      }
    }
  ]);
  assert.deepEqual(f.effects, [
    'mutation',
    'reload',
    { focus: 'server-created-slot' }
  ]);
  assert.equal(f.state.newSlotNotes(), '');
  assert.equal(f.state.slotActionState(), null);
});

test('creation without a returned slot refreshes but selects and focuses no invented record', async () => {
  const f = fixture();
  f.state.selectedSlotId.set('previous-slot');
  f.ports.api.createPublicationSlot = async () => ({ updated: false });
  await f.workflow.createSlot();
  assert.equal(f.state.selectedSlotId(), null);
  assert.equal(f.state.newSlotOpen(), false);
  assert.equal(f.state.newSlotNotes(), '');
  assert.deepEqual(f.effects, ['reload']);
  assert.equal(f.state.slotActionState(), null);
});

test('new notes typed during creation survive a delayed response exactly', async () => {
  const f = fixture();
  const pending = deferred();
  f.ports.api.createPublicationSlot = async (token, payload) => {
    f.calls.push({ token, payload });
    return pending.promise;
  };
  const creating = f.workflow.createSlot();
  f.state.newSlotNotes.set(' Exact newer notes ');
  pending.resolve({ updated: true, slot: slot({ id: 'created-response' }) });
  await creating;
  assert.equal(f.calls[0].payload.notes, ' Exact synthetic notes ');
  assert.equal(f.state.newSlotNotes(), ' Exact newer notes ');
  assert.equal(f.state.selectedSlotId(), 'created-response');
  assert.deepEqual(f.effects, ['reload', { focus: 'created-response' }]);
});

test('slot update sends the submitted revision and clears only that slot before refresh', async () => {
  const f = fixture();
  f.edit({ notes: 'Other unsaved slot' }, 'other-slot');
  f.edit({
    startsAt: '2030-07-04T09:15',
    timezone: ' Europe/Paris ',
    capacity: '8',
    notes: ' Exact saved notes '
  });
  f.ports.reload = async () => {
    assert.equal(f.state.dirtySlotIds().has('synthetic-slot'), false);
    assert.equal(f.state.dirtySlotIds().has('other-slot'), true);
    f.workflow.reconcileSlots([
      slot({ capacity: 8, notes: ' Exact saved notes ' })
    ]);
    f.effects.push('reload');
  };
  await f.workflow.updateSlot(slot());
  assert.deepEqual(f.calls[0], {
    method: 'updatePublicationSlot',
    token: 'synthetic-session',
    payload: {
      slotId: 'synthetic-slot',
      startsAt: '2030-07-04T07:15:00.000Z',
      timezone: 'Europe/Paris',
      capacity: 8,
      notes: ' Exact saved notes '
    }
  });
  assert.equal(f.workflow.editFor('other-slot').notes, 'Other unsaved slot');
  assert.deepEqual(f.effects, ['mutation', 'reload']);
  assert.equal(f.state.slotActionState(), null);
});

for (const revision of ['changed text', 'same text in a new revision']) {
  test(`update preserves ${revision} entered during a delayed response`, async () => {
    const f = fixture();
    const submitted = f.edit({ notes: ' Submitted notes ' });
    const pending = deferred();
    f.ports.api.updatePublicationSlot = async (token, payload) => {
      f.calls.push({ token, payload });
      return pending.promise;
    };
    f.ports.reload = async () =>
      f.workflow.reconcileSlots([slot({ notes: submitted.notes })]);
    const saving = f.workflow.updateSlot(slot());
    const newer = f.edit({
      notes: revision === 'changed text' ? ' Newer notes ' : submitted.notes
    });
    pending.resolve({ updated: true });
    await saving;
    assert.equal(f.calls[0].payload.notes, submitted.notes);
    assert.equal(f.workflow.editFor('synthetic-slot'), newer);
    assert.equal(f.state.dirtySlotIds().has('synthetic-slot'), true);
    assert.equal(f.state.slotActionState(), null);
  });
}

test('typing while reload is pending remains dirty for the next reconciliation', async () => {
  const f = fixture();
  const pending = deferred();
  const started = deferred();
  f.edit({ notes: 'Submitted notes' });
  f.ports.reload = async () => {
    started.resolve();
    await pending.promise;
    f.workflow.reconcileSlots([slot({ notes: 'Submitted notes' })]);
  };
  const saving = f.workflow.updateSlot(slot());
  await started.promise;
  const newer = f.edit({ notes: 'Typed during refresh' });
  pending.resolve();
  await saving;
  assert.equal(f.workflow.editFor('synthetic-slot'), newer);
  assert.equal(f.state.dirtySlotIds().has('synthetic-slot'), true);
});

for (const result of [{ updated: false }, {}, undefined]) {
  test(`unconfirmed update ${JSON.stringify(result)} preserves dirty revision and avoids reload`, async () => {
    const f = fixture();
    const submitted = f.edit({ notes: 'Retain until confirmed' });
    f.ports.api.updatePublicationSlot = async () => result;
    await f.workflow.updateSlot(slot());
    assert.equal(f.workflow.editFor('synthetic-slot'), submitted);
    assert.equal(f.state.dirtySlotIds().has('synthetic-slot'), true);
    assert.deepEqual(f.effects, ['failed']);
    assert.equal(f.state.slotActionState(), null);
  });
}

test('reconciliation refreshes clean slots while retaining dirty and temporarily absent revisions', () => {
  const f = fixture();
  const dirty = f.edit({ notes: 'Local absent revision' });
  f.state.slotEdits.update((edits) => ({
    ...edits,
    stale: f.workflow.emptyEdit()
  }));
  const refreshed = slot({
    id: 'clean-slot',
    capacity: 9,
    startsAt: 'invalid',
    notes: null
  });
  f.workflow.reconcileSlots([refreshed]);
  assert.equal(f.workflow.editFor('synthetic-slot'), dirty);
  assert.equal(f.state.slotEdits().stale, undefined);
  assert.deepEqual(f.workflow.editFor('clean-slot'), {
    startsAt: '',
    timezone: 'Europe/Paris',
    capacity: '9',
    notes: ''
  });
  f.workflow.reconcileSlots([
    slot({ notes: 'New server revision' }),
    refreshed
  ]);
  assert.equal(f.workflow.editFor('synthetic-slot'), dirty);
  assert.deepEqual(f.workflow.editFor('missing-slot'), {
    startsAt: '',
    timezone: 'America/Toronto',
    capacity: '5',
    notes: ''
  });
});

for (const action of ['createSlot', 'updateSlot']) {
  for (const invalid of [
    'capacity below minimum',
    'capacity above maximum',
    'capacity absent',
    'date absent',
    'date invalid'
  ]) {
    test(`${action} ${invalid} fails before any request and restores idle`, async () => {
      const f = fixture();
      const changes =
        invalid === 'capacity below minimum'
          ? { capacity: '0' }
          : invalid === 'capacity above maximum'
            ? { capacity: '51' }
            : invalid === 'capacity absent'
              ? { capacity: '' }
              : { startsAt: invalid === 'date absent' ? '' : 'invalid-date' };
      if (action === 'createSlot') {
        if (changes.capacity !== undefined)
          f.state.newSlotCapacity.set(changes.capacity);
        if (changes.startsAt !== undefined)
          f.state.newSlotStartsAt.set(changes.startsAt);
      } else f.edit(changes);
      await f.workflow[action](slot());
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.effects, ['failed']);
      assert.equal(f.state.slotActionState(), null);
      assert.equal(f.state.newSlotOpen(), true);
      assert.equal(f.state.newSlotNotes(), ' Exact synthetic notes ');
    });
  }
}

test('assignment filters preserve destination, channel, status, capacity and existing membership', async () => {
  const f = fixture();
  f.setBatches([
    batch(),
    batch({ id: 'oversize', capacityUsed: 3 }),
    batch({ id: 'other-channel', channel: 'facebook' }),
    batch({ id: 'other-slot', slotId: 'other-slot' }),
    batch({ id: 'published', status: 'published' }),
    batch({ id: 'wrong-target' }),
    batch({ id: 'assigned', slotId: 'synthetic-slot', capacityUsed: 5 })
  ]);
  f.setDrafts([
    draft(),
    draft({
      id: 'wrong-target-member',
      batch_id: 'wrong-target',
      feed_target: 'openg7'
    }),
    draft({ id: 'wrong-destination', feed_target: 'openg7' }),
    draft({ id: 'wrong-channel', channel: 'facebook' }),
    draft({ id: 'unapproved', status: 'draft' }),
    draft({ id: 'other-slot', slot_id: 'other-slot' }),
    draft({ id: 'already-in-batch', batch_id: 'synthetic-batch' }),
    draft({ id: 'scheduled-elsewhere', status: 'scheduled', slot_id: null }),
    draft({ id: 'assigned', status: 'scheduled', slot_id: 'synthetic-slot' })
  ]);
  assert.deepEqual(
    f.workflow.assignableBatchesForSlot(slot()).map((record) => record.id),
    ['synthetic-batch', 'assigned']
  );
  assert.deepEqual(
    f.workflow.assignableDraftsForSlot(slot()).map((record) => record.id),
    ['synthetic-draft', 'assigned']
  );
  const full = slot({ capacityAvailable: 0 });
  assert.deepEqual(
    f.workflow.assignableBatchesForSlot(full).map((record) => record.id),
    ['assigned']
  );
  assert.deepEqual(
    f.workflow.assignableDraftsForSlot(full).map((record) => record.id),
    ['assigned']
  );
  await f.workflow.assignBatchToSlot(full);
  await f.workflow.assignDraftToSlot(full);
  assert.deepEqual(f.calls, []);
  f.selectBatch('assigned');
  f.selectDraft('assigned');
  await f.workflow.assignBatchToSlot(full);
  await f.workflow.assignDraftToSlot(full);
  assert.deepEqual(
    f.calls.map(({ payload }) => payload),
    [
      { slotId: 'synthetic-slot', batchId: 'assigned' },
      { slotId: 'synthetic-slot', draftId: 'assigned' }
    ]
  );
});

test('assignment revalidates stored selections against refreshed records before mutation', async () => {
  const f = fixture();
  f.setBatches([batch({ status: 'cancelled' })]);
  f.setDrafts([draft({ status: 'published' })]);
  await f.workflow.assignBatchToSlot(slot());
  await f.workflow.assignDraftToSlot(slot());
  f.selectBatch('missing');
  f.selectDraft('missing');
  f.setBatches([batch()]);
  f.setDrafts([draft()]);
  await f.workflow.assignBatchToSlot(slot());
  await f.workflow.assignDraftToSlot(slot());
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.effects, []);
});

for (const action of ['publishSlot', 'cancelSlot']) {
  test(`${action} waits for explicit confirmation before mutation then reload`, async () => {
    const f = fixture();
    const pending = deferred();
    f.ports.confirm = async (kind, target) => {
      f.effects.push({ confirm: kind, target });
      return pending.promise;
    };
    const running = f.workflow[action](slot());
    assert.deepEqual(f.calls, []);
    assert.equal(f.state.slotActionState(), null);
    pending.resolve(true);
    await running;
    assert.deepEqual(f.calls, [
      {
        method: operations[action],
        token: 'synthetic-session',
        payload: { slotId: 'synthetic-slot' }
      }
    ]);
    assert.deepEqual(f.effects, [
      {
        confirm: action === 'publishSlot' ? 'publish' : 'cancelPublication',
        target: 'synthetic-slot'
      },
      'mutation',
      'reload'
    ]);
    assert.equal(f.state.slotActionState(), null);
  });

  test(`${action} cancelled confirmation causes no request or reload`, async () => {
    const f = fixture();
    f.ports.confirm = async () => false;
    await f.workflow[action](slot());
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.effects, []);
    assert.equal(f.state.slotActionState(), null);
  });
}

for (const action of [
  'assignBatchToSlot',
  'assignDraftToSlot',
  'publishSlot',
  'cancelSlot'
]) {
  for (const response of [undefined, { updated: false }]) {
    test(`${action} preserves refresh for ${JSON.stringify(response)} lifecycle response and locks through reload`, async () => {
      const f = fixture();
      const pending = deferred();
      const started = deferred();
      f.ports.api[operations[action]] = async (token, payload) => {
        f.calls.push({ token, payload });
        return response;
      };
      f.ports.reload = async () => {
        f.effects.push('reload');
        started.resolve();
        await pending.promise;
      };
      const running = f.workflow[action](slot());
      await started.promise;
      assert.equal(f.state.slotActionState(), 'synthetic-slot');
      await f.workflow[action](slot());
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].token, 'synthetic-session');
      assert.deepEqual(f.calls[0].payload, {
        slotId: 'synthetic-slot',
        ...(action === 'assignBatchToSlot'
          ? { batchId: 'synthetic-batch' }
          : {}),
        ...(action === 'assignDraftToSlot'
          ? { draftId: 'synthetic-draft' }
          : {})
      });
      assert.equal(f.effects.filter((effect) => effect === 'reload').length, 1);
      assert.equal(f.effects.includes('failed'), false);
      pending.resolve();
      await running;
      assert.equal(f.state.slotActionState(), null);
    });
  }
}

for (const [action, method] of Object.entries(operations)) {
  test(`${action} cannot submit while another action is pending`, async () => {
    const f = fixture();
    f.state.slotActionState.set('other-action');
    await f.workflow[action](slot());
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.effects, []);
    assert.equal(f.state.slotActionState(), 'other-action');
  });

  test(`${action} prevents repeat submissions while its mutation is pending`, async () => {
    const f = fixture();
    const pending = deferred();
    f.ports.api[method] = async (token, payload) => {
      f.calls.push({ token, payload });
      return pending.promise;
    };
    const running = f.workflow[action](slot());
    await Promise.resolve();
    assert.equal(
      f.state.slotActionState(),
      action === 'createSlot' ? 'create' : 'synthetic-slot'
    );
    await f.workflow[action](slot());
    assert.equal(f.calls.length, 1);
    pending.resolve({ updated: true, slot: slot() });
    await running;
    assert.equal(f.state.slotActionState(), null);
  });

  for (const failure of ['mutation', 'reload']) {
    test(`${action} ${failure} failure reports error and releases the action lock`, async () => {
      const f = fixture();
      f.edit({ notes: 'Retain failed submission' });
      const saved = f.workflow.editFor('synthetic-slot');
      if (failure === 'mutation')
        f.ports.api[method] = async () => {
          f.effects.push('mutation');
          throw new Error('Synthetic mutation failure');
        };
      else
        f.ports.reload = async () => {
          f.effects.push('reload');
          throw new Error('Synthetic reload failure');
        };
      await f.workflow[action](slot());
      const expected =
        failure === 'mutation'
          ? ['mutation', 'failed']
          : ['mutation', 'reload', 'failed'];
      if (action === 'publishSlot' || action === 'cancelSlot')
        expected.unshift({
          confirm: action === 'publishSlot' ? 'publish' : 'cancelPublication',
          target: 'synthetic-slot'
        });
      assert.deepEqual(f.effects, expected);
      assert.equal(f.state.slotActionState(), null);
      assert.equal(f.workflow.editFor('synthetic-slot'), saved);
      assert.equal(
        f.state.dirtySlotIds().has('synthetic-slot'),
        !(action === 'updateSlot' && failure === 'reload')
      );
      if (action === 'createSlot' && failure === 'mutation') {
        assert.equal(f.state.newSlotNotes(), ' Exact synthetic notes ');
        assert.equal(f.state.newSlotOpen(), true);
      }
    });
  }
}
