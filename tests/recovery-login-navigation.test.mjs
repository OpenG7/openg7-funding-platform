import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { navigateRecoveryLoginAfterNetworkChange } from './support/recovery-login-navigation.mjs';

const origin = 'http://127.0.0.1:43835';
const url = origin + '/admin/login';
const renderError = new Error('The login form did not render');
const requestFailure = (overrides = {}) => {
  const request = {
    url: origin + '/main-recovery.js',
    method: 'GET',
    type: 'script',
    error: 'net::ERR_NETWORK_CHANGED',
    ...overrides
  };
  return {
    url: () => request.url,
    method: () => request.method,
    resourceType: () => request.type,
    failure: () => ({ errorText: request.error })
  };
};
const fixture = (attempts) => {
  const page = new EventEmitter();
  const navigations = [];
  let current;
  let renderChecks = 0;
  page.goto = async (target) => {
    navigations.push(target);
    current = attempts[navigations.length - 1];
    assert.ok(current, 'Navigation must remain within the allowed attempts');
    for (const failure of current.navigationFailures ?? [])
      page.emit('requestfailed', failure);
    if (current.navigationError) throw current.navigationError;
    return { status: () => current.status ?? 200 };
  };
  return {
    page,
    navigations,
    renderChecks: () => renderChecks,
    navigate: (target = url) =>
      navigateRecoveryLoginAfterNetworkChange(page, target, async () => {
        renderChecks += 1;
        for (const failure of current.renderFailures ?? [])
          page.emit('requestfailed', failure);
        if (current.renderError) throw current.renderError;
      })
  };
};

test('a successful recovery login page loads once and preserves existing listeners', async () => {
  const subject = fixture([{}]);
  const existing = () => {};
  subject.page.on('requestfailed', existing);
  const response = await subject.navigate();
  assert.equal(response.status(), 200);
  assert.deepEqual(subject.navigations, [url]);
  assert.equal(subject.renderChecks(), 1);
  assert.deepEqual(subject.page.listeners('requestfailed'), [existing]);
});

test('a main script interrupted after HTTP 200 repeats only the login load once', async () => {
  const subject = fixture([
    { renderFailures: [requestFailure()], renderError },
    {}
  ]);
  await subject.navigate();
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.renderChecks(), 2);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('an interrupted exact login document may repeat when navigation throws', async () => {
  const subject = fixture([
    {
      navigationFailures: [requestFailure({ type: 'document', url })],
      navigationError: renderError
    },
    {}
  ]);
  await subject.navigate();
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.renderChecks(), 1);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a second interruption fails without a third navigation', async () => {
  const finalError = new Error('The second login load was interrupted');
  const subject = fixture([
    { renderFailures: [requestFailure()], renderError },
    { renderFailures: [requestFailure()], renderError: finalError }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === finalError);
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('an unrelated error on the second load preserves that failure', async () => {
  const finalError = new Error('Authentication configuration unavailable');
  const subject = fixture([
    { renderFailures: [requestFailure()], renderError },
    { renderError: finalError }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === finalError);
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

for (const [name, failure] of [
  ['no network failure', null],
  [
    'a different network error',
    requestFailure({ error: 'net::ERR_CONNECTION_RESET' })
  ],
  [
    'an API read',
    requestFailure({ type: 'fetch', url: origin + '/api/admin/auth/config' })
  ],
  [
    'an API URL reported as a script',
    requestFailure({ url: origin + '/api/admin/auth/config' })
  ],
  [
    'a session mutation',
    requestFailure({ method: 'POST', url: origin + '/api/admin/session' })
  ],
  ['a script POST', requestFailure({ method: 'POST' })],
  [
    'a foreign script',
    requestFailure({ url: 'http://127.0.0.1:43836/main.js' })
  ],
  [
    'a different document',
    requestFailure({ type: 'document', url: origin + '/admin/fundraiser' })
  ]
]) {
  test(`a failed login render does not retry for ${name}`, async () => {
    const subject = fixture([
      { renderFailures: failure ? [failure] : [], renderError }
    ]);
    await assert.rejects(subject.navigate(), (error) => error === renderError);
    assert.deepEqual(subject.navigations, [url]);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}

for (const status of [401, 403, 404, 500]) {
  test(`HTTP ${status} is not retried even with a recorded network change`, async () => {
    const subject = fixture([
      { navigationFailures: [requestFailure()], status }
    ]);
    await assert.rejects(subject.navigate(), /did not return HTTP 200/);
    assert.deepEqual(subject.navigations, [url]);
    assert.equal(subject.renderChecks(), 0);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}

for (const target of [
  'https://127.0.0.1:43835/admin/login',
  'http://funding.example.test/admin/login',
  origin + '/admin/fundraiser',
  origin + '/admin/login/',
  origin + '/api/admin/session',
  origin + '/admin/login?returnUrl=/admin/fundraiser',
  origin + '/admin/login#submit',
  'http://fixture:password@127.0.0.1:43835/admin/login'
]) {
  test(`recovery login rejects a target outside its exact route: ${target}`, async () => {
    const subject = fixture([{}]);
    await assert.rejects(subject.navigate(target), /exact loopback login page/);
    assert.deepEqual(subject.navigations, []);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}
