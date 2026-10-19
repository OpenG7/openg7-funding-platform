import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { signInAdminIdentity } from './identity/support/admin-browser.ts';

const origin = 'http://127.0.0.1:4185';
const destination = '/admin/fundraiser/assistant?type=publication_late';
const networkChange = {
  method: 'GET',
  resourceType: 'script',
  errorText: 'net::ERR_NETWORK_CHANGED',
  url: origin + '/main-synthetic.js'
};

function loginPage({
  failures = [],
  ok = true,
  navigationError,
  linkError
} = {}) {
  const page = new EventEmitter();
  page.navigations = [];
  page.actions = [];
  let currentUrl = 'about:blank';
  page.url = () => currentUrl;
  page.goto = async (path) => {
    page.navigations.push(path);
    if (navigationError) throw navigationError;
    currentUrl = new URL(path, origin).href;
    const failure = failures[page.navigations.length - 1];
    if (failure)
      page.emit('requestfailed', {
        method: () => failure.method,
        resourceType: () => failure.resourceType,
        failure: () => ({ errorText: failure.errorText }),
        url: () => failure.url
      });
    return { ok: () => ok };
  };
  page.locator = () => ({
    click: async () => {
      assert.equal(page.listenerCount('requestfailed'), 0);
      if (linkError) throw linkError;
      page.actions.push('identity-link');
    }
  });
  page.getByLabel = () => ({
    selectOption: async (role) => page.actions.push(role)
  });
  page.getByRole = () => ({
    click: async () => page.actions.push('continue')
  });
  return page;
}

test('identity login reloads its GET once after the local startup script loses the runner network', async () => {
  const page = loginPage({ failures: [networkChange] });
  await signInAdminIdentity(page, destination);
  assert.deepEqual(page.navigations, [
    '/admin/login?returnUrl=' + encodeURIComponent(destination),
    '/admin/login?returnUrl=' + encodeURIComponent(destination)
  ]);
  assert.deepEqual(page.actions, ['identity-link', 'owner', 'continue']);
});

test('a second script network change still fails without repeating authentication', async () => {
  const originalError = new Error('Sign-in link unavailable');
  const page = loginPage({
    failures: [networkChange, networkChange],
    linkError: originalError
  });
  await assert.rejects(
    signInAdminIdentity(page, destination),
    (error) => error === originalError
  );
  assert.equal(page.navigations.length, 2);
  assert.deepEqual(page.actions, []);
});

for (const [name, options] of [
  ['HTTP failure', { failures: [networkChange], ok: false }],
  [
    'another network error',
    { failures: [{ ...networkChange, errorText: 'net::ERR_FAILED' }] }
  ],
  [
    'another origin',
    { failures: [{ ...networkChange, url: 'http://127.0.0.1:4186/main.js' }] }
  ],
  [
    'an API request',
    {
      failures: [
        {
          ...networkChange,
          resourceType: 'fetch',
          url: origin + '/api/admin/auth/config'
        }
      ]
    }
  ],
  ['a POST', { failures: [{ ...networkChange, method: 'POST' }] }]
]) {
  test(`identity login preserves ${name} without retrying navigation or authentication`, async () => {
    const originalError = new Error('Original sign-in failure');
    const page = loginPage({ ...options, linkError: originalError });
    await assert.rejects(
      signInAdminIdentity(page, destination),
      (error) => error === originalError
    );
    assert.equal(page.navigations.length, 1);
    assert.deepEqual(page.actions, []);
  });
}

test('identity login preserves a failed document navigation and removes its temporary observer', async () => {
  const originalError = new Error('net::ERR_ABORTED');
  const page = loginPage({ navigationError: originalError });
  await assert.rejects(
    signInAdminIdentity(page, destination),
    (error) => error === originalError
  );
  assert.equal(page.navigations.length, 1);
  assert.equal(page.listenerCount('requestfailed'), 0);
  assert.deepEqual(page.actions, []);
});
