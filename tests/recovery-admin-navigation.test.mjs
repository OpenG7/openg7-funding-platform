import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { navigateRecoveryAdminAfterNetworkChange } from './support/recovery-admin-navigation.mjs';

const origin = 'http://127.0.0.1:43835';
const url = origin + '/admin/fundraiser/contributions';
const renderError = new Error('The restored administration did not render');
const session = {
  token: 'openg7-admin-session.synthetic-recovery-navigation',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString()
};
const requestFailure = (overrides = {}) => {
  const request = {
    url: origin + '/chunk-CAT5TMR4.js',
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
const failedResponse = (
  status,
  path = '/api/admin/contributions',
  type = 'fetch'
) => ({
  url: () => origin + path,
  status: () => status,
  request: () => ({ resourceType: () => type })
});
const fixture = (attempts, options = {}) => {
  const page = new EventEmitter();
  const calls = { navigations: [], renderChecks: 0, storageReads: 0 };
  const state = {
    saved: options.saved === undefined ? session : options.saved,
    url: options.currentUrl ?? origin + '/admin/fundraiser'
  };
  let current;
  page.url = () => state.url;
  page.evaluate = async (callback) => {
    calls.storageReads += 1;
    if (current?.storageError) throw current.storageError;
    return runInNewContext(`(${callback.toString()})()`, {
      sessionStorage: {
        getItem: (key) =>
          key === 'openg7-admin-session-token'
            ? (state.saved?.token ?? null)
            : key === 'openg7-admin-session-expires-at'
              ? (state.saved?.expiresAt ?? null)
              : null
      }
    });
  };
  page.goto = async (target) => {
    calls.navigations.push(target);
    current = attempts[calls.navigations.length - 1];
    assert.ok(current, 'Navigation must remain within the allowed attempts');
    state.url = current.redirect ?? target;
    for (const failure of current.navigationFailures ?? [])
      page.emit('requestfailed', failure);
    if (current.navigationError) throw current.navigationError;
    return { status: () => current.status ?? 200 };
  };
  return {
    page,
    calls,
    navigate: (target = url) =>
      navigateRecoveryAdminAfterNetworkChange(page, target, async () => {
        calls.renderChecks += 1;
        for (const response of current.responses ?? [])
          page.emit('response', response);
        for (const failure of current.renderFailures ?? [])
          page.emit('requestfailed', failure);
        if ('saved' in current) state.saved = current.saved;
        if (current.renderError) throw current.renderError;
      })
  };
};
const assertClean = (subject) => {
  assert.equal(subject.page.listenerCount('response'), 0);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
};

for (const route of ['contributions', 'invoices', 'email-queue']) {
  test(`the restored ${route} page loads once under the existing session`, async () => {
    const subject = fixture([{}]);
    const target = origin + '/admin/fundraiser/' + route;
    const response = await subject.navigate(target);
    assert.equal(response.status(), 200);
    assert.deepEqual(subject.calls.navigations, [target]);
    assert.equal(subject.calls.renderChecks, 1);
    assert.equal(subject.calls.storageReads, 1);
    assertClean(subject);
  });
}

test('an interrupted lazy chunk retries only the exact page once with the unchanged valid session', async () => {
  const subject = fixture([
    { renderFailures: [requestFailure()], renderError },
    {}
  ]);
  const failureListener = () => {};
  const responseListener = () => {};
  subject.page.on('requestfailed', failureListener);
  subject.page.on('response', responseListener);
  await subject.navigate();
  assert.deepEqual(subject.calls.navigations, [url, url]);
  assert.equal(subject.calls.renderChecks, 2);
  assert.equal(subject.calls.storageReads, 2);
  assert.deepEqual(subject.page.listeners('requestfailed'), [failureListener]);
  assert.deepEqual(subject.page.listeners('response'), [responseListener]);
});

test('a second interrupted render fails without a third navigation', async () => {
  const finalError = new Error('The second restored page did not render');
  const subject = fixture([
    { renderFailures: [requestFailure()], renderError },
    { renderFailures: [requestFailure()], renderError: finalError }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === finalError);
  assert.deepEqual(subject.calls.navigations, [url, url]);
  assertClean(subject);
});

for (const [name, failure] of [
  ['no network failure', null],
  [
    'a different network error',
    requestFailure({ error: 'net::ERR_CONNECTION_RESET' })
  ],
  [
    'an API read',
    requestFailure({ type: 'fetch', url: origin + '/api/admin/contributions' })
  ],
  [
    'an API URL reported as a script',
    requestFailure({ url: origin + '/api/admin/contributions' })
  ],
  ['a script POST', requestFailure({ method: 'POST' })],
  [
    'a session mutation',
    requestFailure({
      method: 'POST',
      type: 'fetch',
      url: origin + '/api/admin/session'
    })
  ],
  [
    'a foreign chunk',
    requestFailure({ url: 'http://127.0.0.1:43836/chunk-CAT5TMR4.js' })
  ],
  ['a document interruption', requestFailure({ type: 'document', url })],
  [
    'an unrelated script',
    requestFailure({ url: origin + '/external-widget.js' })
  ]
]) {
  test(`a rendering regression is not retried for ${name}`, async () => {
    const subject = fixture([
      { renderFailures: failure ? [failure] : [], renderError }
    ]);
    await assert.rejects(subject.navigate(), (error) => error === renderError);
    assert.deepEqual(subject.calls.navigations, [url]);
    assert.equal(subject.calls.storageReads, 1);
    assertClean(subject);
  });
}

for (const status of [401, 403, 404, 500]) {
  test(`document HTTP ${status} prevents retry even after a chunk interruption`, async () => {
    const subject = fixture([
      { navigationFailures: [requestFailure()], status }
    ]);
    await assert.rejects(subject.navigate(), /did not return HTTP 200/);
    assert.deepEqual(subject.calls.navigations, [url]);
    assert.equal(subject.calls.renderChecks, 0);
    assertClean(subject);
  });
}

for (const [name, response] of [
  ['admin HTTP 401', failedResponse(401)],
  ['admin HTTP 403', failedResponse(403)],
  ['admin HTTP 500', failedResponse(500)],
  ['missing script', failedResponse(404, '/chunk-MISSING.js', 'script')]
]) {
  test(`${name} prevents retry even after another chunk reports a network change`, async () => {
    const subject = fixture([
      { responses: [response], renderFailures: [requestFailure()], renderError }
    ]);
    await assert.rejects(subject.navigate(), (error) => error === renderError);
    assert.deepEqual(subject.calls.navigations, [url]);
    assertClean(subject);
  });
}

for (const [name, saved] of [
  ['missing', null],
  ['different', { ...session, token: 'openg7-admin-session.replacement' }],
  [
    'renewed',
    { ...session, expiresAt: new Date(Date.now() + 7_200_000).toISOString() }
  ],
  ['expired', { ...session, expiresAt: '2000-01-01T00:00:00Z' }]
]) {
  test(`a ${name} session prevents a second navigation`, async () => {
    const subject = fixture([
      { saved, renderFailures: [requestFailure()], renderError }
    ]);
    await assert.rejects(subject.navigate(), (error) => error === renderError);
    assert.deepEqual(subject.calls.navigations, [url]);
    assertClean(subject);
  });
}

test('unreadable session storage preserves the original render failure without retry', async () => {
  const subject = fixture([
    {
      storageError: new Error('Storage unavailable'),
      renderFailures: [requestFailure()],
      renderError
    }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === renderError);
  assert.deepEqual(subject.calls.navigations, [url]);
  assertClean(subject);
});

test('redirecting to login prevents retry even with a network interruption and a saved session', async () => {
  const subject = fixture([
    {
      redirect: origin + '/admin/login',
      renderFailures: [requestFailure()],
      renderError
    }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === renderError);
  assert.deepEqual(subject.calls.navigations, [url]);
  assertClean(subject);
});

for (const saved of [
  null,
  { ...session, token: 'legacy-token' },
  { ...session, expiresAt: 'invalid' },
  { ...session, expiresAt: '2000-01-01T00:00:00Z' }
]) {
  test('an absent or invalid saved session cannot start an administrative navigation', async () => {
    const subject = fixture([{}], { saved });
    await assert.rejects(subject.navigate(), /unexpired saved session/);
    assert.deepEqual(subject.calls.navigations, []);
    assertClean(subject);
  });
}

for (const target of [
  'https://127.0.0.1:43835/admin/fundraiser/contributions',
  'http://funding.example.test/admin/fundraiser/contributions',
  origin + '/admin/fundraiser',
  origin + '/admin/fundraiser/contributions/',
  origin + '/api/admin/contributions',
  origin + '/admin/fundraiser/contributions?retry=true',
  origin + '/admin/fundraiser/contributions#table',
  'http://fixture:password@127.0.0.1:43835/admin/fundraiser/contributions'
]) {
  test(`a target outside the three loopback read-only routes is refused: ${target}`, async () => {
    const subject = fixture([{}]);
    await assert.rejects(
      subject.navigate(target),
      /exact loopback read-only page/
    );
    assert.deepEqual(subject.calls.navigations, []);
    assert.equal(subject.calls.storageReads, 0);
    assertClean(subject);
  });
}

test('a page from another origin cannot lend its session to recovery navigation', async () => {
  const subject = fixture([{}], {
    currentUrl: 'http://127.0.0.1:43836/admin/fundraiser'
  });
  await assert.rejects(subject.navigate(), /current loopback origin/);
  assert.deepEqual(subject.calls.navigations, []);
  assert.equal(subject.calls.storageReads, 0);
  assertClean(subject);
});
