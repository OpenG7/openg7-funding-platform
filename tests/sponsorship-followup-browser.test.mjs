import assert from 'node:assert/strict';
import test from 'node:test';

import { SponsorshipFollowupBrowser } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-followup-browser.js';
import { SponsorshipFollowupController } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-followup-controller.js';

const key = 'openg7-sponsorship-followup-token';
const token = 'synthetic-followup-local-only-000000000001';
const replaceGlobal = (t, name, descriptor) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    ...descriptor
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
};

test('SSR never accesses browser globals and preserves the existing URL-token follow-up read', async (t) => {
  for (const name of ['window', 'document'])
    replaceGlobal(t, name, {
      get: () => {
        throw new Error('SSR accessed ' + name);
      }
    });
  const browser = new SponsorshipFollowupBrowser(() => false);
  assert.equal(browser.getRememberedToken(), '');
  browser.rememberToken(token);
  browser.clearToken();
  browser.removeUrlToken();
  const reads = [];
  const controller = new SponsorshipFollowupController({
    api: {
      getSponsorshipFollowup: async (value) => {
        reads.push(value);
        return { paymentStatus: 'pending', reviewStatus: 'pending_review' };
      }
    },
    drafts: { revision: () => 4 },
    browser
  });
  t.after(() => controller.dispose());
  assert.equal(await controller.initialize(token), true);
  assert.deepEqual(reads, [token]);
  assert.equal(controller.token(), token);
});

test('browser storage remembers and clears only the follow-up token', (t) => {
  const items = new Map([['other-key', 'untouched']]);
  const storage = {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => items.set(name, value),
    removeItem: (name) => items.delete(name)
  };
  replaceGlobal(t, 'window', { value: { sessionStorage: storage } });
  const browser = new SponsorshipFollowupBrowser(() => true);
  assert.equal(browser.getRememberedToken(), '');
  browser.rememberToken(token);
  assert.equal(browser.getRememberedToken(), token);
  browser.clearToken();
  assert.equal(browser.getRememberedToken(), '');
  assert.equal(items.has(key), false);
  assert.equal(items.get('other-key'), 'untouched');
});

test('unavailable session storage does not prevent token cleanup or this visit', (t) => {
  const calls = [];
  replaceGlobal(t, 'window', {
    value: {
      get sessionStorage() {
        throw new Error('synthetic storage denied');
      },
      location: {
        href:
          'https://example.test/en/followup?token=' +
          token +
          '&campaign=local#details'
      },
      history: {
        state: { locale: 'en' },
        replaceState: (...args) => calls.push(args)
      }
    }
  });
  const browser = new SponsorshipFollowupBrowser(() => true);
  assert.equal(browser.getRememberedToken(), '');
  browser.rememberToken(token);
  browser.clearToken();
  browser.removeUrlToken();
  assert.deepEqual(calls, [
    [{ locale: 'en' }, '', '/en/followup?campaign=local#details']
  ]);
});

test('URL cleanup removes every token parameter and preserves query, hash and history state', (t) => {
  const calls = [];
  const window = {
    location: {
      href: 'https://example.test/followup?campaign=local&token=first&token=second#form'
    },
    history: {
      state: { navigationId: 3 },
      replaceState: (...args) => calls.push(args)
    }
  };
  replaceGlobal(t, 'window', { value: window });
  const browser = new SponsorshipFollowupBrowser(() => true);
  browser.removeUrlToken();
  assert.deepEqual(calls, [
    [{ navigationId: 3 }, '', '/followup?campaign=local#form']
  ]);
  window.location.href = 'https://example.test/followup?campaign=local#form';
  browser.removeUrlToken();
  assert.equal(calls.length, 1);
});
