import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFundingApiBaseUrl } from '../dist/apps/funding-web/src/app/features/funding/services/funding-api-base-url.js';
import { FundingAdminSession } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';
import { FundTransparencyService } from '../dist/apps/funding-web/src/app/features/funding/services/fund-transparency.service.js';
import { SponsorshipsService } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorships.service.js';
import { StripeSetupDevService } from '../dist/apps/funding-web/src/app/features/funding/services/stripe-setup-dev.service.js';

const configKey = '__OPENG7_FUNDING_API_BASE_URL__';
const payload = { mode: 'token', synthetic: true };

function setWindow(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  if (value === undefined) delete globalThis.window;
  else
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value
    });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
}

const consumers = [
  {
    name: 'admin authentication configuration',
    create: () =>
      new FundingAdminSession(
        () => {},
        () => {}
      ),
    invoke: (service) => service.authMode(),
    path: '/admin/auth/config',
    options: { cache: 'no-store' },
    result: 'token',
    failure: 'Authentication configuration unavailable.'
  },
  {
    name: 'public builders',
    create: () => new FundTransparencyService(),
    invoke: (service, signal) => service.getPublicBuilders(2, 6, signal),
    path: '/public/builders?page=2&pageSize=6',
    options: { headers: { Accept: 'application/json' } },
    acceptsSignal: true,
    result: payload,
    failure: 'Failed to load public builders'
  },
  {
    name: 'public transparency',
    create: () => new FundTransparencyService(),
    invoke: (service, signal) => service.getPublicTransparency(signal),
    path: '/public/fund-transparency',
    options: { method: 'GET', headers: { Accept: 'application/json' } },
    acceptsSignal: true,
    result: payload,
    failure: 'Failed to load public transparency data'
  },
  {
    name: 'public sponsorship directory',
    create: () => new SponsorshipsService(),
    invoke: (service, signal) => service.getPublicSponsorships(signal),
    path: '/public/sponsorships',
    options: { method: 'GET', headers: { Accept: 'application/json' } },
    acceptsSignal: true,
    result: payload,
    failure: 'Failed to load public sponsorship data'
  },
  {
    name: 'public sponsorship directory page',
    create: () => new SponsorshipsService(),
    invoke: (service, signal) => service.getPublicSponsorshipPage(2, 6, signal),
    path: '/public/sponsorships?page=2&pageSize=6',
    options: { method: 'GET', headers: { Accept: 'application/json' } },
    acceptsSignal: true,
    result: payload,
    failure: 'Failed to load public sponsorship data'
  },
  {
    name: 'local Stripe setup diagnostics',
    create: () => new StripeSetupDevService(),
    invoke: (service) => service.getStatus(),
    path: '/dev/stripe-setup-status',
    options: { method: 'GET', headers: { Accept: 'application/json' } },
    result: payload,
    failure: 'Failed to load Stripe setup status'
  }
];

test('API configuration defaults during SSR and when the browser override is absent', async (t) => {
  for (const browser of [
    undefined,
    {},
    { [configKey]: undefined },
    { [configKey]: null }
  ]) {
    await t.test(JSON.stringify(browser) ?? 'SSR', (t) => {
      setWindow(t, browser);
      assert.equal(resolveFundingApiBaseUrl(), '/api');
    });
  }
});

test('API configuration removes only one final slash and preserves an explicitly empty base', async (t) => {
  for (const [configured, expected] of [
    ['', ''],
    ['/', ''],
    ['//', '/'],
    ['/custom-api', '/custom-api'],
    ['/custom-api/', '/custom-api'],
    ['/custom-api///', '/custom-api//'],
    ['https://funding.example.test/api/', 'https://funding.example.test/api'],
    ['/custom-api/?version=1', '/custom-api/?version=1']
  ]) {
    await t.test(JSON.stringify(configured), (t) => {
      setWindow(t, { [configKey]: configured });
      assert.equal(resolveFundingApiBaseUrl(), expected);
    });
  }
});

test('each consumer resolves configuration once on construction and preserves its request and response', async (t) => {
  for (const consumer of consumers) {
    await t.test(consumer.name, async (t) => {
      let configured = '/first-api/';
      let reads = 0;
      setWindow(t, {
        get [configKey]() {
          reads++;
          return configured;
        }
      });
      const first = consumer.create();
      assert.equal(reads, 1);
      configured = '/second-api//';
      const second = consumer.create();
      assert.equal(reads, 2);
      const requests = [];
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, options });
        return Response.json(payload);
      });
      const signal = new AbortController().signal;

      assert.deepEqual(await consumer.invoke(first, signal), consumer.result);
      assert.deepEqual(await consumer.invoke(second, signal), consumer.result);
      assert.deepEqual(await consumer.invoke(first, signal), consumer.result);
      assert.equal(reads, 2);
      assert.deepEqual(
        requests.map(({ url }) => url),
        [
          '/first-api' + consumer.path,
          '/second-api/' + consumer.path,
          '/first-api' + consumer.path
        ]
      );
      for (const { options } of requests)
        assert.deepEqual(options, {
          ...consumer.options,
          ...(consumer.acceptsSignal ? { signal } : {})
        });
    });
  }
});

test('consumers can be constructed during SSR and honor absent or explicitly empty browser configuration', async (t) => {
  for (const [name, browser, expected] of [
    ['SSR', undefined, '/api'],
    ['absent', {}, '/api'],
    ['empty', { [configKey]: '' }, '']
  ]) {
    await t.test(name, async (t) => {
      setWindow(t, browser);
      const requests = [];
      t.mock.method(globalThis, 'fetch', async (url) => {
        requests.push(url);
        return Response.json(payload);
      });
      for (const consumer of consumers)
        assert.deepEqual(
          await consumer.invoke(consumer.create()),
          consumer.result
        );
      assert.deepEqual(
        requests,
        consumers.map((consumer) => expected + consumer.path)
      );
    });
  }
});

test('consumer HTTP failures retain their own errors without parsing or replaying requests', async (t) => {
  for (const consumer of consumers) {
    await t.test(consumer.name, async (t) => {
      setWindow(t, {});
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
        ok: false,
        status: 503,
        json: () => assert.fail('HTTP failures do not decode this response')
      }));
      await assert.rejects(consumer.invoke(consumer.create()), {
        name: 'Error',
        message: consumer.failure
      });
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('network and cancellation failures pass through each consumer without request replay', async (t) => {
  for (const consumer of consumers) {
    await t.test(consumer.name, async (t) => {
      setWindow(t, {});
      const failure = consumer.acceptsSignal
        ? new DOMException('Synthetic cancellation', 'AbortError')
        : new TypeError('Synthetic network failure');
      const signal = AbortSignal.abort(failure);
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (_url, options) => {
          if (consumer.acceptsSignal) {
            assert.equal(options.signal, signal);
            options.signal.throwIfAborted();
          }
          throw failure;
        }
      );
      await assert.rejects(
        consumer.invoke(consumer.create(), signal),
        (error) => error === failure
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});
