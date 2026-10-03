import '@angular/compiler';
import {
  createEnvironmentInjector,
  Injector,
  runInInjectionContext
} from '@angular/core';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The root build emits workspaces under dist/, without package-local builds.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@openg7/funding-core'
      ? {
          url: new URL(
            '../dist/packages/funding-core/src/index.js',
            import.meta.url
          ).href,
          shortCircuit: true
        }
      : nextResolve(specifier, context);
  }
});
const { FundingService } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding.service.js');
workspaceHook.deregister();
const { FUNDING_PROJECT_CONFIG } =
  await import('../dist/apps/funding-web/src/app/features/funding/config/funding-project-config.token.js');

const consent = {
  contributionType: 'personal_support',
  publicDisplayConsent: false,
  publicDisplayName: 'Synthetic contributor',
  displayAmountConsent: false,
  nonCharityAcknowledged: true
};
const redirected = {
  status: 'redirected',
  checkoutId: 'synthetic-checkout',
  redirectUrl: 'https://checkout.example.test/synthetic'
};
const apiBase = 'https://funding.example.test/custom-api';

function fixture(t, href, config) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  if (href) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: new URL(href),
        __OPENG7_FUNDING_API_BASE_URL__: apiBase + '/'
      }
    });
  } else {
    delete globalThis.window;
  }
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
  });
  const injector = createEnvironmentInjector(
    config ? [{ provide: FUNDING_PROJECT_CONFIG, useValue: config }] : [],
    Injector.NULL
  );
  t.after(() => injector.destroy());
  return runInInjectionContext(injector, () => new FundingService());
}

test('Angular checkout preserves configuration, consent and localized return URLs without private return parameters', async (t) => {
  for (const prefix of ['', '/en']) {
    for (const contributionType of [
      'personal_support',
      'sponsorship_interest'
    ]) {
      await t.test(`${prefix || 'fr'} ${contributionType}`, async (t) => {
        const service = fixture(
          t,
          `https://funding.example.test${prefix}/fonds-des-batisseurs?reference=synthetic&session_id=synthetic&followup_token=synthetic&contributionType=old&keep=yes#support`,
          { projectId: 'synthetic-project' }
        );
        // Runtime configuration is captured at construction, before any request.
        window.__OPENG7_FUNDING_API_BASE_URL__ = 'https://changed.example.test';
        const requests = [];
        t.mock.method(globalThis, 'fetch', async (url, options) => {
          requests.push({ url, options });
          return Response.json(redirected);
        });
        assert.deepEqual(
          await service.startCheckout(125, { ...consent, contributionType }),
          redirected
        );
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, apiBase + '/checkout-sessions');
        const request = JSON.parse(requests[0].options.body);
        const { successUrl, cancelUrl, ...payload } = request;
        assert.deepEqual(payload, {
          amount: 125,
          currency: 'CAD',
          projectId: 'synthetic-project',
          ...consent,
          contributionType
        });
        for (const [flow, value] of [
          ['success', successUrl],
          ['cancel', cancelUrl]
        ]) {
          const url = new URL(value);
          assert.equal(url.pathname, prefix + '/fonds-des-batisseurs');
          assert.equal(url.hash, '#support');
          assert.deepEqual(Object.fromEntries(url.searchParams), {
            keep: 'yes',
            checkout: flow,
            intent:
              contributionType === 'sponsorship_interest'
                ? 'sponsorship'
                : 'personal',
            contributionType
          });
        }
      });
    }
  }
});

test('SSR checkout uses safe return URLs and refuses a simulated payment', async (t) => {
  const service = fixture(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/checkout-sessions');
    const payload = JSON.parse(options.body);
    assert.equal(payload.projectId, 'openg7');
    assert.equal(payload.successUrl, 'https://example.org/funding/success');
    assert.equal(payload.cancelUrl, 'https://example.org/funding/cancel');
    return Response.json({ ...redirected, status: 'mocked' });
  });
  await assert.rejects(service.startCheckout(25, consent), {
    message: 'Checkout could not be started.'
  });
});

test('checkout failures and mocked responses stay confined to exact local hosts', async (t) => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    'funding.example.test',
    'localhost.example.test',
    '[::1]'
  ]) {
    for (const failure of ['http', 'network', 'invalid-json', 'mocked']) {
      await t.test(`${host} ${failure}`, async (t) => {
        const service = fixture(t, `http://${host}/fonds-des-batisseurs`);
        t.mock.method(globalThis, 'fetch', async () => {
          if (failure === 'network')
            throw new TypeError('synthetic network failure');
          if (failure === 'http') return new Response(null, { status: 503 });
          if (failure === 'invalid-json') return new Response('invalid');
          return Response.json({ ...redirected, status: 'mocked' });
        });
        if (host === 'localhost' || host === '127.0.0.1') {
          const result = await service.startCheckout(25, consent);
          assert.equal(result.status, 'mocked');
          assert.equal('paymentStatus' in result, false);
          if (failure !== 'mocked')
            assert.equal(result.checkoutId, 'mock-openg7-25');
        } else {
          await assert.rejects(service.startCheckout(25, consent), {
            message: 'Checkout could not be started.'
          });
        }
      });
    }
  }
});

test('Angular reference and follow-up requests preserve caller cancellation and private preview authentication', async (t) => {
  const service = fixture(t, 'https://funding.example.test/en/support');
  const signal = new AbortController().signal;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return url.includes('/media/content/')
      ? new Response(new Blob(['synthetic-image'], { type: 'image/png' }))
      : Response.json({ accepted: true });
  });
  await service.lookupPublicReference({ reference: 'SYNTHETIC' }, signal);
  await service.requestContributionReferenceRecovery(
    { email: 'synthetic@example.test' },
    signal
  );
  await service.requestSponsorshipAccess(
    'synthetic@example.test',
    'en',
    signal
  );
  for (const request of requests) assert.equal(request.options.signal, signal);
  const token = 'synthetic/private+token';
  const preview = await service.getSponsorshipMediaPreview(token, 'asset /?');
  assert.equal(await preview.text(), 'synthetic-image');
  const request = requests.at(-1);
  assert.equal(
    request.url,
    apiBase + '/sponsorship-followup/media/content/asset%20%2F%3F'
  );
  assert.equal(request.url.includes(token), false);
  assert.equal(request.options.headers['X-Sponsorship-Followup-Token'], token);
});

test('Angular public reads and sponsor JSON operations reach their own endpoints and return server responses', async (t) => {
  const service = fixture(
    t,
    'https://funding.example.test/fonds-des-batisseurs'
  );
  const token = 'synthetic private/token';
  const draft = {
    token,
    expectedRevision: 1,
    data: { companyName: 'Synthetic' }
  };
  const details = { token, draftRevision: 1, companyName: 'Synthetic' };
  const deletion = { token, assetId: 'synthetic-asset', confirmed: true };
  const operations = [
    [() => service.getPublicFundingConfig(), '/public/funding-config'],
    [
      () => service.getSponsorshipBatchAvailability(),
      '/public/sponsorship-batches/availability'
    ],
    [
      () => service.getSponsorshipFollowup(token),
      '/sponsorship-followup?token=synthetic+private%2Ftoken'
    ],
    [
      () => service.getSponsorshipDraft(token),
      '/sponsorship-followup/draft?token=synthetic+private%2Ftoken'
    ],
    [
      () => service.saveSponsorshipDraft(draft),
      '/sponsorship-followup/draft',
      draft
    ],
    [
      () => service.submitSponsorshipFollowupDetails(details),
      '/sponsorship-followup/details',
      details
    ],
    [
      () => service.getSponsorshipMedia(token),
      '/sponsorship-followup/media?token=synthetic+private%2Ftoken'
    ],
    [
      () => service.deleteSponsorshipMedia(deletion),
      '/sponsorship-followup/media/delete',
      deletion
    ]
  ];
  let current;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests++;
    assert.equal(url, apiBase + current[1]);
    if (current[2]) assert.deepEqual(JSON.parse(options.body), current[2]);
    return Response.json({ syntheticResponse: current[1] });
  });
  for (current of operations) {
    assert.deepEqual(await current[0](), { syntheticResponse: current[1] });
  }
  assert.equal(requests, operations.length);
});

test('transport ownership leaves Angular orchestration and Blob lifecycles with their existing owners', () => {
  const root = 'apps/funding-web/src/app/features/funding/services/';
  const service = readFileSync(root + 'funding.service.ts', 'utf8');
  const publicClient = readFileSync(root + 'funding-public.client.ts', 'utf8');
  const followupClient = readFileSync(
    root + 'funding-sponsorship-followup.client.ts',
    'utf8'
  );
  assert.equal(service.includes('fetch('), false);
  assert.ok(service.includes('resolveFundingApiBaseUrl()'));
  assert.ok(service.includes("@Injectable({ providedIn: 'root' })"));
  assert.ok(service.includes('this.buildReturnUrl('));
  for (const source of [publicClient, followupClient]) {
    for (const marker of [
      '@angular/',
      'window',
      'sessionStorage',
      'createObjectURL',
      'createMockCheckoutResult'
    ]) {
      assert.equal(source.includes(marker), false, marker);
    }
  }
  for (const file of [
    'funding-admin-session.ts',
    'fund-transparency.service.ts',
    'sponsorships.service.ts',
    'stripe-setup-dev.service.ts'
  ]) {
    const source = readFileSync(root + file, 'utf8');
    assert.ok(source.includes('resolveFundingApiBaseUrl()'), file);
    assert.equal(
      source.includes('__OPENG7_FUNDING_API_BASE_URL__'),
      false,
      file
    );
  }
});
