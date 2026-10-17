import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { completeRecoveryLoginAfterNetworkChange } from './support/recovery-login-navigation.mjs';

const origin = 'http://127.0.0.1:35823';
const url = origin + '/admin/login';
const renderError = new Error('The authenticated admin route did not render');
const session = {
  sessionToken: 'openg7-admin-session.synthetic-recovery-fixture',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString()
};
const requestFailure = (overrides = {}) => {
  const request = {
    url: origin + '/chunk-admin.js',
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
const sessionResponse = (overrides = {}) => {
  const response = {
    url: origin + '/api/admin/session',
    method: 'POST',
    status: 200,
    body: session,
    ...overrides
  };
  return {
    url: () => response.url,
    request: () => ({ method: () => response.method }),
    status: () => response.status,
    json: async () => {
      if (response.bodyError) throw response.bodyError;
      return response.body;
    }
  };
};
const fixture = (options = {}) => {
  const page = new EventEmitter();
  const calls = {
    submissions: 0,
    navigations: [],
    assertions: 0,
    storageReads: 0
  };
  page.goto = async (target) => {
    calls.navigations.push(target);
    return { status: () => options.navigationStatus ?? 200 };
  };
  page.evaluate = async (callback, expected) => {
    calls.storageReads += 1;
    const saved =
      options.savedSession === undefined ? session : options.savedSession;
    return runInNewContext(`(${callback.toString()})(expected)`, {
      expected,
      sessionStorage: {
        getItem: (key) =>
          key === 'openg7-admin-session-token'
            ? (saved?.sessionToken ?? null)
            : key === 'openg7-admin-session-expires-at'
              ? (saved?.expiresAt ?? null)
              : null
      }
    });
  };
  return {
    page,
    calls,
    complete: (target = url) =>
      completeRecoveryLoginAfterNetworkChange(
        page,
        target,
        async () => {
          calls.submissions += 1;
          for (const response of options.responses ?? [sessionResponse()])
            page.emit('response', response);
          for (const failure of options.failures ?? [requestFailure()])
            page.emit('requestfailed', failure);
          if (options.submitError) throw options.submitError;
        },
        async () => {
          const error = (options.errors ?? [renderError, null])[
            calls.assertions
          ];
          calls.assertions += 1;
          if (error) throw error;
        }
      )
  };
};
const assertNoRetry = async (subject, error = renderError) => {
  await assert.rejects(subject.complete(), (actual) => actual === error);
  assert.equal(subject.calls.submissions, 1);
  assert.deepEqual(subject.calls.navigations, []);
  assert.equal(subject.page.listenerCount('response'), 0);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
};

test('a successful sign-in never reloads or submits twice, even with an interrupted script', async () => {
  const subject = fixture({ errors: [null] });
  await subject.complete();
  assert.equal(subject.calls.submissions, 1);
  assert.deepEqual(subject.calls.navigations, []);
  assert.equal(subject.calls.storageReads, 0);
  assert.equal(subject.page.listenerCount('response'), 0);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('an interrupted admin import reconciles the exact saved session and navigates once without resubmitting', async () => {
  const subject = fixture();
  const responseListener = () => {};
  const failureListener = () => {};
  subject.page.on('response', responseListener);
  subject.page.on('requestfailed', failureListener);
  await subject.complete();
  assert.equal(subject.calls.submissions, 1);
  assert.deepEqual(subject.calls.navigations, [origin + '/admin/fundraiser']);
  assert.equal(subject.calls.storageReads, 1);
  assert.equal(subject.calls.assertions, 2);
  assert.deepEqual(subject.page.listeners('response'), [responseListener]);
  assert.deepEqual(subject.page.listeners('requestfailed'), [failureListener]);
});

test('a second rendering failure propagates without another GET or another submission', async () => {
  const finalError = new Error('The admin route still did not render');
  const subject = fixture({ errors: [renderError, finalError] });
  await assert.rejects(subject.complete(), (actual) => actual === finalError);
  assert.equal(subject.calls.submissions, 1);
  assert.deepEqual(subject.calls.navigations, [origin + '/admin/fundraiser']);
  assert.equal(subject.calls.assertions, 2);
  assert.equal(subject.page.listenerCount('response'), 0);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('an error during submission is never recovered by another submission or navigation', async () => {
  const submitError = new Error('The session submission failed');
  await assertNoRetry(fixture({ submitError }), submitError);
});

for (const status of [401, 403, 500]) {
  test(`a session POST returning HTTP ${status} cannot authorize recovery`, async () => {
    const subject = fixture({ responses: [sessionResponse({ status })] });
    await assertNoRetry(subject);
    assert.equal(subject.calls.storageReads, 0);
  });
}

for (const [name, responses] of [
  ['an interrupted POST without a confirmed response', []],
  [
    'a response from another origin',
    [sessionResponse({ url: 'http://127.0.0.1:35824/api/admin/session' })]
  ],
  ['a GET session response', [sessionResponse({ method: 'GET' })]],
  [
    'a different authentication endpoint',
    [sessionResponse({ url: origin + '/api/admin/auth/current' })]
  ],
  [
    'a response with unreadable JSON',
    [sessionResponse({ bodyError: new Error('Invalid session JSON') })]
  ]
]) {
  test(`sign-in recovery rejects ${name}`, async () => {
    await assertNoRetry(fixture({ responses }));
  });
}

for (const [name, savedSession, responseSession] of [
  ['a missing session', null, session],
  [
    'a replaced token',
    { ...session, sessionToken: 'openg7-admin-session.other' },
    session
  ],
  [
    'a replaced expiration',
    { ...session, expiresAt: new Date(Date.now() + 120_000).toISOString() },
    session
  ],
  [
    'an expired session',
    { ...session, expiresAt: '2000-01-01T00:00:00Z' },
    { ...session, expiresAt: '2000-01-01T00:00:00Z' }
  ],
  [
    'an invalid expiration',
    { ...session, expiresAt: 'invalid' },
    { ...session, expiresAt: 'invalid' }
  ],
  [
    'a token without the session prefix',
    { ...session, sessionToken: 'synthetic-root-token' },
    { ...session, sessionToken: 'synthetic-root-token' }
  ]
]) {
  test(`sign-in recovery rejects ${name} without another session POST`, async () => {
    await assertNoRetry(
      fixture({
        savedSession,
        responses: [sessionResponse({ body: responseSession })]
      })
    );
  });
}

for (const [name, failures] of [
  ['no recorded network change', []],
  [
    'another network error',
    [requestFailure({ error: 'net::ERR_CONNECTION_RESET' })]
  ],
  [
    'a foreign script',
    [requestFailure({ url: 'http://127.0.0.1:35824/chunk-admin.js' })]
  ],
  ['a script POST', [requestFailure({ method: 'POST' })]],
  [
    'an API URL reported as a script',
    [requestFailure({ url: origin + '/api/admin/session' })]
  ],
  [
    'an API request',
    [
      requestFailure({
        type: 'fetch',
        url: origin + '/api/admin/session',
        method: 'POST'
      })
    ]
  ],
  [
    'a document request',
    [requestFailure({ type: 'document', url: origin + '/admin/fundraiser' })]
  ]
]) {
  test(`a failed sign-in does not recover for ${name}`, async () => {
    await assertNoRetry(fixture({ failures }));
  });
}

for (const status of [401, 403, 404, 500]) {
  test(`a recovery GET returning HTTP ${status} fails without another GET or POST`, async () => {
    const subject = fixture({ navigationStatus: status });
    await assert.rejects(subject.complete(), /did not return HTTP 200/);
    assert.equal(subject.calls.submissions, 1);
    assert.deepEqual(subject.calls.navigations, [origin + '/admin/fundraiser']);
    assert.equal(subject.calls.assertions, 1);
    assert.equal(subject.page.listenerCount('response'), 0);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}

for (const target of [
  'http://funding.example.test/admin/login',
  origin + '/admin/fundraiser',
  origin + '/admin/login?returnUrl=/admin/fundraiser'
]) {
  test(`sign-in recovery rejects an unsupported target before submitting: ${target}`, async () => {
    const subject = fixture();
    await assert.rejects(subject.complete(target), /exact loopback login page/);
    assert.equal(subject.calls.submissions, 0);
    assert.deepEqual(subject.calls.navigations, []);
  });
}
