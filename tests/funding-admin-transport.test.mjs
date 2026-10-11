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
const pilotCommand = {
  requestId: 'synthetic-command',
  action: 'publication.edit',
  targetId: 'synthetic-publication',
  version: 'synthetic-version',
  confirmation: 'synthetic-publication',
  payload: { message: 'Synthetic editorial revision' }
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
    pilotageError: true,
    clearsUnauthorizedSession: true
  },
  {
    name: 'editorial programme',
    read: (service) => service.pilotageProgramme(),
    readPath: '/admin/pilotage/programme',
    write: (service) => service.proposeProgramme('openg7:facebook', 3, false),
    writePath: '/admin/pilotage/programme',
    body: { feedId: 'openg7:facebook', cadence: 3, includeApproved: false },
    timeout: 15000,
    fallback: 'PILOTAGE_UNAVAILABLE',
    pilotageError: true,
    clearsUnauthorizedSession: true
  },
  {
    name: 'editorial variant and receipt',
    read: (service) => service.pilotageReceipt('receipt /'),
    readPath: '/admin/pilotage/receipt?id=receipt%20%2F',
    write: (service) => service.editorialVariant('delivery /', 2, 'Shorten'),
    writePath: '/admin/pilotage/variant',
    body: { id: 'delivery /', version: 2, instruction: 'Shorten' },
    timeout: 15000,
    fallback: 'PILOTAGE_UNAVAILABLE',
    pilotageError: true,
    clearsUnauthorizedSession: true
  },
  {
    name: 'pilotage command',
    read: (service) => service.pilotage({ id: 'decision /', page: undefined }),
    readPath: '/admin/pilotage?id=decision+%2F',
    write: (service) => service.pilotageCommand(pilotCommand),
    writePath: '/admin/pilotage/command',
    body: pilotCommand,
    timeout: 15000,
    fallback: 'PILOTAGE_UNAVAILABLE',
    pilotageError: true,
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
              : family.pilotageError && status === 401
                ? 'SESSION_EXPIRED'
                : family.pilotageError && status === 403
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
const detailsRequest = {
  contributionId: 'synthetic-contribution',
  companyName: 'Synthetic sponsor',
  publicName: 'Synthetic sponsor',
  contactName: 'Synthetic contact',
  contactEmail: 'sponsor@example.test',
  websiteUrl: 'https://sponsor.example.test',
  expectedVersion: 'synthetic-version',
  requestId: 'synthetic-request',
  reason: 'correction',
  confirmed: true
};
const explicitJsonRequests = [
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
  },
  {
    name: 'dashboard',
    invoke: (service, token) => service.getDashboard(token),
    path: '/admin/dashboard',
    method: 'GET'
  },
  ...['metrics', 'activity', 'systems'].map((block) => ({
    name: `cockpit ${block}`,
    invoke: (service, token) => service.getCockpit(block, token),
    path: `/admin/cockpit/${block}`
  })),
  {
    name: 'work queue',
    invoke: (service, token) =>
      service.getWorkQueue(token, { pageSize: 1, itemId: 'sponsor /' }),
    path: '/admin/attention?pageSize=1&itemId=sponsor+%2F',
    method: 'GET',
    cache: 'no-store'
  },
  {
    name: 'Stripe event',
    invoke: (service, token) => service.getStripeEvent(token, 'event /'),
    path: '/admin/stripe-event?eventId=event+%2F',
    cache: 'no-store'
  },
  {
    name: 'dossier details',
    invoke: (service, token) =>
      service.updateSponsorshipDetails(token, detailsRequest),
    path: '/admin/sponsorships/details',
    method: 'POST',
    body: detailsRequest
  }
];
const explicitToken = 'openg7-admin-session.explicit-synthetic';
const summaryFallback = 'Admin assistant summary could not be loaded.';

test('admin JSON endpoints preserve explicit bearer/cookie authentication and each transport policy', async (t) => {
  for (const request of explicitJsonRequests) {
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

test('admin JSON failures keep their error types and leave explicit sessions intact', async (t) => {
  for (const request of explicitJsonRequests) {
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

test('standard admin status errors preserve malformed error bodies without decoding them', async (t) => {
  for (const request of explicitJsonRequests.filter(
    (request) => !request.summaryError
  )) {
    await t.test(request.name, async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      const response = new Response('not JSON', { status: 503 });
      const jsonMock = t.mock.method(response, 'json', () =>
        assert.fail('standard status errors do not read response bodies')
      );
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async () => response
      );
      await assert.rejects(request.invoke(service, explicitToken), {
        name: 'AdminDashboardRequestError',
        status: 503,
        message: 'Admin dashboard could not be loaded.'
      });
      assert.equal(jsonMock.mock.callCount(), 0);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
      assert.equal(service.sessionGeneration(), 0);
    });
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

test('admin JSON endpoints propagate malformed success JSON and network errors without retry', async (t) => {
  for (const request of explicitJsonRequests) {
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
  for (const request of explicitJsonRequests) {
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

test('admin JSON transport remains usable during SSR without browser storage', async (t) => {
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
  for (const request of explicitJsonRequests) {
    assert.deepEqual(await request.invoke(service, explicitToken), {
      synthetic: true
    });
  }
  assert.equal(fetchMock.mock.callCount(), explicitJsonRequests.length);
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

test('work queue keeps the latest snapshot when an older request completes or fails', async (t) => {
  for (const olderFails of [false, true]) {
    await t.test(olderFails ? 'older failure' : 'older success', async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      let finishOlder;
      let failOlder;
      let olderStarted;
      const started = new Promise((resolve) => {
        olderStarted = resolve;
      });
      const latestQueue = { ...syntheticQueue, total: 2 };
      const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
        if (url.endsWith('page=1')) {
          olderStarted();
          return new Promise((resolve, reject) => {
            finishOlder = resolve;
            failOlder = reject;
          });
        }
        return Response.json(latestQueue);
      });

      const older = service.getWorkQueue(explicitToken, { page: 1 });
      await started;
      assert.deepEqual(
        await service.getWorkQueue(explicitToken, { page: 2 }),
        latestQueue
      );
      if (olderFails) {
        const failure = new TypeError('Synthetic network failure');
        failOlder(failure);
        await assert.rejects(older, (error) => error === failure);
      } else {
        finishOlder(Response.json(syntheticQueue));
        assert.deepEqual(await older, syntheticQueue);
      }
      assert.deepEqual(service.workQueue(), latestQueue);
      assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
      assert.equal(service.sessionGeneration(), 0);
      assert.equal(fetchMock.mock.callCount(), 2);
    });
  }
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

const backupRequest = {
  requestId: 'synthetic-backup',
  confirmation: 'BACKUP_DATABASE'
};
const emailTestRequest = {
  requestId: 'synthetic-email-test',
  to: 'owner@example.test'
};
const emailRetryRequest = { messageId: 'synthetic-message' };
const invoiceBackfillRequest = {
  confirmation: 'BACKFILL_INVOICES',
  contributionId: 'synthetic-contribution',
  limit: 1
};
const invoiceResendRequest = {
  invoiceId: 'synthetic-invoice',
  to: 'sponsor@example.test',
  confirmation: 'synthetic-invoice',
  requestId: 'synthetic-invoice-resend'
};
const creditNoteResendRequest = {
  creditNoteId: 'synthetic-credit-note',
  to: 'sponsor@example.test',
  confirmation: 'synthetic-credit-note',
  requestId: 'synthetic-credit-note-resend'
};
const operationalRequests = [
  {
    name: 'backup status',
    savedAuth: true,
    invoke: (service) => service.databaseBackups('backup /'),
    path: '/admin/backups?requestId=backup%20%2F',
    method: 'GET',
    errorKind: 'backup',
    fallback: 'Database backup request failed.',
    clearsUnauthorizedSession: true
  },
  {
    name: 'backup request',
    savedAuth: true,
    invoke: (service) => service.databaseBackups(undefined, backupRequest),
    path: '/admin/backups',
    method: 'POST',
    body: backupRequest,
    errorKind: 'backup',
    fallback: 'Database backup request failed.',
    clearsUnauthorizedSession: true
  },
  {
    name: 'setup status',
    invoke: (service, token) => service.getSetupStatus(token),
    path: '/admin/setup-status',
    method: 'GET',
    errorKind: 'access',
    fallback: 'ACCESS_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'email test send',
    invoke: (service, token) => service.sendEmailTest(token, emailTestRequest),
    path: '/admin/email/test',
    method: 'POST',
    body: emailTestRequest,
    errorKind: 'access',
    fallback: 'ACCESS_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'email test status',
    invoke: (service, token) => service.getEmailTest(token, 'request /'),
    path: '/admin/email/test?requestId=request%20%2F',
    errorKind: 'access',
    fallback: 'ACCESS_UNAVAILABLE',
    clearsUnauthorizedSession: true
  },
  {
    name: 'email queue',
    invoke: (service, token) => service.getEmailQueue(token, 'message /'),
    path: '/admin/email-queue?messageId=message%20%2F',
    method: 'GET',
    fallback: 'Admin email queue could not be loaded.'
  },
  {
    name: 'email retry',
    invoke: (service, token) =>
      service.retryEmailQueueMessage(token, emailRetryRequest),
    path: '/admin/email-queue/retry',
    method: 'POST',
    body: emailRetryRequest,
    fallback: 'Email queue message could not be retried.'
  },
  {
    name: 'invoices',
    invoke: (service, token) =>
      service.getSponsorshipInvoices(token, 'sponsor /'),
    path: '/admin/sponsorship-invoices?contributionId=sponsor%20%2F',
    method: 'GET',
    errorKind: 'status',
    fallback: 'Admin sponsorship invoices could not be loaded.'
  },
  {
    name: 'invoice backfill',
    invoke: (service, token) =>
      service.backfillSponsorshipInvoices(token, invoiceBackfillRequest),
    path: '/admin/sponsorship-invoices/backfill',
    method: 'POST',
    body: invoiceBackfillRequest,
    fallback: 'Sponsorship invoices could not be backfilled.'
  },
  {
    name: 'invoice resend',
    invoke: (service, token) =>
      service.resendSponsorshipInvoice(token, invoiceResendRequest),
    path: '/admin/sponsorship-invoices/resend',
    method: 'POST',
    body: invoiceResendRequest,
    fallback: 'Sponsorship invoice could not be resent.'
  },
  {
    name: 'invoice PDF',
    invoke: (service, token) =>
      service.getSponsorshipInvoicePdf(token, 'invoice /'),
    path: '/admin/sponsorship-invoices/pdf?invoiceId=invoice+%2F',
    method: 'GET',
    pdf: true,
    errorKind: 'status',
    fallback: 'Sponsorship invoice PDF could not be downloaded.'
  },
  {
    name: 'credit-note resend',
    invoke: (service, token) =>
      service.resendSponsorshipCreditNote(token, creditNoteResendRequest),
    path: '/admin/sponsorship-credit-notes/resend',
    method: 'POST',
    body: creditNoteResendRequest,
    fallback: 'Sponsorship credit note could not be resent.'
  },
  {
    name: 'credit-note PDF',
    invoke: (service, token) =>
      service.getSponsorshipCreditNotePdf(token, 'credit /'),
    path: '/admin/sponsorship-credit-notes/pdf?creditNoteId=credit+%2F',
    method: 'GET',
    pdf: true,
    fallback: 'Sponsorship credit note PDF could not be downloaded.'
  }
];

test('operational transport preserves saved/explicit auth, queries, methods, payloads and PDF bytes', async (t) => {
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 0, 255]);
  for (const request of operationalRequests) {
    for (const token of [explicitToken, cookieMarker]) {
      await t.test(`${request.name}: ${token}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(
          t,
          request.savedAuth ? token : syntheticToken
        );
        t.mock.method(AbortSignal, 'timeout', () =>
          assert.fail('this endpoint has no client timeout')
        );
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async (url, options) => {
            assert.equal(url, baseUrl + request.path);
            assert.equal(options.method, request.method);
            assert.equal(options.cache, undefined);
            assert.equal(options.signal, undefined);
            assert.equal(options.credentials, undefined);
            assert.deepEqual(options.headers, {
              Accept: request.pdf ? 'application/pdf' : 'application/json',
              ...(token === cookieMarker
                ? {}
                : { Authorization: `Bearer ${token}` }),
              ...(request.body ? { 'Content-Type': 'application/json' } : {})
            });
            assert.equal(
              options.body,
              request.body ? JSON.stringify(request.body) : undefined
            );
            const response = request.pdf
              ? new Response(pdfBytes, {
                  headers: { 'Content-Type': 'application/pdf' }
                })
              : Response.json({ synthetic: true });
            if (request.pdf)
              t.mock.method(response, 'json', () =>
                assert.fail('PDF bytes are not JSON')
              );
            return response;
          }
        );
        const result = await request.invoke(service, token);
        if (request.pdf) {
          assert.ok(result instanceof Blob);
          assert.equal(result.type, 'application/pdf');
          assert.deepEqual(
            new Uint8Array(await result.arrayBuffer()),
            pdfBytes
          );
        } else {
          assert.deepEqual(result, { synthetic: true });
        }
        assert.equal(sessionStorage.getItem(sessionKey), token);
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('operational HTTP failures retain their error body, type and 401 invalidation policies', async (t) => {
  for (const request of operationalRequests) {
    for (const status of [401, 403, 409, 503]) {
      await t.test(`${request.name}: ${status}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        service.identity.set(syntheticIdentity);
        service.workQueue.set(syntheticQueue);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json(
            {
              message: 'Synthetic server message',
              error: 'Secondary error',
              code: 'SYNTHETIC_CODE'
            },
            { status }
          )
        );
        await assert.rejects(
          request.invoke(service, explicitToken),
          (error) => {
            assert.equal(
              error instanceof AdminDashboardRequestError,
              Boolean(request.errorKind)
            );
            assert.equal(error.status, request.errorKind ? status : undefined);
            assert.equal(
              error.message,
              request.errorKind === 'backup'
                ? request.fallback
                : request.errorKind === 'access'
                  ? 'SYNTHETIC_CODE'
                  : 'Synthetic server message'
            );
            assert.equal(
              error.code,
              request.errorKind === 'backup' ? 'SYNTHETIC_CODE' : undefined
            );
            return true;
          }
        );
        const cleared = status === 401 && request.clearsUnauthorizedSession;
        assert.equal(
          sessionStorage.getItem(sessionKey),
          cleared ? null : request.savedAuth ? syntheticToken : explicitToken
        );
        assert.equal(
          sessionStorage.getItem(selectionKey),
          cleared ? null : 'synthetic-selection'
        );
        assert.equal(service.identity(), cleared ? null : syntheticIdentity);
        assert.equal(service.workQueue(), cleared ? null : syntheticQueue);
        assert.equal(service.sessionGeneration(), cleared ? 1 : 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('operational error decoding preserves fallback and message/error/code priority without replay', async (t) => {
  for (const request of operationalRequests) {
    for (const body of [
      'not JSON',
      { code: 'SYNTHETIC_CODE' },
      { message: 1, error: 'Synthetic error' }
    ]) {
      await t.test(`${request.name}: ${JSON.stringify(body)}`, async (t) => {
        const { service } = serviceFixture(t);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          typeof body === 'string'
            ? new Response(body, { status: 503 })
            : Response.json(body, { status: 503 })
        );
        const expected =
          request.errorKind === 'backup'
            ? request.fallback
            : request.errorKind === 'access'
              ? (body.code ?? request.fallback)
              : (body.error ?? request.fallback);
        await assert.rejects(request.invoke(service, explicitToken), {
          message: expected
        });
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('operational requests propagate network and decode failures once with the session intact', async (t) => {
  for (const request of operationalRequests) {
    for (const networkFailure of [false, true]) {
      await t.test(
        `${request.name}: ${networkFailure ? 'network' : 'decode'}`,
        async (t) => {
          const { service, sessionStorage } = serviceFixture(t);
          const failure = new TypeError('Synthetic transport failure');
          const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
            if (networkFailure) throw failure;
            const response = new Response('not JSON');
            if (request.pdf)
              t.mock.method(response, 'blob', async () => {
                throw failure;
              });
            return response;
          });
          await assert.rejects(
            request.invoke(service, explicitToken),
            (error) =>
              networkFailure || request.pdf
                ? error === failure
                : error instanceof SyntaxError
          );
          assert.equal(
            sessionStorage.getItem(sessionKey),
            request.savedAuth ? syntheticToken : explicitToken
          );
          assert.equal(service.sessionGeneration(), 0);
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('operational empty auth never falls back to a saved bearer or exchanges another root token', async (t) => {
  for (const request of operationalRequests) {
    for (const expired of request.savedAuth ? [false, true] : [false]) {
      await t.test(
        `${request.name}: ${expired ? 'expired' : 'empty'}`,
        async (t) => {
          const { service, sessionStorage } = serviceFixture(t);
          if (request.savedAuth) {
            if (expired)
              sessionStorage.setItem(expiryKey, '2000-01-01T00:00:00.000Z');
            else sessionStorage.removeItem(sessionKey);
          }
          const fetchMock = t.mock.method(
            globalThis,
            'fetch',
            async (url, options) => {
              assert.equal(url, baseUrl + request.path);
              assert.equal(options.headers.Authorization, undefined);
              return request.pdf
                ? new Response('synthetic PDF')
                : Response.json({ synthetic: true });
            }
          );
          await request.invoke(service, '');
          assert.equal(
            sessionStorage.getItem(sessionKey),
            request.savedAuth ? null : syntheticToken
          );
          assert.equal(service.sessionGeneration(), request.savedAuth ? 1 : 0);
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('operational collection reads omit the optional ID query', async (t) => {
  const { service } = serviceFixture(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url.slice(baseUrl.length));
    return Response.json({ synthetic: true });
  });
  await service.databaseBackups();
  await service.getEmailQueue(explicitToken);
  await service.getSponsorshipInvoices(explicitToken);
  assert.deepEqual(requests, [
    '/admin/backups',
    '/admin/email-queue',
    '/admin/sponsorship-invoices'
  ]);
});

const remainingPayload = {
  contributionId: 'synthetic-contribution',
  expectedVersion: 'synthetic-version',
  confirmation: 'synthetic-contribution',
  requestId: 'synthetic-request',
  nested: { note: 'synthetic content', enabled: false }
};
const remainingReadRequests = [
  [
    'getContributions',
    '/contributions?contributionId=target+%2F',
    'Admin contributions could not be loaded.',
    { errorKind: 'status-default' }
  ],
  [
    'getExpenses',
    '/expenses?expenseId=target%20%2F',
    'Admin expenses could not be loaded.',
    { cache: 'no-store' }
  ],
  [
    'getTransparency',
    '/transparency',
    'Admin transparency could not be loaded.'
  ],
  [
    'getPublicationDrafts',
    '/publication-drafts?draftId=target%20%2F',
    'Admin publication drafts could not be loaded.'
  ],
  [
    'getPublicationBatches',
    '/publication-batches?batchId=target%20%2F',
    'Admin publication batches could not be loaded.'
  ],
  [
    'getPublicationSlots',
    '/publication-slots?slotId=target%20%2F',
    'Admin publication slots could not be loaded.'
  ],
  [
    'getSocialPublicationJobs',
    '/social-publication-jobs',
    'Admin social publication jobs could not be loaded.'
  ],
  [
    'getAuditLog',
    '/audit-log?entryId=target%20%2F',
    'Admin audit log could not be loaded.',
    { cache: 'no-store' }
  ],
  [
    'getSponsorLogoPreview',
    '/sponsorships/logo?contributionId=target+%2F',
    'Sponsor logo preview could not be loaded.',
    { accept: 'image/*', result: 'blob' }
  ],
  [
    'getSponsorMedia',
    '/sponsorships/media?contributionId=target+%2F',
    'Sponsor media could not be loaded.',
    { method: undefined, errorKind: 'status-message' }
  ],
  [
    'getSponsorMediaPreview',
    '/sponsorships/media/content/target%20%2F',
    'Sponsor media preview could not be loaded.',
    {
      method: undefined,
      accept: 'image/*',
      result: 'blob',
      errorKind: 'status-fixed'
    }
  ]
].map(([name, path, fallback, policy = {}]) => ({
  name,
  path: '/admin' + path,
  fallback,
  method: 'GET',
  invoke: (service, token) => service[name](token, 'target /'),
  ...policy
}));
const remainingMutationRequests = [
  ['createExpense', '/expenses', 'Admin expense could not be created.'],
  [
    'updateExpense',
    '/expenses/update',
    'Admin expense could not be updated.',
    { versionConflict: true }
  ],
  [
    'createPublicationDraft',
    '/publication-drafts',
    'Admin publication draft could not be created.'
  ],
  [
    'updatePublicationDraft',
    '/publication-drafts/update',
    'Admin publication draft could not be updated.'
  ],
  [
    'createPublicationBatch',
    '/publication-batches',
    'Admin publication batch could not be created.'
  ],
  [
    'createPublicationSlot',
    '/publication-slots',
    'Admin publication slot could not be created.'
  ],
  [
    'updatePublicationSlot',
    '/publication-slots/update',
    'Admin publication slot could not be updated.'
  ],
  [
    'assignBatchToPublicationSlot',
    '/publication-slots/assign-batch',
    'Batch could not be assigned to the publication slot.'
  ],
  [
    'assignDraftToPublicationSlot',
    '/publication-slots/assign-draft',
    'Draft could not be assigned to the publication slot.'
  ],
  [
    'publishPublicationSlot',
    '/publication-slots/publish',
    'Publication slot could not be published.'
  ],
  [
    'cancelPublicationSlot',
    '/publication-slots/cancel',
    'Publication slot could not be cancelled.'
  ],
  [
    'assignDraftToBatch',
    '/publication-batches/assign',
    'Draft could not be assigned to the publication batch.'
  ],
  [
    'unassignDraftFromBatch',
    '/publication-batches/unassign',
    'Draft could not be removed from the publication batch.'
  ],
  [
    'schedulePublicationBatch',
    '/publication-batches/schedule',
    'Publication batch could not be scheduled.'
  ],
  [
    'publishPublicationBatch',
    '/publication-batches/publish',
    'Publication batch could not be published.'
  ],
  [
    'publishSocialPublicationBatch',
    '/publication-batches/publish-social',
    'Publication batch could not be sent to the social provider.',
    { errorKind: 'message' }
  ],
  [
    'cancelPublicationBatch',
    '/publication-batches/cancel',
    'Publication batch could not be cancelled.'
  ],
  [
    'reviewSponsorMedia',
    '/sponsorships/media/review',
    'Sponsor media review could not be completed.',
    { errorKind: 'status-message' }
  ],
  [
    'deleteSponsorMedia',
    '/sponsorships/media/delete',
    'Sponsor media could not be deleted.',
    { errorKind: 'status-message' }
  ],
  [
    'reviewSponsorship',
    '/sponsorships/review',
    'Sponsorship review could not be updated.',
    { errorKind: 'status-message' }
  ],
  [
    'refundSponsorship',
    '/sponsorships/refund',
    'Sponsorship refund could not be created.',
    { errorKind: 'refund' }
  ],
  [
    'updateSponsorshipPublication',
    '/sponsorships/publication',
    'Sponsorship publication could not be updated.',
    { errorKind: 'status-message' }
  ],
  [
    'setSponsorshipWebsiteVisibility',
    '/sponsorships/website-visibility',
    'Website visibility could not be updated.',
    { errorKind: 'status-fixed', result: 'void' }
  ]
].map(([name, path, fallback, policy = {}]) => ({
  name,
  path: '/admin' + path,
  fallback,
  method: 'POST',
  body: remainingPayload,
  invoke: (service, token) => service[name](token, remainingPayload),
  ...policy
}));
const logoFile = new File(
  [new Uint8Array([0, 255, 127, 80])],
  'synthetic-logo.png',
  {
    type: 'image/png'
  }
);
const sponsorshipQuery = {
  page: 2,
  pageSize: 6,
  search: '  synthetic /  ',
  reviewStatus: 'approved',
  feedStatus: 'planned',
  paymentStatus: 'paid',
  sort: 'company',
  direction: 'desc'
};
const remainingRequests = [
  ...remainingReadRequests,
  ...remainingMutationRequests,
  {
    name: 'publicationMedia',
    savedAuth: true,
    path: '/admin/publication-automation/media',
    cache: 'no-store',
    fallback: 'AUTOMATION_UNAVAILABLE',
    invoke: (service) => service.publicationMedia()
  },
  {
    name: 'search',
    path: '/admin/search',
    method: 'POST',
    cache: 'no-store',
    body: remainingPayload,
    errorKind: 'status-default',
    fallback: 'Admin dashboard could not be loaded.',
    invoke: (service, token, signal) =>
      service.search(token, remainingPayload, signal)
  },
  {
    name: 'getContributionsCsv',
    path: '/admin/contributions.csv',
    method: 'POST',
    cache: 'no-store',
    body: remainingPayload,
    accept: 'text/csv',
    result: 'text',
    errorKind: 'status-default',
    fallback: 'Admin dashboard could not be loaded.',
    invoke: (service, token) =>
      service.getContributionsCsv(token, remainingPayload)
  },
  {
    name: 'getSponsorships',
    path: '/admin/sponsorships?page=2&pageSize=6&search=synthetic+%2F&reviewStatus=approved&feedStatus=planned&paymentStatus=paid&sort=company&direction=desc',
    method: 'GET',
    errorKind: 'status-message',
    fallback: 'Admin sponsorships could not be loaded.',
    invoke: (service, token) => service.getSponsorships(token, sponsorshipQuery)
  },
  {
    name: 'uploadSponsorLogo',
    path: '/admin/sponsorships/logo',
    method: 'POST',
    multipart: true,
    errorKind: 'status-message',
    fallback: 'Sponsor logo could not be uploaded.',
    invoke: (service, token) =>
      service.uploadSponsorLogo(token, 'target /', 'version-2', logoFile)
  },
  {
    name: 'deleteSponsorLogo',
    path: '/admin/sponsorships/logo/delete',
    method: 'POST',
    body: {
      contributionId: 'target /',
      expectedVersion: 'version-2',
      confirmation: 'target /'
    },
    errorKind: 'status-message',
    fallback: 'Sponsor logo could not be deleted.',
    invoke: (service, token) =>
      service.deleteSponsorLogo(token, 'target /', 'version-2', 'target /')
  }
];

const remainingResponse = (request) => {
  if (request.result === 'void') return new Response('deliberately not JSON');
  if (request.result === 'text') return new Response('synthetic,csv\r\n1,2');
  if (request.result === 'blob')
    return new Response(new Uint8Array([0, 255, 127, 80]));
  return Response.json({ synthetic: true });
};

test('remaining admin endpoints preserve all request policies, binary data and multipart uploads', async (t) => {
  assert.equal(remainingRequests.length, 40);
  for (const request of remainingRequests) {
    for (const token of [explicitToken, cookieMarker]) {
      await t.test(`${request.name}: ${token}`, async (t) => {
        const { service } = serviceFixture(t, token);
        const signal = new AbortController().signal;
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async (url, options) => {
            assert.equal(url, baseUrl + request.path);
            assert.equal(options.method, request.method);
            assert.equal(options.cache, request.cache);
            assert.equal(options.credentials, undefined);
            assert.equal(
              options.signal,
              request.name === 'search' ? signal : undefined
            );
            assert.deepEqual(options.headers, {
              Accept: request.accept ?? 'application/json',
              ...(token === cookieMarker
                ? {}
                : { Authorization: `Bearer ${token}` }),
              ...(request.body ? { 'Content-Type': 'application/json' } : {})
            });
            if (request.multipart) {
              assert.ok(options.body instanceof FormData);
              assert.deepEqual(
                [...options.body.keys()],
                ['contributionId', 'expectedVersion', 'logo']
              );
              assert.equal(options.body.get('contributionId'), 'target /');
              assert.equal(options.body.get('expectedVersion'), 'version-2');
              const uploaded = options.body.get('logo');
              assert.equal(uploaded.name, logoFile.name);
              assert.equal(uploaded.type, logoFile.type);
              assert.deepEqual(
                await uploaded.arrayBuffer(),
                await logoFile.arrayBuffer()
              );
            } else {
              assert.equal(
                options.body,
                request.body ? JSON.stringify(request.body) : undefined
              );
            }
            return remainingResponse(request);
          }
        );
        const result = await request.invoke(service, token, signal);
        if (request.result === 'void') assert.equal(result, undefined);
        else if (request.result === 'text')
          assert.equal(result, 'synthetic,csv\r\n1,2');
        else if (request.result === 'blob')
          assert.deepEqual(
            new Uint8Array(await result.arrayBuffer()),
            new Uint8Array([0, 255, 127, 80])
          );
        else assert.deepEqual(result, { synthetic: true });
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('remaining HTTP failures retain endpoint errors and private state without replaying mutations', async (t) => {
  for (const request of remainingRequests) {
    for (const status of [401, 403, 409, 503]) {
      await t.test(`${request.name}: ${status}`, async (t) => {
        const { service, sessionStorage } = serviceFixture(t);
        service.identity.set(syntheticIdentity);
        service.workQueue.set(syntheticQueue);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json(
            {
              message: 'Synthetic message',
              error: 'Synthetic error',
              code: 'SYNTHETIC_CODE'
            },
            { status }
          )
        );
        const expected =
          request.versionConflict && status === 409
            ? 'version_conflict'
            : request.errorKind === 'refund'
              ? 'Synthetic error'
              : request.errorKind?.endsWith('message')
                ? 'Synthetic message'
                : request.fallback;
        await assert.rejects(
          request.invoke(service, explicitToken, new AbortController().signal),
          (error) => {
            assert.equal(error.message, expected);
            assert.equal(
              error instanceof AdminDashboardRequestError,
              Boolean(
                request.errorKind?.startsWith('status') ||
                request.errorKind === 'refund'
              )
            );
            assert.equal(
              error.status,
              error instanceof AdminDashboardRequestError ? status : undefined
            );
            assert.equal(
              error.code,
              request.errorKind === 'refund' ? 'SYNTHETIC_CODE' : undefined
            );
            return true;
          }
        );
        assert.equal(
          sessionStorage.getItem(sessionKey),
          request.savedAuth ? syntheticToken : explicitToken
        );
        assert.equal(
          sessionStorage.getItem(selectionKey),
          'synthetic-selection'
        );
        assert.equal(service.identity(), syntheticIdentity);
        assert.equal(service.workQueue(), syntheticQueue);
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('remaining error decoders preserve malformed responses, error priority and refund codes', async (t) => {
  for (const request of remainingRequests) {
    for (const body of [
      'not JSON',
      { error: 'Synthetic error' },
      { message: 7, error: 'Synthetic error' },
      { code: 'SYNTHETIC_CODE' }
    ]) {
      await t.test(`${request.name}: ${JSON.stringify(body)}`, async (t) => {
        const { service } = serviceFixture(t);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          typeof body === 'string'
            ? new Response(body, { status: 503 })
            : Response.json(body, { status: 503 })
        );
        const expected =
          request.errorKind === 'refund' ||
          request.errorKind?.endsWith('message')
            ? (body.error ?? request.fallback)
            : request.fallback;
        await assert.rejects(
          request.invoke(service, explicitToken, new AbortController().signal),
          {
            message: expected,
            ...(request.errorKind === 'refund' ? { code: body.code } : {})
          }
        );
        assert.equal(service.sessionGeneration(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('remaining endpoints propagate transport and decoding failures once without invalidating the session', async (t) => {
  for (const request of remainingRequests) {
    for (const networkFailure of request.result === 'void'
      ? [true]
      : [false, true]) {
      await t.test(
        `${request.name}: ${networkFailure ? 'network' : 'decode'}`,
        async (t) => {
          const { service, sessionStorage } = serviceFixture(t);
          const failure = new TypeError('Synthetic transport failure');
          const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
            if (networkFailure) throw failure;
            const response = new Response('not JSON');
            if (request.result === 'text' || request.result === 'blob')
              t.mock.method(response, request.result, async () => {
                throw failure;
              });
            return response;
          });
          await assert.rejects(
            request.invoke(
              service,
              explicitToken,
              new AbortController().signal
            ),
            (error) =>
              networkFailure || request.result
                ? error === failure
                : error instanceof SyntaxError
          );
          assert.equal(
            sessionStorage.getItem(sessionKey),
            request.savedAuth ? syntheticToken : explicitToken
          );
          assert.equal(service.sessionGeneration(), 0);
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('remaining empty authentication sends no saved bearer and never exchanges another root token', async (t) => {
  for (const request of remainingRequests) {
    await t.test(request.name, async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      if (request.savedAuth) sessionStorage.removeItem(sessionKey);
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (url, options) => {
          assert.equal(url, baseUrl + request.path);
          assert.equal(options.headers.Authorization, undefined);
          return remainingResponse(request);
        }
      );
      await request.invoke(service, '', new AbortController().signal);
      assert.equal(
        sessionStorage.getItem(sessionKey),
        request.savedAuth ? null : syntheticToken
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('search checks cancellation after authentication and never sends an already aborted query', async (t) => {
  const { service, sessionStorage } = serviceFixture(t);
  const controller = new AbortController();
  const failure = new DOMException('Synthetic cancellation', 'AbortError');
  controller.abort(failure);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Search must not be sent');
  });
  await assert.rejects(
    service.search(explicitToken, remainingPayload, controller.signal),
    (error) => error === failure
  );
  assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
  assert.equal(service.sessionGeneration(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('search cancelled while resolving a session completes authentication without sending the query', async (t) => {
  const { service, sessionStorage } = serviceFixture(t);
  sessionStorage.setItem(expiryKey, '2000-01-01T00:00:00.000Z');
  const controller = new AbortController();
  const failure = new DOMException('Synthetic cancellation', 'AbortError');
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, baseUrl + '/admin/session');
    assert.equal(
      options.body,
      JSON.stringify({ token: 'synthetic-root-token' })
    );
    controller.abort(failure);
    return Response.json({
      sessionToken: explicitToken,
      expiresAt: new Date(Date.now() + 60000).toISOString()
    });
  });
  await assert.rejects(
    service.search('synthetic-root-token', remainingPayload, controller.signal),
    (error) => error === failure
  );
  assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('JSON encoding failures occur after authentication without sending or replaying a mutation', async (t) => {
  const { service, sessionStorage } = serviceFixture(t);
  const cyclic = {};
  cyclic.self = cyclic;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('An unencodable mutation must not be sent');
  });
  await assert.rejects(service.createExpense(explicitToken, cyclic), TypeError);
  assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
  assert.equal(service.sessionGeneration(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('remaining transport works during SSR without accessing browser storage', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  delete globalThis.window;
  t.after(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
  });
  for (const request of remainingRequests) {
    await t.test(request.name, async (t) => {
      const service = new FundingAdminService();
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (url, options) => {
          assert.equal(url, '/api' + request.path);
          assert.equal(
            options.headers.Authorization,
            request.savedAuth ? undefined : `Bearer ${explicitToken}`
          );
          return remainingResponse(request);
        }
      );
      await request.invoke(
        service,
        explicitToken,
        new AbortController().signal
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('collection queries preserve omitted IDs and default sponsorship filters', async (t) => {
  const { service } = serviceFixture(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url.slice(baseUrl.length));
    return Response.json({ synthetic: true });
  });
  await service.getContributions(explicitToken);
  await service.getExpenses(explicitToken);
  await service.getPublicationDrafts(explicitToken);
  await service.getPublicationBatches(explicitToken);
  await service.getPublicationSlots(explicitToken);
  await service.getAuditLog(explicitToken);
  await service.getAssistantContext(explicitToken);
  await service.contributionActivity();
  await service.pilotage();
  await service.getSponsorships(explicitToken);
  await service.getSponsorships(explicitToken, {
    page: 1,
    pageSize: 6,
    search: '  ',
    reviewStatus: 'all',
    feedStatus: 'all',
    paymentStatus: 'all'
  });
  assert.deepEqual(requests, [
    '/admin/contributions',
    '/admin/expenses',
    '/admin/publication-drafts',
    '/admin/publication-batches',
    '/admin/publication-slots',
    '/admin/audit-log',
    '/admin/assistant/context?',
    '/admin/contribution-activity?',
    '/admin/pilotage?',
    '/admin/sponsorships',
    '/admin/sponsorships?page=1&pageSize=6'
  ]);
});

test('publication media preserves saved authentication and encodes the optional delivery scope', async (t) => {
  for (const token of [explicitToken, cookieMarker]) {
    await t.test(token, async (t) => {
      const { service } = serviceFixture(t, token);
      const requests = [];
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push(url);
        assert.equal(options.cache, 'no-store');
        assert.equal(options.body, undefined);
        assert.deepEqual(options.headers, {
          Accept: 'application/json',
          ...(token === cookieMarker
            ? {}
            : { Authorization: `Bearer ${token}` })
        });
        return Response.json([]);
      });
      assert.deepEqual(await service.publicationMedia('delivery /?&'), []);
      assert.deepEqual(await service.publicationMedia(), []);
      assert.deepEqual(requests, [
        baseUrl +
          '/admin/publication-automation/media?deliveryId=delivery+%2F%3F%26',
        baseUrl + '/admin/publication-automation/media'
      ]);
    });
  }
});

test('sponsorship and publication requests share session expiry, cache invalidation and revocation', async (t) => {
  const { service, sessionStorage } = serviceFixture(t);
  sessionStorage.setItem(expiryKey, '2000-01-01T00:00:00.000Z');
  service.identity.set(syntheticIdentity);
  service.workQueue.set(syntheticQueue);
  const paths = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = url.slice(baseUrl.length);
    paths.push(path);
    if (path === '/admin/session') {
      assert.equal(
        options.body,
        JSON.stringify({ token: 'synthetic-root-token' })
      );
      return Response.json({
        sessionToken: explicitToken,
        expiresAt: new Date(Date.now() + 60000).toISOString()
      });
    }
    assert.equal(
      options.headers.Authorization,
      paths.length === 4 ? undefined : `Bearer ${explicitToken}`
    );
    return Response.json({ synthetic: true });
  });
  await service.getSponsorships('synthetic-root-token');
  assert.equal(service.sessionGeneration(), 1);
  assert.equal(service.identity(), null);
  assert.equal(service.workQueue(), null);
  assert.equal(sessionStorage.getItem(sessionKey), explicitToken);
  await service.publicationAutomation();
  assert.equal(service.sessionGeneration(), 1);
  await service.signOut();
  assert.equal(service.sessionGeneration(), 2);
  assert.equal(sessionStorage.getItem(sessionKey), null);
  await service.publicationMedia();
  assert.deepEqual(paths, [
    '/admin/session',
    '/admin/sponsorships',
    '/admin/publication-automation',
    '/admin/publication-automation/media'
  ]);
  assert.equal(fetchMock.mock.callCount(), 4);
});

test('operation refusals keep facade invalidation and prevent a pending queue from restoring private state', async (t) => {
  for (const operation of [
    {
      name: 'stripe backfill',
      path: '/admin/stripe-backfill',
      invoke: (service) => service.stripeBackfill(backfillPreview)
    },
    {
      name: 'database backup',
      path: '/admin/backups',
      invoke: (service) => service.databaseBackups(undefined, backupRequest)
    }
  ]) {
    await t.test(operation.name, async (t) => {
      const { service, sessionStorage } = serviceFixture(t);
      service.identity.set(syntheticIdentity);
      service.workQueue.set(syntheticQueue);
      const queueStarted = Promise.withResolvers();
      const queueResponse = Promise.withResolvers();
      const paths = [];
      const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
        const path = url.slice(baseUrl.length);
        paths.push(path);
        if (path === '/admin/attention?') {
          queueStarted.resolve();
          return queueResponse.promise;
        }
        assert.ok(path === '/admin/audit-log' || path === operation.path);
        return Response.json({ code: 'SESSION_REVOKED' }, { status: 401 });
      });
      const clearSession = service.clearAdminSession.bind(service);
      let clearCalls = 0;
      service.clearAdminSession = () => {
        clearCalls++;
        clearSession();
      };

      const pendingQueue = service.getWorkQueue(syntheticToken);
      await queueStarted.promise;
      await assert.rejects(service.getAuditLog(syntheticToken), {
        name: 'Error',
        message: 'Admin audit log could not be loaded.'
      });
      assert.equal(clearCalls, 0);
      assert.equal(service.sessionGeneration(), 0);
      assert.equal(service.identity(), syntheticIdentity);
      assert.equal(service.workQueue(), syntheticQueue);
      assert.equal(sessionStorage.getItem(sessionKey), syntheticToken);

      await assert.rejects(operation.invoke(service), (error) => {
        assert.ok(error instanceof AdminDashboardRequestError);
        assert.equal(error.status, 401);
        return true;
      });
      assert.equal(clearCalls, 1);
      assert.equal(service.sessionGeneration(), 1);
      assert.equal(service.identity(), null);
      assert.equal(service.workQueue(), null);
      assert.equal(sessionStorage.getItem(sessionKey), null);
      assert.equal(sessionStorage.getItem(selectionKey), null);

      queueResponse.resolve(Response.json(syntheticQueue));
      assert.deepEqual(await pendingQueue, syntheticQueue);
      assert.equal(service.workQueue(), null);
      assert.deepEqual(paths, [
        '/admin/attention?',
        '/admin/audit-log',
        operation.path
      ]);
      assert.equal(fetchMock.mock.callCount(), 3);
    });
  }
});
