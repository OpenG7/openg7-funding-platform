import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminInsightsHttpHandler } from '../dist/apps/funding-api/src/admin-insights.http.js';
import { parseAdminSearch } from '../dist/apps/funding-api/src/admin-search.service.js';
import { validStripeEventId } from '../dist/apps/funding-api/src/admin-stripe-event.service.js';
import { parseWorkQueueQuery } from '../dist/apps/funding-api/src/admin-work-queue.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const fixture = ({ denied, accessDenied, failing } = {}) => {
  const calls = [];
  const failure = new Error('synthetic private database failure');
  const writeJson = (_request, response, status, payload, headers = {}) => {
    response.status = status;
    response.payload = payload;
    Object.assign(response.headers, headers);
    calls.push({ name: 'respond', value: status });
  };
  const authorize = (name, status) => (request, response) => {
    calls.push({ name });
    if (status) {
      writeJson(request, response, status, { error: 'Access rejected.' });
      return false;
    }
    return true;
  };
  const port = (name) => async (value) => {
    calls.push({ name, value });
    if (failing === name) throw failure;
    return { source: name };
  };
  const handler = createAdminInsightsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAuthorization: authorize('authorization', denied),
    ensureAdminAccess: authorize('access', denied ?? accessDenied),
    writeJson,
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    validStripeEventId,
    getAdminStripeEvent: port('event'),
    parseAdminSearch,
    searchAdmin: port('search'),
    parseWorkQueueQuery,
    getAdminWorkQueue: port('queue'),
    getCockpitMetrics: port('metrics'),
    getCockpitActivity: port('activity'),
    readCockpitSystems: port('systems'),
    getAdminDashboard: port('dashboard'),
    reportFailure: (message, error) =>
      calls.push({ name: 'report', value: { message, error } })
  });
  return {
    calls,
    failure,
    async run(
      url,
      {
        method = 'GET',
        body = '{"query":"Atelier"}',
        contentType = 'application/json; charset=utf-8'
      } = {}
    ) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: contentType ? { 'content-type': contentType } : {}
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

const routes = [
  ['stripe-event?eventId=evt_synthetic', 'event'],
  ['search', 'search', 'POST'],
  ['attention?page=2&pageSize=7', 'queue'],
  ['cockpit/metrics', 'metrics'],
  ['cockpit/activity', 'activity'],
  ['cockpit/systems', 'systems'],
  ['dashboard', 'dashboard']
];

test('admin read routes keep both aliases, exact dispatch and parsed inputs', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [path, name, method = 'GET'] of routes) {
      await t.test(prefix + path, async () => {
        const f = fixture();
        const result = await f.run(prefix + path, { method });
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, { source: name });
        assert.equal(
          f.calls[0].name,
          name === 'dashboard' ? 'access' : 'authorization'
        );
        assert.deepEqual(
          f.calls
            .filter(
              (c) =>
                !['authorization', 'access', 'body', 'respond'].includes(c.name)
            )
            .map((c) => c.name),
          [name]
        );
        const input = f.calls.find((c) => c.name === name).value;
        if (name === 'event') assert.equal(input, 'evt_synthetic');
        if (name === 'search') {
          assert.deepEqual(input, { query: 'Atelier', page: 1, pageSize: 10 });
          assert.equal(f.calls.find((c) => c.name === 'body').value, 4096);
        }
        if (name === 'queue') {
          assert.equal(input.page, 2);
          assert.equal(input.pageSize, 7);
        }
        if (name !== 'dashboard')
          assert.equal(result.headers['Cache-Control'], 'private, no-store');
      });
    }
  }
});

test('absent, expired and forbidden sessions stop before body parsing or data access', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const [path, name, method = 'GET'] of routes) {
      await t.test(`${denied} ${path}`, async () => {
        const f = fixture({ denied });
        const result = await f.run('/api/admin/' + path, {
          method,
          body: 'invalid'
        });
        assert.equal(result.handled, true);
        assert.equal(result.status, denied);
        assert.deepEqual(
          f.calls.map((c) => c.name),
          [name === 'dashboard' ? 'access' : 'authorization', 'respond']
        );
      });
    }
  }
  const f = fixture({ accessDenied: 503 });
  assert.equal((await f.run('/admin/dashboard')).status, 503);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['access', 'respond']
  );
});

test('search keeps method, content type, JSON schema and 4096-byte boundary checks', async (t) => {
  const invalid = [
    [{ method: 'GET' }, 405, 'Use POST for admin search.'],
    [{ method: 'DELETE' }, 405, 'Use POST for admin search.'],
    [{ method: 'POST', contentType: 'text/plain' }, 415, 'JSON body required.'],
    [{ method: 'POST', contentType: '' }, 415, 'JSON body required.'],
    ...[
      '{',
      'null',
      '[]',
      '{"query":"x"}',
      '{"query":"ok","pageSize":21}',
      ' '.repeat(4097)
    ].map((body) => [
      { method: 'POST', body },
      400,
      'Invalid search or pagination.'
    ])
  ];
  for (const [options, status, error] of invalid) {
    await t.test(
      `${status} ${JSON.stringify(options).slice(0, 100)}`,
      async () => {
        const f = fixture();
        const result = await f.run('/api/admin/search', options);
        assert.equal(result.status, status);
        assert.deepEqual(result.payload, { error });
        assert.equal(result.headers['Cache-Control'], 'private, no-store');
        if (status === 405) assert.equal(result.headers.Allow, 'POST');
        assert.equal(
          f.calls.some((c) => c.name === 'search'),
          false
        );
      }
    );
  }
  const f = fixture();
  const result = await f.run('/admin/search', {
    method: 'POST',
    body: '{"query":"Atelier"}'.padEnd(4096, ' '),
    contentType: 'Application/JSON ; charset=UTF-8'
  });
  assert.equal(result.status, 200);
});

test('invalid event identifiers and attention filters never reach read ports', async (t) => {
  for (const path of [
    'stripe-event',
    'stripe-event?eventId=pi_synthetic',
    'attention?page=0',
    'attention?type=unknown',
    'attention?pageSize=9999'
  ]) {
    await t.test(path, async () => {
      const f = fixture();
      const result = await f.run('/api/admin/' + path);
      assert.equal(result.status, 400);
      assert.deepEqual(
        f.calls.map((c) => c.name),
        ['authorization', 'respond']
      );
    });
  }
});

test('unavailable read ports preserve status, public errors and log policy', async (t) => {
  const errors = {
    event: [503, { error: 'Event unavailable.' }],
    search: [503, { error: 'Admin search unavailable.' }],
    queue: [502, { error: 'Admin attention queue could not be loaded.' }],
    metrics: [
      503,
      { error: 'Cockpit data unavailable.', code: 'COCKPIT_UNAVAILABLE' }
    ],
    activity: [
      503,
      { error: 'Cockpit data unavailable.', code: 'COCKPIT_UNAVAILABLE' }
    ],
    systems: [
      503,
      { error: 'Cockpit data unavailable.', code: 'COCKPIT_UNAVAILABLE' }
    ],
    dashboard: [502, { error: 'Admin dashboard could not be loaded.' }]
  };
  for (const [path, name, method = 'GET'] of routes) {
    await t.test(name, async () => {
      const f = fixture({ failing: name });
      const result = await f.run('/api/admin/' + path, { method });
      assert.equal(result.status, errors[name][0]);
      assert.deepEqual(result.payload, errors[name][1]);
      assert.equal(
        JSON.stringify(result.payload).includes(f.failure.message),
        false
      );
      const reports = f.calls.filter((c) => c.name === 'report');
      assert.equal(reports.length, name === 'dashboard' ? 1 : 0);
      if (name === 'dashboard')
        assert.deepEqual(reports[0].value, {
          message: 'Failed to load admin dashboard.',
          error: f.failure
        });
    });
  }
});

test('unowned routes, trailing paths and unowned methods fall through without side effects', async (t) => {
  for (const [path, method] of [
    ['/health', 'GET'],
    ['/admin/attention/other', 'GET'],
    ['/admin/stripe-event', 'POST'],
    ['/admin/cockpit/systems', 'POST'],
    ['/admin/dashboard', 'HEAD'],
    ['/admin/email/test', 'GET']
  ]) {
    await t.test(`${method} ${path}`, async () => {
      const f = fixture();
      const result = await f.run(path, { method });
      assert.equal(result.handled, false);
      assert.equal(result.status, undefined);
      assert.deepEqual(result.headers, {});
      assert.deepEqual(f.calls, []);
    });
  }
});
