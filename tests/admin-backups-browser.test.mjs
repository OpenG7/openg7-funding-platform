import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminBackupsBrowser } from '../dist/apps/funding-web/src/app/features/funding/components/admin-backups/admin-backups-browser.js';

const requestId = '10000000-0000-4000-8000-000000000701';
const storageKey = 'openg7-backup-request';

const withGlobals = async (properties, action) => {
  const originals = Object.fromEntries(
    Object.keys(properties).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    ])
  );
  try {
    for (const [key, descriptor] of Object.entries(properties))
      Object.defineProperty(globalThis, key, {
        configurable: true,
        ...descriptor
      });
    await action();
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
};

test('backup browser module and construction do not access browser globals during SSR', async () => {
  const unavailable = {
    get: () => {
      throw new Error('Browser globals must remain lazy.');
    }
  };
  await withGlobals(
    { sessionStorage: unavailable, crypto: unavailable },
    async () => {
      const module =
        await import('../dist/apps/funding-web/src/app/features/funding/components/admin-backups/admin-backups-browser.js?ssr');
      const browser = module.createAdminBackupsBrowser();
      assert.equal(browser.readPendingId(), null);
      assert.doesNotThrow(() => browser.writePendingId(requestId));
      assert.doesNotThrow(() => browser.writePendingId(null));
      assert.equal(typeof browser.now(), 'number');
    }
  );
});

test('browser recovery stores only the request UUID under its existing key', async () => {
  const values = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem: (key) => {
      writes.push([key, null]);
      values.delete(key);
    }
  };
  let uuids = 0;
  await withGlobals(
    {
      sessionStorage: { value: storage },
      crypto: { value: { randomUUID: () => (++uuids, requestId) } }
    },
    () => {
      const browser = createAdminBackupsBrowser();
      assert.equal(browser.readPendingId(), null);
      assert.equal(browser.randomUUID(), requestId);
      assert.equal(uuids, 1);
      browser.writePendingId(requestId);
      assert.equal(browser.readPendingId(), requestId);
      assert.deepEqual([...values], [[storageKey, requestId]]);
      browser.writePendingId(null);
      assert.equal(browser.readPendingId(), null);
      assert.deepEqual(writes, [
        [storageKey, requestId],
        [storageKey, null]
      ]);
    }
  );
});

test('invalid stored recovery values are ignored without mutating storage', async () => {
  for (const value of ['', 'invalid', 'f'.repeat(35), 'x'.repeat(36), '{}']) {
    await withGlobals(
      {
        sessionStorage: {
          value: {
            getItem: (key) => {
              assert.equal(key, storageKey);
              return value;
            },
            setItem: () =>
              assert.fail('Reading recovery must not write storage.'),
            removeItem: () =>
              assert.fail('Reading recovery must not remove storage.')
          }
        }
      },
      () => assert.equal(createAdminBackupsBrowser().readPendingId(), null)
    );
  }
});

test('storage method failures keep recovery optional', async () => {
  const fail = () => {
    throw new Error('Synthetic storage restriction');
  };
  await withGlobals(
    {
      sessionStorage: {
        value: { getItem: fail, setItem: fail, removeItem: fail }
      }
    },
    () => {
      const browser = createAdminBackupsBrowser();
      assert.equal(browser.readPendingId(), null);
      assert.doesNotThrow(() => browser.writePendingId(requestId));
      assert.doesNotThrow(() => browser.writePendingId(null));
    }
  );
});
