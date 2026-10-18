import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_GUIDANCE_PAGES } from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.js';
import { ADMIN_WORKFLOW_GUIDE_JOURNEYS } from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-workflow-guide.catalog.js';
import {
  AdminGuidanceState,
  guidancePaymentContext
} from '../dist/apps/funding-web/src/app/features/funding/services/admin-guidance-state.js';

const account = 'synthetic-admin-a';
const otherAccount = 'synthetic-admin-b';
const key = (id = account) => `og7-admin-guidance:v1:${id}`;
const empty = () => ({ enabled: false, bookmark: null });
const snapshot = (changes = {}) => ({
  enabled: true,
  bookmark: { pageId: 'pilotage', step: 1, paused: true },
  ...changes
});

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(name) {
      return values.get(name) ?? null;
    },
    setItem(name, value) {
      values.set(name, value);
    },
    removeItem(name) {
      values.delete(name);
    }
  };
}

test('guidance starts disabled without touching browser storage during construction', () => {
  const storage = memoryStorage();
  let accesses = 0;
  const state = new AdminGuidanceState(() => {
    accesses += 1;
    return storage;
  });
  assert.equal(accesses, 0);
  assert.equal(state.storageAvailable, false);
  assert.deepEqual(state.load(account), empty());
  assert.equal(accesses, 1);
  assert.equal(state.storageAvailable, true);
  assert.equal(storage.values.size, 0);
});

test('guidance remembers a paused step after a fresh instance reload', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  assert.equal(state.save(account, snapshot()), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), snapshot());
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    snapshot()
  );
});

test('guidance preferences and bookmarks remain isolated between accounts', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  state.save(account, snapshot());
  assert.deepEqual(state.load(otherAccount), empty());
  state.save(otherAccount, { enabled: true, bookmark: null });
  assert.deepEqual(state.load(account), snapshot());
  const reload = new AdminGuidanceState(() => storage);
  assert.deepEqual(reload.load(account), snapshot());
  assert.deepEqual(reload.load(otherAccount), {
    enabled: true,
    bookmark: null
  });
  assert.equal(storage.values.size, 2);
});

test('saving and loading return independent copies of the retained bookmark', () => {
  const state = new AdminGuidanceState(() => null);
  const submitted = snapshot();
  state.save(account, submitted);
  submitted.enabled = false;
  submitted.bookmark.pageId = 'audit';
  submitted.bookmark.step = 0;
  const loaded = state.load(account);
  assert.deepEqual(loaded, snapshot());
  loaded.enabled = false;
  loaded.bookmark.paused = false;
  assert.deepEqual(state.load(account), snapshot());
});

test('only page, manual step and booleans survive saving or loading', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const supplied = snapshot({
    note: 'Synthetic private note',
    token: 'synthetic-token',
    url: '/fr/admin/pilotage?subject=synthetic-private-id',
    bookmark: {
      ...snapshot().bookmark,
      dossierId: 'synthetic-private-id',
      query: 'contact=synthetic@example.test',
      secret: 'synthetic-secret',
      extra: { text: 'Synthetic extra' }
    }
  });
  assert.equal(state.save(account, supplied), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), snapshot());
  storage.setItem(key(), JSON.stringify(supplied));
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    snapshot()
  );
});

const invalidSnapshots = [
  ['null snapshot', null],
  ['array snapshot', []],
  ['missing enabled', { bookmark: null }],
  ['string enabled', { enabled: 'true', bookmark: null }],
  ['missing bookmark', { enabled: true }],
  ['array bookmark', snapshot({ bookmark: [] })],
  [
    'unknown page',
    snapshot({ bookmark: { pageId: 'unknown', step: 0, paused: false } })
  ],
  [
    'raw route',
    snapshot({
      bookmark: { pageId: '/fr/admin/pilotage', step: 0, paused: false }
    })
  ],
  [
    'route with query',
    snapshot({
      bookmark: { pageId: 'pilotage?dossier=synthetic', step: 0, paused: false }
    })
  ],
  [
    'external URL',
    snapshot({
      bookmark: { pageId: 'https://example.test/admin', step: 0, paused: false }
    })
  ],
  [
    'negative step',
    snapshot({ bookmark: { pageId: 'pilotage', step: -1, paused: false } })
  ],
  [
    'fractional step',
    snapshot({ bookmark: { pageId: 'pilotage', step: 0.5, paused: false } })
  ],
  [
    'string step',
    snapshot({ bookmark: { pageId: 'pilotage', step: '1', paused: false } })
  ],
  ['missing paused', snapshot({ bookmark: { pageId: 'pilotage', step: 0 } })],
  [
    'string paused',
    snapshot({ bookmark: { pageId: 'pilotage', step: 0, paused: 'true' } })
  ],
  [
    'non-finite step',
    snapshot({
      bookmark: { pageId: 'pilotage', step: Infinity, paused: false }
    })
  ]
];

for (const [label, invalid] of invalidSnapshots) {
  test(`invalid guidance ${label} cannot replace a valid saved bookmark`, () => {
    const storage = memoryStorage();
    const state = new AdminGuidanceState(() => storage);
    state.save(account, snapshot());
    const before = storage.getItem(key());
    assert.equal(state.save(account, invalid), false);
    assert.equal(storage.getItem(key()), before);
    assert.deepEqual(state.load(account), snapshot());
    storage.setItem(key(), JSON.stringify(invalid));
    const reload = new AdminGuidanceState(() => storage);
    assert.deepEqual(reload.load(account), empty());
    assert.equal(reload.storageAvailable, true);
  });
}

test('each catalogue page accepts its last step and rejects an out-of-range step', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  for (const page of ADMIN_GUIDANCE_PAGES) {
    const valid = snapshot({
      bookmark: { pageId: page.id, step: page.steps.length - 1, paused: false }
    });
    assert.equal(state.save(account, valid), true, page.id);
    assert.deepEqual(state.load(account), valid);
    assert.equal(
      state.save(
        account,
        snapshot({ bookmark: { ...valid.bookmark, step: page.steps.length } })
      ),
      false,
      page.id
    );
    assert.deepEqual(state.load(account), valid);
  }
});

test('corrupt storage starts safely and can be replaced by a new valid bookmark', () => {
  const storage = memoryStorage();
  storage.setItem(key(), '{invalid json');
  const state = new AdminGuidanceState(() => storage);
  assert.deepEqual(state.load(account), empty());
  assert.equal(state.storageAvailable, true);
  assert.equal(state.save(account, snapshot()), true);
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    snapshot()
  );
});

test('missing storage uses instance-local memory without leaking between accounts or instances', () => {
  const state = new AdminGuidanceState(() => null);
  assert.equal(state.save(account, snapshot()), false);
  assert.equal(state.storageAvailable, false);
  assert.deepEqual(state.load(account), snapshot());
  assert.deepEqual(state.load(otherAccount), empty());
  assert.deepEqual(new AdminGuidanceState(() => null).load(account), empty());
  assert.equal(state.clear(account), false);
  assert.deepEqual(state.load(account), empty());
});

test('a blocked storage provider never prevents loading, saving or resetting in memory', () => {
  const state = new AdminGuidanceState(() => {
    throw new Error('Synthetic browser access denied');
  });
  assert.deepEqual(state.load(account), empty());
  assert.equal(state.save(account, snapshot()), false);
  assert.deepEqual(state.load(account), snapshot());
  assert.equal(state.clear(account), false);
  assert.deepEqual(state.load(account), empty());
  assert.equal(state.storageAvailable, false);
});

test('failed storage reads fall back safely and successful writes restore availability', () => {
  const storage = memoryStorage();
  storage.getItem = () => {
    throw new Error('Synthetic read refused');
  };
  const state = new AdminGuidanceState(() => storage);
  assert.deepEqual(state.load(account), empty());
  assert.equal(state.storageAvailable, false);
  assert.equal(state.save(account, snapshot()), true);
  assert.equal(state.storageAvailable, true);
  assert.deepEqual(state.load(account), snapshot());
});

test('a failed write retains the new step instead of rereading an older stored step', () => {
  const storage = memoryStorage();
  storage.setItem(key(), JSON.stringify(snapshot()));
  const state = new AdminGuidanceState(() => storage);
  assert.deepEqual(state.load(account), snapshot());
  storage.setItem = () => {
    throw new Error('Synthetic quota exceeded');
  };
  const next = snapshot({
    bookmark: { pageId: 'pilotage', step: 2, paused: false }
  });
  assert.equal(state.save(account, next), false);
  assert.equal(state.storageAvailable, false);
  assert.deepEqual(state.load(account), next);
  assert.deepEqual(JSON.parse(storage.getItem(key())), snapshot());
});

test('returning to an account restores its unsaved status after another account saved successfully', () => {
  const storage = memoryStorage();
  const write = storage.setItem.bind(storage);
  storage.setItem = (name, value) => {
    if (name === key(account)) {
      throw new Error('Synthetic account A write refused');
    }
    write(name, value);
  };
  const state = new AdminGuidanceState(() => storage);
  assert.equal(state.save(account, snapshot()), false);
  assert.equal(state.storageAvailable, false);
  const other = snapshot({
    bookmark: { pageId: 'audit', step: 0, paused: false }
  });
  assert.equal(state.save(otherAccount, other), true);
  assert.equal(state.storageAvailable, true);
  assert.deepEqual(state.load(account), snapshot());
  assert.equal(state.storageAvailable, false);
  assert.deepEqual(state.load(otherAccount), other);
  assert.equal(state.storageAvailable, true);
  assert.equal(storage.getItem(key(account)), null);
  assert.deepEqual(JSON.parse(storage.getItem(key(otherAccount))), other);
});

test('clearing removes only the selected account and a fresh instance sees defaults', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  state.save(account, snapshot());
  state.save(otherAccount, snapshot());
  assert.equal(state.clear(account), true);
  assert.equal(storage.getItem(key()), null);
  assert.equal(state.storageAvailable, true);
  assert.deepEqual(state.load(account), empty());
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    empty()
  );
  assert.deepEqual(state.load(otherAccount), snapshot());
  assert.equal(storage.values.size, 1);
});

test('a refused remove resets this instance without claiming durable erasure', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  state.save(account, snapshot());
  storage.removeItem = () => {
    throw new Error('Synthetic removal refused');
  };
  assert.equal(state.clear(account), false);
  assert.equal(state.storageAvailable, false);
  assert.deepEqual(state.load(account), empty());
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    snapshot()
  );
});

test('blank accounts never share or persist a bookmark', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  assert.equal(state.save('', snapshot()), false);
  assert.equal(state.save('  ', snapshot()), false);
  assert.deepEqual(state.load(''), empty());
  assert.deepEqual(state.load('  '), empty());
  assert.equal(state.clear(''), false);
  assert.equal(storage.values.size, 0);
});

test('a paused payment resumes by UUID after reload without storing server facts', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const payment = {
    ...snapshot(),
    mode: 'payment',
    payment: {
      contributionId: 'ABCDEF00-1234-5678-9ABC-ABCDEF123456',
      paused: true,
      reference: 'Synthetic private reference',
      state: 'complete',
      next: { adminUrl: '/private' }
    }
  };
  const expected = {
    ...snapshot(),
    mode: 'payment',
    payment: {
      contributionId: 'abcdef00-1234-5678-9abc-abcdef123456',
      paused: true
    }
  };
  assert.equal(state.save(account, payment), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), expected);
  const reload = new AdminGuidanceState(() => storage);
  assert.deepEqual(reload.load(account), expected);
  assert.deepEqual(reload.load(otherAccount), empty());
  const loaded = reload.load(account);
  loaded.payment.paused = false;
  assert.equal(reload.load(account).payment.paused, true);
});

test('payment mode can be selected without selecting or replacing a payment', () => {
  const state = new AdminGuidanceState(() => null);
  const selected = { ...snapshot(), mode: 'payment' };
  state.save(account, selected);
  assert.deepEqual(state.load(account), selected);
});

test('automatic mode remembers a preference without retaining a run or authorization', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const expected = { ...snapshot(), mode: 'automatic' };
  const supplied = {
    ...expected,
    run: {
      phase: 'preparing',
      step: 'sponsor.website.visibility',
      events: ['Synthetic private action'],
      approved: true
    },
    authorization: { confirmed: true, actor: account },
    plan: {
      target: 'Synthetic private dossier',
      adminUrl: '/admin/fundraiser/sponsors?private=Synthetic'
    }
  };
  assert.equal(state.save(account, supplied), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), expected);
  const reload = new AdminGuidanceState(() => storage);
  assert.deepEqual(reload.load(account), expected);
  assert.deepEqual(reload.load(otherAccount), empty());
  storage.setItem(key(), JSON.stringify(supplied));
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    expected
  );
});

test('the workflow catalogue exposes the six existing journeys and their 21 reading steps', () => {
  assert.deepEqual(
    ADMIN_WORKFLOW_GUIDE_JOURNEYS.map((journey) => [
      journey.id,
      journey.steps.map((step) => step.id)
    ]),
    [
      [
        'agreement',
        ['pilot', 'source', 'proposal', 'qualification', 'confirm']
      ],
      ['preparation', ['obligations', 'prepare', 'draft']],
      ['authorization', ['review', 'content', 'schedule', 'authorize']],
      ['delivery', ['status', 'responsibility', 'evidence']],
      ['website', ['presentation', 'preview', 'visibility']],
      ['history', ['tracking', 'declare', 'save']]
    ]
  );
  assert.equal(
    ADMIN_WORKFLOW_GUIDE_JOURNEYS.reduce(
      (count, journey) => count + journey.steps.length,
      0
    ),
    21
  );
  for (const journey of ADMIN_WORKFLOW_GUIDE_JOURNEYS)
    for (const step of journey.steps) {
      assert.ok(step.targets.length > 0, `${journey.id}:${step.id}`);
      assert.ok(
        step.targets.every((target) => /^[a-z0-9-]+$/.test(target)),
        `${journey.id}:${step.id} uses fixed reading hooks only`
      );
    }
});

test('workflow mode can be selected independently of a workflow bookmark', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const expected = { ...snapshot(), mode: 'workflows' };
  assert.equal(state.save(account, expected), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), expected);
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    expected
  );
});

test('a paused workflow resumes after reload without sharing its step or copies with another account', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const selected = {
    ...snapshot(),
    mode: 'workflows',
    workflow: { journeyId: 'agreement', step: 2, paused: false }
  };
  assert.equal(state.save(account, selected), true);
  const paused = {
    ...selected,
    workflow: { ...selected.workflow, paused: true }
  };
  assert.equal(state.save(account, paused), true);
  selected.workflow.step = 0;
  const reload = new AdminGuidanceState(() => storage);
  assert.deepEqual(reload.load(account), paused);
  assert.deepEqual(reload.load(otherAccount), empty());
  const other = {
    ...snapshot(),
    mode: 'workflows',
    workflow: { journeyId: 'history', step: 2, paused: false }
  };
  assert.equal(reload.save(otherAccount, other), true);
  const copy = reload.load(account);
  copy.workflow.step = 4;
  copy.workflow.paused = false;
  assert.deepEqual(reload.load(account), paused);
  assert.equal(reload.save(account, copy), true);
  const resumed = new AdminGuidanceState(() => storage);
  assert.deepEqual(resumed.load(account), copy);
  assert.deepEqual(resumed.load(otherAccount), other);
  assert.equal(resumed.clear(account), true);
  assert.deepEqual(resumed.load(account), empty());
  assert.deepEqual(resumed.load(otherAccount), other);
});

test('every workflow persists its last step and rejects the next index without losing its bookmark', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  for (const journey of ADMIN_WORKFLOW_GUIDE_JOURNEYS) {
    const valid = {
      ...snapshot(),
      mode: 'workflows',
      workflow: {
        journeyId: journey.id,
        step: journey.steps.length - 1,
        paused: true
      }
    };
    assert.equal(state.save(account, valid), true, journey.id);
    const before = storage.getItem(key());
    assert.equal(
      state.save(account, {
        ...valid,
        workflow: { ...valid.workflow, step: journey.steps.length }
      }),
      false,
      journey.id
    );
    assert.equal(storage.getItem(key()), before, journey.id);
    assert.deepEqual(
      new AdminGuidanceState(() => storage).load(account),
      valid,
      journey.id
    );
  }
});

test('workflow bookmarks retain reading position without private parameters or completed actions', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const expected = {
    ...snapshot(),
    mode: 'workflows',
    workflow: { journeyId: 'agreement', step: 2, paused: true }
  };
  const supplied = {
    ...expected,
    token: 'synthetic-token',
    url: '/admin/fundraiser/sponsors?contact=synthetic@example.test',
    authorization: { confirmed: true, actor: account },
    workflow: {
      ...expected.workflow,
      contributionId: 'abcdef00-1234-5678-9abc-abcdef123456',
      source: 'Synthetic private agreement text',
      note: 'Synthetic private review note',
      query: { batchId: 'synthetic-batch', feedId: 'openg7:facebook' },
      targets: ['button[type="submit"]'],
      command: { action: 'compose' },
      approved: true,
      completed: true
    }
  };
  assert.equal(state.save(account, supplied), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), expected);
  storage.setItem(key(), JSON.stringify(supplied));
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    expected
  );
});

test('invalid workflow identifiers, steps and pause flags cannot replace valid reading cues', () => {
  const expected = {
    ...snapshot(),
    mode: 'workflows',
    workflow: { journeyId: 'agreement', step: 2, paused: true }
  };
  const invalidWorkflows = [
    null,
    [],
    {},
    { journeyId: 'unknown', step: 0, paused: false },
    { journeyId: '/admin/fundraiser/sponsors', step: 0, paused: false },
    { journeyId: 'agreement?token=synthetic', step: 0, paused: false },
    { journeyId: 'Agreement', step: 0, paused: false },
    { journeyId: 'agreement', step: -1, paused: false },
    { journeyId: 'agreement', step: 0.5, paused: false },
    { journeyId: 'agreement', step: '1', paused: false },
    { journeyId: 'agreement', step: Infinity, paused: false },
    { journeyId: 'agreement', step: NaN, paused: false },
    { journeyId: 'agreement', paused: false },
    { journeyId: 'agreement', step: 0 },
    { journeyId: 'agreement', step: 0, paused: 'true' },
    { journeyId: 'agreement', step: 0, paused: 0 }
  ];
  for (const workflow of invalidWorkflows) {
    const label = JSON.stringify(workflow);
    const storage = memoryStorage();
    const state = new AdminGuidanceState(() => storage);
    assert.equal(state.save(account, expected), true);
    const before = storage.getItem(key());
    const invalid = { ...expected, workflow };
    assert.equal(state.save(account, invalid), false, label);
    assert.equal(storage.getItem(key()), before, label);
    assert.deepEqual(state.load(account), expected, label);
    storage.setItem(key(), JSON.stringify(invalid));
    assert.deepEqual(
      new AdminGuidanceState(() => storage).load(account),
      empty(),
      label
    );
  }
});

test('automatic payment preference retains only the payment bookmark and no server facts', () => {
  const storage = memoryStorage();
  const state = new AdminGuidanceState(() => storage);
  const supplied = {
    ...snapshot(),
    mode: 'automatic',
    payment: {
      contributionId: 'ABCDEF00-1234-5678-9ABC-ABCDEF123456',
      paused: true,
      state: 'complete',
      completed: 6,
      amountMinor: 25000,
      privateEmail: 'synthetic@example.test',
      authorization: { confirmed: true },
      next: { adminUrl: '/private' }
    }
  };
  const expected = {
    ...snapshot(),
    mode: 'automatic',
    payment: {
      contributionId: 'abcdef00-1234-5678-9abc-abcdef123456',
      paused: true
    }
  };
  assert.equal(state.save(account, supplied), true);
  assert.deepEqual(JSON.parse(storage.getItem(key())), expected);
  const reload = new AdminGuidanceState(() => storage);
  assert.deepEqual(reload.load(account), expected);
  const copy = reload.load(account);
  copy.payment.paused = false;
  assert.deepEqual(reload.load(account), expected);
  storage.setItem(key(), JSON.stringify(supplied));
  assert.deepEqual(
    new AdminGuidanceState(() => storage).load(account),
    expected
  );
});

for (const mode of [
  'auto',
  'AUTOMATIC',
  'automatic ',
  '',
  true,
  null,
  {},
  []
]) {
  test(`invalid automatic preference ${JSON.stringify(mode)} cannot replace a saved mode`, () => {
    const storage = memoryStorage();
    const state = new AdminGuidanceState(() => storage);
    const expected = { ...snapshot(), mode: 'automatic' };
    assert.equal(state.save(account, expected), true);
    const before = storage.getItem(key());
    const invalid = { ...expected, mode };
    assert.equal(state.save(account, invalid), false);
    assert.equal(storage.getItem(key()), before);
    assert.deepEqual(state.load(account), expected);
    storage.setItem(key(), JSON.stringify(invalid));
    assert.deepEqual(
      new AdminGuidanceState(() => storage).load(account),
      empty()
    );
  });
}

test('current payment follows the workspace meaning and rejects ambiguous foreign queries', () => {
  const a = 'abcdef00-1234-5678-9abc-abcdef123456';
  const b = 'abcdef00-1234-5678-9abc-abcdef123457';
  assert.equal(guidancePaymentContext('sponsors', a, b), b);
  assert.equal(guidancePaymentContext('assistant', a, b), b);
  assert.equal(guidancePaymentContext('contributions', a, b), a);
  assert.equal(guidancePaymentContext('invoices', a, b), a);
  assert.equal(guidancePaymentContext('sponsors', a, null), null);
  assert.equal(guidancePaymentContext('contributions', null, b), null);
  assert.equal(guidancePaymentContext('attention', a, b), null);
  assert.equal(guidancePaymentContext('attention', a, a), a);
  assert.equal(guidancePaymentContext('attention', null, b), b);
  assert.equal(
    guidancePaymentContext('attention', ['private'], 'invalid'),
    null
  );
});

for (const invalidPayment of [
  null,
  [],
  {},
  { contributionId: '../private', paused: false },
  { contributionId: 'abcdef00-1234-5678-9abc-abcdef123456', paused: 'true' }
]) {
  test(
    'invalid payment bookmarks cannot overwrite valid discovery cues: ' +
      JSON.stringify(invalidPayment),
    () => {
      const storage = memoryStorage();
      const state = new AdminGuidanceState(() => storage);
      state.save(account, snapshot());
      const before = storage.getItem(key());
      assert.equal(
        state.save(account, {
          ...snapshot(),
          mode: 'payment',
          payment: invalidPayment
        }),
        false
      );
      assert.equal(storage.getItem(key()), before);
      assert.deepEqual(state.load(account), snapshot());
    }
  );
}
