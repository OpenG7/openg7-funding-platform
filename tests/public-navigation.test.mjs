import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { navigatePublicPageAfterNetworkChange } from './support/public-navigation.mjs';

const origin = 'http://127.0.0.1:36009';
const url = origin + '/en/fonds-des-batisseurs/transparence';
const networkError = 'net::ERR_NETWORK_CHANGED';
const moduleError = new Error('Failed to fetch dynamically imported module');
const renderError = new Error('The confirmed total is missing');
const failure = (overrides = {}) => {
  const request = {
    url: origin + '/chunk-recovery.js',
    method: 'GET',
    type: 'script',
    error: networkError,
    ...overrides
  };
  return {
    url: () => request.url,
    method: () => request.method,
    resourceType: () => request.type,
    failure: () => ({ errorText: request.error })
  };
};
const fixture = (attempts, initialUrl = url) => {
  const page = new EventEmitter();
  const navigations = [];
  const methods = [];
  let rendered = 0;
  let current;
  let currentUrl = initialUrl;
  page.url = () => currentUrl;
  const navigate = async (target, method) => {
    navigations.push(target);
    methods.push(method);
    currentUrl = target;
    current = attempts[navigations.length - 1];
    assert.ok(current, 'Navigation must not exceed the specified attempts');
    for (const request of current.failures ?? [])
      page.emit('requestfailed', request);
    if (current.gotoError) throw current.gotoError;
    return { status: () => current.status ?? 200 };
  };
  page.goto = (target) => navigate(target, 'goto');
  page.reload = () => navigate(currentUrl, 'reload');
  const assertRendered = async () => {
    rendered += 1;
    // Lazy scripts can fail after the initial HTML navigation has finished.
    for (const request of current.renderFailures ?? [])
      page.emit('requestfailed', request);
    if (current.renderUrl) currentUrl = current.renderUrl;
    if (current.renderError) throw current.renderError;
  };
  return {
    page,
    navigations,
    methods,
    rendered: () => rendered,
    navigate: (target = url, options) =>
      navigatePublicPageAfterNetworkChange(
        page,
        target,
        assertRendered,
        options
      )
  };
};

test('successful public rendering navigates once and removes its listener', async () => {
  const subject = fixture([{}]);
  const existingListener = () => {};
  subject.page.on('requestfailed', existingListener);
  const response = await subject.navigate();
  assert.equal(response.status(), 200);
  assert.deepEqual(subject.navigations, [url]);
  assert.equal(subject.rendered(), 1);
  assert.deepEqual(subject.page.listeners('requestfailed'), [existingListener]);
});

test('an interrupted lazy import repeats only the public navigation and checks rendering again', async () => {
  const subject = fixture([
    { renderFailures: [failure()], renderError: moduleError },
    {}
  ]);
  await subject.navigate();
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.rendered(), 2);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('an interrupted public document may repeat after goto itself fails', async () => {
  const subject = fixture([
    { failures: [failure({ type: 'document', url })], gotoError: moduleError },
    {}
  ]);
  await subject.navigate();
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.rendered(), 1);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a second network change propagates its failure without a third navigation', async () => {
  const secondError = new Error('Second interrupted import');
  const subject = fixture([
    { failures: [failure()], renderError: moduleError },
    { failures: [failure()], renderError: secondError }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === secondError);
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

for (const [name, request] of [
  ['no recorded request failure', null],
  [
    'a different network error',
    failure({ error: 'net::ERR_CONNECTION_RESET' })
  ],
  [
    'an API request',
    failure({ type: 'fetch', url: origin + '/api/public/fund-transparency' })
  ],
  [
    'an API URL reported as a script',
    failure({ url: origin + '/api/public/fund-transparency' })
  ],
  ['a POST request', failure({ method: 'POST' })],
  [
    'a script from another origin',
    failure({ url: 'http://127.0.0.1:36010/chunk-recovery.js' })
  ],
  [
    'another document',
    failure({ type: 'document', url: origin + '/admin/login' })
  ]
]) {
  test(`a rendering failure does not repeat for ${name}`, async () => {
    const subject = fixture([
      { failures: request ? [request] : [], renderError }
    ]);
    await assert.rejects(subject.navigate(), (error) => error === renderError);
    assert.deepEqual(subject.navigations, [url]);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}

test('a network change recorded on the first attempt cannot permit another rendering retry', async () => {
  const subject = fixture([
    { failures: [failure()], renderError: moduleError },
    { renderError }
  ]);
  await assert.rejects(subject.navigate(), (error) => error === renderError);
  assert.deepEqual(subject.navigations, [url, url]);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('HTTP 500 is never retried even when a network change was recorded', async () => {
  const subject = fixture([{ failures: [failure()], status: 500 }]);
  await assert.rejects(subject.navigate(), /did not return HTTP 200/);
  assert.deepEqual(subject.navigations, [url]);
  assert.equal(subject.rendered(), 0);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

for (const target of [
  'https://127.0.0.1:36009/en/fonds-des-batisseurs/transparence',
  'http://funding.example.test/en/fonds-des-batisseurs/transparence',
  origin + '/admin/login',
  origin + '/api/public/fund-transparency',
  origin + '/en/fonds-des-batisseurs/transparence?operation=fixture',
  origin + '/en/fonds-des-batisseurs/transparence#support',
  origin + '/fonds-des-batisseurs#checkout',
  origin + '/fonds-des-batisseurs?checkout=success#support',
  'http://fixture:password@127.0.0.1:36009/en/fonds-des-batisseurs/transparence'
]) {
  test(`navigation rejects a target outside the exact loopback public route: ${target}`, async () => {
    const subject = fixture([{}]);
    await assert.rejects(
      subject.navigate(target),
      /requires a loopback public page/
    );
    assert.deepEqual(subject.navigations, []);
    assert.equal(subject.page.listenerCount('requestfailed'), 0);
  });
}

test('the French public route also permits an interrupted document to recover once', async () => {
  const target = origin + '/fonds-des-batisseurs/transparence';
  const subject = fixture([
    {
      failures: [failure({ type: 'document', url: target })],
      gotoError: moduleError
    },
    {}
  ]);
  await subject.navigate(target);
  assert.deepEqual(subject.navigations, [target, target]);
});

for (const route of [
  '/fonds-des-batisseurs',
  '/en/fonds-des-batisseurs',
  '/fonds-des-batisseurs#support',
  '/en/fonds-des-batisseurs#support'
]) {
  test(`the public funding route permits its exact GET document to recover: ${route}`, async () => {
    const target = origin + route;
    const subject = fixture([
      {
        failures: [failure({ type: 'document', url: target.split('#')[0] })],
        gotoError: moduleError
      },
      {}
    ]);
    await subject.navigate(target);
    assert.deepEqual(subject.navigations, [target, target]);
    assert.deepEqual(subject.methods, ['goto', 'goto']);
  });
}

test('a successful reload performs one actual reload and removes its listener', async () => {
  const subject = fixture([{}]);
  await subject.navigate(url, { navigation: 'reload' });
  assert.deepEqual(subject.methods, ['reload']);
  assert.deepEqual(subject.navigations, [url]);
  assert.equal(subject.rendered(), 1);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a lazy import interrupted after reload repeats the reload once and checks rendering again', async () => {
  const target = origin + '/fonds-des-batisseurs#support';
  const subject = fixture(
    [{ renderFailures: [failure()], renderError: moduleError }, {}],
    target
  );
  await subject.navigate(target, { navigation: 'reload' });
  assert.deepEqual(subject.methods, ['reload', 'reload']);
  assert.deepEqual(subject.navigations, [target, target]);
  assert.equal(subject.rendered(), 2);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a second reload failure never causes a third reload', async () => {
  const subject = fixture([
    { renderFailures: [failure()], renderError: moduleError },
    { renderFailures: [failure()], renderError }
  ]);
  await assert.rejects(
    subject.navigate(url, { navigation: 'reload' }),
    (error) => error === renderError
  );
  assert.deepEqual(subject.methods, ['reload', 'reload']);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('reload rejects a different current page before navigating or adding a listener', async () => {
  const subject = fixture([{}], origin + '/admin/login');
  await assert.rejects(
    subject.navigate(url, { navigation: 'reload' }),
    /requires the page to remain at its target/
  );
  assert.deepEqual(subject.methods, []);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a route change on the first reload prevents a second reload even after a network change', async () => {
  const subject = fixture([
    {
      renderFailures: [failure()],
      renderUrl: origin + '/admin/login',
      renderError: moduleError
    }
  ]);
  await assert.rejects(
    subject.navigate(url, { navigation: 'reload' }),
    /requires the page to remain at its target/
  );
  assert.deepEqual(subject.methods, ['reload']);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('a reload rendering failure without the exact network change propagates immediately', async () => {
  const subject = fixture([{ renderError }]);
  await assert.rejects(
    subject.navigate(url, { navigation: 'reload' }),
    (error) => error === renderError
  );
  assert.deepEqual(subject.methods, ['reload']);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});

test('navigation rejects unsupported modes without navigating', async () => {
  const subject = fixture([{}]);
  await assert.rejects(
    subject.navigate(url, { navigation: 'click' }),
    /requires goto or reload/
  );
  assert.deepEqual(subject.methods, []);
  assert.equal(subject.page.listenerCount('requestfailed'), 0);
});
