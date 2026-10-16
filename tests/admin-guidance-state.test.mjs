import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_GUIDANCE_PAGES } from '../dist/apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance-pages.js';
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
