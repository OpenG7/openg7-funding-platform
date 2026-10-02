import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin.service.js';

const sessionKey = 'openg7-admin-session-token';
const expiryKey = 'openg7-admin-session-expires-at';
const selectionKey = 'openg7-admin-selected-sponsorship';
const syntheticToken = 'openg7-admin-session.synthetic';
const cookieMarker = 'openg7-admin-session.cookie';
const baseUrl = 'https://funding.example.test/api';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

const serviceFixture = (t, token = syntheticToken) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sessionStorage = memoryStorage();
  sessionStorage.setItem(sessionKey, token);
  sessionStorage.setItem(expiryKey, new Date(Date.now() + 60000).toISOString());
  sessionStorage.setItem(selectionKey, 'synthetic-selection');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage,
      localStorage: memoryStorage(),
      __OPENG7_FUNDING_API_BASE_URL__: baseUrl + '/'
    }
  });
  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      delete globalThis.window;
    }
  });
  return { service: new FundingAdminService(), sessionStorage };
};

const backfillPreview = {
  action: 'preview',
  scope: { from: '2026-01-01', to: '2026-01-02', limit: 1 }
};
const families = [
  {
    name: 'activity',
    read: (service) => service.contributionActivity({ after: 'cursor /' }),
    readPath: '/admin/contribution-activity?after=cursor+%2F',
    write: (service) => service.claimContributionToasts(['contribution-1']),
    writePath: '/admin/contribution-activity/present',
    body: { ids: ['contribution-1'] },
    timeout: 10000,
    fallback: 'ACTIVITY_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'pilotage',
    read: (service) => service.pilotage({ page: 2, domain: 'publications' }),
    readPath: '/admin/pilotage?page=2&domain=publications',
    write: (service) =>
      service.acknowledgePilotReceipt('request-1', 'reviewed'),
    writePath: '/admin/pilotage/receipt',
    body: {
      requestId: 'request-1',
      confirmation: 'request-1',
      reason: 'reviewed'
    },
    timeout: 15000,
    fallback: 'PILOTAGE_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'backfill',
    read: (service) => service.stripeBackfill(undefined, 'run /'),
    readPath: '/admin/stripe-backfill?id=run+%2F',
    write: (service) => service.stripeBackfill(backfillPreview),
    writePath: '/admin/stripe-backfill',
    body: backfillPreview,
    timeout: 90000,
    fallback: 'BACKFILL_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'automation',
    read: (service) =>
      service.publicationAutomation(undefined, {
        sponsorshipId: 'sponsor /',
        deliveryId: 'delivery /'
      }),
    readPath:
      '/admin/publication-automation?sponsorshipId=sponsor+%2F&deliveryId=delivery+%2F',
    write: (service) =>
      service.publicationAutomation(
        { action: 'check', feedId: 'openg7:facebook' },
        { sponsorshipId: 'ignored-on-command' }
      ),
    writePath: '/admin/publication-automation',
    body: { action: 'check', feedId: 'openg7:facebook' },
    timeout: undefined,
    fallback: 'AUTOMATION_UNAVAILABLE',
    clearsUnauthorizedSession: false
  }
];

test('admin JSON requests preserve GET/POST, query, payload, authentication and timeout policies', async (t) => {
  for (const family of families) {
    for (const token of [syntheticToken, cookieMarker]) {
      await t.test(
        `${family.name}: ${token === cookieMarker ? 'cookie' : 'bearer'}`,
        async (t) => {
          const { service } = serviceFixture(t, token);
          const timeouts = [];
          const signals = [];
          t.mock.method(AbortSignal, 'timeout', (delay) => {
            const signal = new AbortController().signal;
            timeouts.push(delay);
            signals.push(signal);
            return signal;
          });
          const payload = { synthetic: true };
          const requests = [];
          t.mock.method(globalThis, 'fetch', async (url, options) => {
            requests.push({ url, options });
            return Response.json(payload);
          });

          assert.deepEqual(await family.read(service), payload);
          assert.deepEqual(await family.write(service), payload);
          assert.equal(requests.length, 2);
          for (const [index, request] of requests.entries()) {
            assert.equal(
              request.url,
              baseUrl + (index === 0 ? family.readPath : family.writePath)
            );
            assert.equal(request.options.method, index === 0 ? 'GET' : 'POST');
            assert.equal(request.options.cache, 'no-store');
            assert.equal(request.options.credentials, undefined);
            assert.deepEqual(request.options.headers, {
              Accept: 'application/json',
              ...(token === cookieMarker
                ? {}
                : { Authorization: `Bearer ${syntheticToken}` }),
              'Content-Type': 'application/json'
            });
            assert.equal(
              request.options.body,
              index === 0 ? undefined : JSON.stringify(family.body)
            );
            assert.equal(request.options.signal, signals[index]);
          }
          assert.deepEqual(
            timeouts,
            family.timeout === undefined ? [] : [family.timeout, family.timeout]
          );
        }
      );
    }
  }
});

test('admin JSON failures keep endpoint-specific errors and session invalidation', async (t) => {
  for (const family of families) {
    for (const status of [401, 403, 409, 503]) {
      await t.test(`${family.name}: ${status}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json({ code: 'SYNTHETIC_FAILURE' }, { status })
        );
        await assert.rejects(family.read(service), (error) => {
          assert.equal(
            error.message,
            family.name === 'activity'
              ? family.fallback
              : family.name === 'pilotage' && status === 401
                ? 'SESSION_EXPIRED'
                : family.name === 'pilotage' && status === 403
                  ? 'READ_ONLY'
                  : 'SYNTHETIC_FAILURE'
          );
          assert.equal(
            error.status,
            family.name === 'automation' ? undefined : status
          );
          assert.equal(
            error instanceof AdminDashboardRequestError,
            family.name === 'activity' || family.name === 'backfill'
          );
          return true;
        });
        const cleared = status === 401 && family.clearsUnauthorizedSession;
        assert.equal(
          sessionStorage.getItem(sessionKey),
          cleared ? null : syntheticToken
        );
        assert.equal(
          sessionStorage.getItem(selectionKey),
          cleared ? null : 'synthetic-selection'
        );
        assert.equal(service.sessionGeneration(), cleared ? 1 : 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('malformed error responses keep the existing fallback without replaying requests', async (t) => {
  for (const family of families) {
    await t.test(family.name, async (t) => {
      const { service } = serviceFixture(t);
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('not JSON', { status: 503 })
      );
      await assert.rejects(family.write(service), { message: family.fallback });
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(service.sessionGeneration(), 0);
    });
  }
});

test('missing or expired sessions send no bearer token and never exchange a root token', async (t) => {
  for (const family of families) {
    for (const expired of [false, true]) {
      await t.test(
        `${family.name}: ${expired ? 'expired' : 'absent'}`,
        async (t) => {
          const { service, sessionStorage } = serviceFixture(t);
          if (expired) {
            sessionStorage.setItem(expiryKey, '2000-01-01T00:00:00.000Z');
          } else {
            sessionStorage.removeItem(sessionKey);
          }
          const requests = [];
          t.mock.method(globalThis, 'fetch', async (url, options) => {
            requests.push({ url, options });
            return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
          });
          await assert.rejects(family.read(service));
          assert.equal(requests.length, 1);
          assert.equal(requests[0].url, baseUrl + family.readPath);
          assert.equal(requests[0].options.headers.Authorization, undefined);
          assert.equal(sessionStorage.getItem(sessionKey), null);
          assert.equal(sessionStorage.getItem(selectionKey), null);
        }
      );
    }
  }
});

test('admin request timeout propagates once without retrying or clearing a valid session', async (t) => {
  for (const family of families.filter((item) => item.timeout !== undefined)) {
    await t.test(family.name, async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      const timeout = new DOMException('Synthetic timeout', 'TimeoutError');
      t.mock.method(AbortSignal, 'timeout', (delay) => {
        assert.equal(delay, family.timeout);
        const controller = new AbortController();
        queueMicrotask(() => controller.abort(timeout));
        return controller.signal;
      });
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (_url, options) => {
          options.signal.throwIfAborted();
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => reject(options.signal.reason),
              { once: true }
            );
          });
        }
      );
      await assert.rejects(family.write(service), (error) => error === timeout);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(sessionStorage.getItem(sessionKey), syntheticToken);
      assert.equal(service.sessionGeneration(), 0);
    });
  }
});

const informationRequest = {
  contributionId: 'synthetic-contribution',
  contextVersion: 'synthetic-version',
  recipient: 'sponsor@example.test',
  subject: 'Synthetic information request',
  body: 'Synthetic message',
  confirmed: true
};
const accessRequest = {
  contributionId: 'synthetic-contribution',
  recipient: 'sponsor@example.test',
  requestId: 'synthetic-request',
  confirmed: true,
  locale: 'fr-CA'
};
const queryRequest = {
  sponsorshipId: 'synthetic-contribution',
  message: 'Synthetic question'
};
const prepareRequest = {
  language: 'fr-CA',
  type: 'admin_note',
  reference: 'synthetic-contribution'
};
const interventionRequest = {
  contributionId: 'synthetic-contribution',
  requestId: 'synthetic-request',
  kind: 'internal',
  note: 'Synthetic note',
  nextReviewOn: null
};
const dossierRequests = [
  {
    name: 'assistant summary',
    invoke: (service, token) => service.getAssistantSummary(token),
    path: '/admin/assistant/summary',
    method: 'GET',
    summaryError: true
  },
  {
    name: 'assistant context',
    invoke: (service, token) => service.getAssistantContext(token, 'sponsor /'),
    path: '/admin/assistant/context?sponsorshipId=sponsor+%2F',
    cache: 'no-store'
  },
  {
    name: 'information request',
    invoke: (service, token) =>
      service.requestSponsorshipInformation(token, informationRequest),
    path: '/admin/sponsorships/request-information',
    method: 'POST',
    cache: 'no-store',
    body: informationRequest
  },
  {
    name: 'access recipient',
    invoke: (service, token) =>
      service.getSponsorshipAccessRecipient(token, 'sponsor /'),
    path: '/admin/sponsorships/followup-access?contributionId=sponsor+%2F',
    cache: 'no-store'
  },
  {
    name: 'access resend',
    invoke: (service, token) =>
      service.resendSponsorshipAccess(token, accessRequest),
    path: '/admin/sponsorships/followup-access',
    method: 'POST',
    body: accessRequest
  },
  {
    name: 'assistant query',
    invoke: (service, token) => service.queryAssistant(token, queryRequest),
    path: '/admin/assistant/query',
    method: 'POST',
    body: queryRequest
  },
  {
    name: 'assistant draft',
    invoke: (service, token) =>
      service.prepareAssistantDraft(token, prepareRequest),
    path: '/admin/assistant/prepare',
    method: 'POST',
    body: prepareRequest
  },
  {
    name: 'dossier progress',
    invoke: (service, token) =>
      service.getSponsorshipProgress(token, 'sponsor /'),
    path: '/admin/sponsorships/progress?sponsorshipId=sponsor+%2F',
    cache: 'no-store'
  },
  {
    name: 'intervention history',
    invoke: (service, token) =>
      service.getSponsorshipInterventions(token, 'sponsor /', 'cursor /'),
    path: '/admin/sponsorships/interventions?sponsorshipId=sponsor+%2F&before=cursor+%2F',
    cache: 'no-store'
  },
  {
    name: 'record intervention',
    invoke: (service, token) =>
      service.recordSponsorshipIntervention(token, interventionRequest),
    path: '/admin/sponsorships/interventions',
    method: 'POST',
    body: interventionRequest
  }
];
const explicitToken = 'openg7-admin-session.explicit-synthetic';
const summaryFallback = 'Admin assistant summary could not be loaded.';

test('assistant and dossier calls preserve explicit bearer/cookie authentication and each transport policy', async (t) => {
  for (const request of dossierRequests) {
    for (const token of [explicitToken, cookieMarker]) {
      await t.test(
        `${request.name}: ${token === cookieMarker ? 'cookie' : 'explicit bearer'}`,
        async (t) => {
          const { service } = serviceFixture(t);
          t.mock.method(AbortSignal, 'timeout', () =>
            assert.fail('this endpoint has no client timeout')
          );
          const payload = { synthetic: true };
          const fetchMock = t.mock.method(
            globalThis,
            'fetch',
            async (url, options) => {
              assert.equal(url, baseUrl + request.path);
              assert.equal(options.method, request.method);
              assert.equal(options.cache, request.cache);
              assert.equal(options.signal, undefined);
              assert.equal(options.credentials, undefined);
              assert.deepEqual(options.headers, {
                Accept: 'application/json',
                ...(token === cookieMarker
                  ? {}
                  : { Authorization: `Bearer ${explicitToken}` }),
                ...(request.body ? { 'Content-Type': 'application/json' } : {})
              });
              assert.equal(
                options.body,
                request.body ? JSON.stringify(request.body) : undefined
              );
              return Response.json(payload);
            }
          );
          assert.deepEqual(await request.invoke(service, token), payload);
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('assistant and dossier failures keep their error types and leave explicit sessions intact', async (t) => {
  for (const request of dossierRequests) {
    for (const status of [401, 403, 409, 503]) {
      await t.test(`${request.name}: ${status}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json(
            {
              message: 'Synthetic server message',
              error: 'Secondary message',
              code: 'IGNORED_CODE'
            },
            { status }
          )
        );
        await assert.rejects(
          request.invoke(service, explicitToken),
          (error) => {
            assert.equal(
              error instanceof AdminDashboardRequestError,
              !request.summaryError
            );
            assert.equal(
              error.status,
              request.summaryError ? undefined : status
            );
            assert.equal(
              error.message,
              request.summaryError
                ? 'Synthetic server message'
                : 'Admin dashboard could not be loaded.'
            );
            assert.equal(error.code, undefined);
            return true;
          }
        );
        assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
        assert.equal(
          sessionStorage.getItem(selectionKey),
          'synthetic-selection'
        );
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('assistant summary retains error/message priority and malformed-response fallback', async (t) => {
  for (const [name, response, expected] of [
    [
      'error string',
      () =>
        Response.json(
          { message: 1, error: 'Synthetic error' },
          { status: 503 }
        ),
      'Synthetic error'
    ],
    [
      'unknown fields',
      () => Response.json({ code: 'IGNORED_CODE' }, { status: 503 }),
      summaryFallback
    ],
    [
      'malformed JSON',
      () => new Response('not JSON', { status: 503 }),
      summaryFallback
    ]
  ]) {
    await t.test(name, async (t) => {
      const { service } = serviceFixture(t);
      t.mock.method(globalThis, 'fetch', async () => response());
      await assert.rejects(service.getAssistantSummary(explicitToken), {
        message: expected
      });
    });
  }
});

test('assistant and dossier calls propagate malformed success JSON and network errors without retry', async (t) => {
  for (const request of dossierRequests) {
    for (const networkFailure of [false, true]) {
      await t.test(
        `${request.name}: ${networkFailure ? 'network failure' : 'malformed success'}`,
        async (t) => {
          const { service } = serviceFixture(t);
          const failure = new TypeError('Synthetic network failure');
          const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
            if (networkFailure) throw failure;
            return new Response('not JSON', { status: 200 });
          });
          await assert.rejects(
            request.invoke(service, explicitToken),
            (error) =>
              networkFailure ? error === failure : error instanceof SyntaxError
          );
          assert.equal(fetchMock.mock.callCount(), 1);
          assert.equal(service.sessionGeneration(), 0);
        }
      );
    }
  }
});

test('explicit empty authentication neither falls back to a saved token nor creates another session', async (t) => {
  for (const request of dossierRequests) {
    await t.test(request.name, async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (url, options) => {
          assert.equal(url, baseUrl + request.path);
          assert.equal(options.headers.Authorization, undefined);
          return Response.json(
            { message: 'Synthetic unauthorized' },
            { status: 401 }
          );
        }
      );
      await assert.rejects(request.invoke(service, ''));
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(sessionStorage.getItem(sessionKey), syntheticToken);
      assert.equal(service.sessionGeneration(), 0);
    });
  }
});

test('assistant and dossier transport remains usable during SSR without browser storage', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  delete globalThis.window;
  t.after(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
  });
  const service = new FundingAdminService();
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith('/api/admin/'));
    assert.equal(options.headers.Authorization, `Bearer ${explicitToken}`);
    return Response.json({ synthetic: true });
  });
  for (const request of dossierRequests) {
    assert.deepEqual(await request.invoke(service, explicitToken), {
      synthetic: true
    });
  }
  assert.equal(fetchMock.mock.callCount(), dossierRequests.length);
});

const syntheticIdentity = {
  id: 'synthetic-account',
  sessionId: 'synthetic-session',
  displayName: 'Synthetic owner',
  role: 'owner',
  expiresAt: new Date(Date.now() + 60000).toISOString()
};
const syntheticQueue = { available: true, items: [] };

test('token sign-in preserves its exchange and clears private data only after a successful save', async (t) => {
  for (const success of [true, false]) {
    await t.test(
      success ? 'successful exchange' : 'refused exchange',
      async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        service.identity.set(syntheticIdentity);
        service.workQueue.set(syntheticQueue);
        const session = {
          sessionToken: explicitToken,
          expiresAt: syntheticIdentity.expiresAt,
          ttlSeconds: 60
        };
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async (url, options) => {
            assert.equal(url, baseUrl + '/admin/session');
            assert.deepEqual(options, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ token: ' synthetic-root-token ' })
            });
            return Response.json(session, { status: success ? 200 : 503 });
          }
        );

        if (success) {
          assert.deepEqual(
            await service.signIn(' synthetic-root-token '),
            session
          );
          assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
          assert.equal(sessionStorage.getItem(expiryKey), session.expiresAt);
          assert.equal(sessionStorage.getItem(selectionKey), null);
          assert.equal(service.workQueue(), null);
        } else {
          await assert.rejects(service.signIn(' synthetic-root-token '), {
            message: 'Admin session could not be created.'
          });
          assert.equal(sessionStorage.getItem(sessionKey), syntheticToken);
          assert.equal(
            sessionStorage.getItem(selectionKey),
            'synthetic-selection'
          );
          assert.equal(service.workQueue(), syntheticQueue);
        }
        assert.equal(service.identity(), null);
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      }
    );
  }
});

test('root-token requests reuse a valid saved session and exchange expired sessions once', async (t) => {
  for (const expired of [false, true]) {
    await t.test(expired ? 'expired session' : 'valid session', async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      if (expired)
        sessionStorage.setItem(expiryKey, '2000-01-01T00:00:00.000Z');
      window.sessionStorage.setItem(
        'openg7-admin-token',
        'synthetic-legacy-token'
      );
      window.localStorage.setItem(
        'openg7-admin-token',
        'synthetic-legacy-token'
      );
      const paths = [];
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        paths.push(url.slice(baseUrl.length));
        if (url.endsWith('/admin/session')) {
          assert.equal(
            options.body,
            JSON.stringify({ token: 'synthetic-root-token' })
          );
          assert.equal(options.headers.Authorization, undefined);
          return Response.json({
            sessionToken: explicitToken,
            expiresAt: syntheticIdentity.expiresAt,
            ttlSeconds: 60
          });
        }
        assert.equal(url, baseUrl + '/admin/dashboard');
        assert.equal(
          options.headers.Authorization,
          `Bearer ${expired ? explicitToken : syntheticToken}`
        );
        return Response.json({ synthetic: true });
      });

      await service.getDashboard(' synthetic-root-token ');
      await service.getDashboard(' synthetic-root-token ');
      assert.deepEqual(paths, [
        ...(expired ? ['/admin/session'] : []),
        '/admin/dashboard',
        '/admin/dashboard'
      ]);
      assert.equal(service.sessionGeneration(), expired ? 1 : 0);
      assert.equal(window.sessionStorage.getItem('openg7-admin-token'), null);
      assert.equal(window.localStorage.getItem('openg7-admin-token'), null);
    });
  }
});

test('cookie restoration and sign-out preserve their authentication and failure policies', async (t) => {
  const { service, sessionStorage } = serviceFixture(t, cookieMarker);
  service.workQueue.set(syntheticQueue);
  let refuseLogout = true;
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    paths.push(url.slice(baseUrl.length));
    if (url.endsWith('/admin/auth/current')) {
      assert.deepEqual(options, { cache: 'no-store' });
      return Response.json(syntheticIdentity);
    }
    assert.equal(url, baseUrl + '/admin/auth/logout');
    assert.deepEqual(options, { method: 'POST' });
    return new Response(null, { status: refuseLogout ? 503 : 204 });
  });

  assert.equal(await service.restoreSession(), true);
  assert.deepEqual(service.identity(), syntheticIdentity);
  assert.equal(sessionStorage.getItem(expiryKey), syntheticIdentity.expiresAt);
  await assert.rejects(service.signOut(), { message: 'Sign-out unavailable.' });
  assert.deepEqual(service.identity(), syntheticIdentity);
  assert.equal(sessionStorage.getItem(sessionKey), cookieMarker);
  assert.equal(service.workQueue(), syntheticQueue);
  assert.equal(service.sessionGeneration(), 0);

  refuseLogout = false;
  await service.signOut();
  assert.deepEqual(paths, [
    '/admin/auth/current',
    '/admin/auth/logout',
    '/admin/auth/logout'
  ]);
  assert.equal(service.identity(), null);
  assert.equal(service.workQueue(), null);
  assert.equal(sessionStorage.getItem(sessionKey), null);
  assert.equal(sessionStorage.getItem(selectionKey), null);
  assert.equal(service.sessionGeneration(), 1);
});

test('session restoration skips bearer requests and clears private state on cookie failures', async (t) => {
  for (const failure of [null, 'refused', 'network', 'malformed']) {
    await t.test(failure ?? 'saved bearer', async (t) => {
      const { service, sessionStorage } = serviceFixture(
        t,
        failure ? cookieMarker : syntheticToken
      );
      service.identity.set(syntheticIdentity);
      service.workQueue.set(syntheticQueue);
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
        if (failure === 'network')
          throw new TypeError('Synthetic network failure');
        if (failure === 'malformed') return new Response('not JSON');
        return new Response(null, { status: 503 });
      });
      assert.equal(await service.restoreSession(), !failure);
      assert.equal(fetchMock.mock.callCount(), failure ? 1 : 0);
      assert.equal(service.sessionGeneration(), failure ? 1 : 0);
      assert.equal(service.identity(), failure ? null : syntheticIdentity);
      assert.equal(service.workQueue(), failure ? null : syntheticQueue);
      assert.equal(
        sessionStorage.getItem(sessionKey),
        failure ? null : syntheticToken
      );
    });
  }
});

test('clearing a session prevents an in-flight work queue from restoring private state', async (t) => {
  const { service, sessionStorage } = serviceFixture(t);
  service.identity.set(syntheticIdentity);
  service.workQueue.set(syntheticQueue);
  let finishRequest;
  let requestStarted;
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, baseUrl + '/admin/attention?pageSize=1');
    assert.equal(options.headers.Authorization, `Bearer ${syntheticToken}`);
    requestStarted();
    return new Promise((resolve) => {
      finishRequest = resolve;
    });
  });

  const pending = service.getWorkQueue(syntheticToken, { pageSize: 1 });
  await started;
  service.clearAdminSession();
  finishRequest(Response.json(syntheticQueue));
  assert.deepEqual(await pending, syntheticQueue);
  assert.equal(service.workQueue(), null);
  assert.equal(service.identity(), null);
  assert.equal(service.sessionGeneration(), 1);
  assert.equal(sessionStorage.getItem(sessionKey), null);
});

test('access, setup and email-test failures preserve shared status errors and session invalidation', async (t) => {
  const reads = [
    (service) => service.accessAccounts(),
    (service) =>
      service.updateAccess({
        sessionId: 'synthetic-session',
        confirmation: 'synthetic-session'
      }),
    (service) => service.getSetupStatus(syntheticToken),
    (service) =>
      service.sendEmailTest(syntheticToken, {
        recipient: 'owner@example.test'
      }),
    (service) => service.getEmailTest(syntheticToken, 'synthetic-request')
  ];
  for (const [index, invoke] of reads.entries()) {
    for (const status of [401, 403, 409, 503]) {
      await t.test(`endpoint ${index}: ${status}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json({ code: 'SYNTHETIC_ACCESS_FAILURE' }, { status })
        );
        await assert.rejects(invoke(service), (error) => {
          assert.ok(error instanceof AdminDashboardRequestError);
          assert.equal(error.status, status);
          assert.equal(error.message, 'SYNTHETIC_ACCESS_FAILURE');
          return true;
        });
        assert.equal(
          sessionStorage.getItem(sessionKey),
          status === 401 ? null : syntheticToken
        );
        assert.equal(service.sessionGeneration(), status === 401 ? 1 : 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('SSR session APIs avoid browser storage and restoration requests', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  delete globalThis.window;
  t.after(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
  });
  const service = new FundingAdminService();
  const fetchMock = t.mock.method(globalThis, 'fetch', () =>
    assert.fail('no restoration request during SSR')
  );
  assert.equal(service.getSavedAdminToken(), '');
  assert.equal(service.getSelectedSponsorship(), undefined);
  service.saveAdminToken(syntheticToken);
  service.selectSponsorship('synthetic-selection');
  assert.equal(await service.restoreSession(), false);
  assert.equal(
    service.identitySignInUrl('/admin/fundraiser?scope=synthetic'),
    '/api/admin/auth/start?returnUrl=%2Fadmin%2Ffundraiser%3Fscope%3Dsynthetic'
  );
  service.clearAdminSession();
  assert.equal(service.sessionGeneration(), 1);
  assert.equal(fetchMock.mock.callCount(), 0);
});
