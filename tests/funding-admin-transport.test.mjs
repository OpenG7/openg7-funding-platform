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
