import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAdminAuthorization } from '../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import {
  createHttpTransport,
  readBody
} from '../dist/apps/funding-api/src/http-transport.js';
import { loadPreflightRehearsalConfig } from '../dist/apps/funding-api/src/preflight/rehearsal-config.js';
import { createPreflightRehearsalHttpHandler } from '../dist/apps/funding-api/src/preflight/rehearsal-routes.js';
import { RehearsalError } from '../dist/apps/funding-api/src/preflight/rehearsal-store.js';

const origin = 'https://localhost';
const base = '/api/admin/preflight/rehearsals';
const id = (value) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const environment = {
  NODE_ENV: 'production',
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_PUBLIC_BASE_URL: origin,
  PREFLIGHT_REHEARSAL_ENABLED: 'true',
  PREFLIGHT_REHEARSAL_STORAGE_DIR: join(
    tmpdir(),
    'synthetic-rehearsal-config-only'
  ),
  PREFLIGHT_URL: 'https://preflight.openg7.test:8443',
  PREFLIGHT_TOKEN_URL:
    'https://auth.openg7.test/realms/openg7/protocol/openid-connect/token',
  PREFLIGHT_TENANT_ID: 'synthetic-tenant',
  PREFLIGHT_CLIENT_ID: 'synthetic-rehearsal-client',
  PREFLIGHT_CLIENT_SECRET: 'synthetic-rehearsal-client-secret',
  PREFLIGHT_CONSOLE_URL: 'https://localhost:8444/'
};

function run(value = 1) {
  return {
    id: id(value),
    scenario: 'standard',
    synthetic: true,
    title: 'Synthetic local dossier',
    createdAt: '2026-11-03T12:00:00.000Z',
    updatedAt: '2026-11-03T12:00:01.000Z',
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship-commitment',
      subjectId: id(value + 100),
      version: 1,
      synthetic: true
    },
    missionId: id(value + 200),
    missionStatus: 'ready',
    delivery: 'acknowledged',
    submittedAt: '2026-11-03T12:00:01.000Z',
    lastCheckedAt: null,
    receivedAt: null,
    steps: [],
    tasks: [],
    proposals: [],
    output: null,
    error: null,
    expectedSimulation: true,
    observedSimulated: null,
    terminal: false,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
}

async function fixture(t, { enabled = true, listed = [run(2), run(1)] } = {}) {
  const calls = [];
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers.cookie?.match(
      /(?:^|;\s*)synthetic-session=(reader|operator|owner|forbidden)(?:;|$)/
    )?.[1];
    return role ? { id: 'local-verification', role } : null;
  };
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity,
      permits: (request) => {
        const account = identity(request);
        return (
          account?.role !== 'forbidden' &&
          adminRoleAllows(
            account.role,
            request.method,
            new URL(request.url, origin).pathname
          )
        );
      }
    },
    isProduction: true,
    hasDatabase: false,
    adminTokenConfigured: false,
    verifyAdminSession: () => null,
    adminTokenMatches: () => false,
    writeJson: transport.writeJson
  });
  const state = { failure: null, bodyReads: 0 };
  const service = {
    async list() {
      calls.push({ method: 'list' });
      return listed;
    },
    async start(requestId, scenario, actor) {
      calls.push({ method: 'start', requestId, scenario, actor });
      if (state.failure) throw state.failure;
      return { ...run(), id: requestId, scenario };
    },
    async observe(requestId, actor) {
      calls.push({ method: 'observe', requestId, actor });
      if (state.failure) throw state.failure;
      return { ...run(), id: requestId };
    },
    async resume(requestId, actor) {
      calls.push({ method: 'resume', requestId, actor });
      if (state.failure) throw state.failure;
      return { ...run(), id: requestId };
    }
  };
  const handler = createPreflightRehearsalHttpHandler({
    publicBaseOrigin: origin,
    config: enabled
      ? loadPreflightRehearsalConfig(environment)
      : { enabled: false, consoleUrl: environment.PREFLIGHT_CONSOLE_URL },
    ensureAdminAuthorization: authorization.ensureAdminAuthorization,
    canLaunch: (request) =>
      ['operator', 'owner'].includes(identity(request)?.role),
    getAdminAuditActor: authorization.getAdminAuditActor,
    readBody: (request, maxBytes) => {
      state.bodyReads++;
      return readBody(request, maxBytes);
    },
    writeJson: transport.writeJson,
    service
  });
  const server = createServer((request, response) => {
    void handler(request, response)
      .then((handled) => {
        if (!handled)
          transport.writeJson(request, response, 404, {
            error: 'Synthetic route not found.'
          });
      })
      .catch(() => {
        transport.writeJson(request, response, 500, {
          error: 'Synthetic handler failed.'
        });
      });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    state,
    async request(
      path = base,
      { method = 'GET', role = 'reader', headers = {}, body } = {}
    ) {
      const response = await fetch(address + path, {
        method,
        headers: {
          ...(role ? { cookie: 'synthetic-session=' + role } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers
        },
        ...(body !== undefined
          ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
          : {})
      });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: text ? JSON.parse(text) : null
      };
    }
  };
}

test('rehearsal activation is explicit, independent from producer/inbox, and never reads a secret while disabled', () => {
  assert.deepEqual(
    loadPreflightRehearsalConfig({
      PREFLIGHT_ENABLED: 'true',
      PREFLIGHT_INBOX_ENABLED: 'true',
      PREFLIGHT_CLIENT_SECRET_FILE: '/synthetic/nonexistent-client-secret'
    }),
    { enabled: false, consoleUrl: null }
  );
  assert.equal(loadPreflightRehearsalConfig(environment).enabled, true);
  const configured = loadPreflightRehearsalConfig({
    ...environment,
    PREFLIGHT_ENABLED: 'false',
    PREFLIGHT_INBOX_ENABLED: 'false'
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.connection.enabled, true);
  assert.equal(configured.publicBaseOrigin, origin);
  for (const patch of [
    { PREFLIGHT_REHEARSAL_ENABLED: 'yes' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: undefined },
    { FUNDING_PUBLIC_BASE_URL: 'https://funding.example.com' },
    { FUNDING_PUBLIC_BASE_URL: 'http://localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://user:synthetic@localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost/path' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost?token=synthetic' },
    { PREFLIGHT_URL: 'https://preflight.example.com' },
    { PREFLIGHT_TOKEN_URL: 'https://identity.example.com/token' },
    { PREFLIGHT_REHEARSAL_STORAGE_DIR: 'relative-directory' },
    { PREFLIGHT_REHEARSAL_STORAGE_DIR: join(tmpdir(), 'synthetic\0invalid') }
  ])
    assert.throws(() =>
      loadPreflightRehearsalConfig({ ...environment, ...patch })
    );
  assert.equal(
    loadPreflightRehearsalConfig({
      ...environment,
      FUNDING_PLATFORM_ENV: 'test',
      FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test',
      PREFLIGHT_URL: 'https://preflight.example.test',
      PREFLIGHT_TOKEN_URL: 'https://identity.example.test/token'
    }).enabled,
    true
  );
});

test('disabled rehearsal routes expose configuration without reading the service or launching work', async (t) => {
  const http = await fixture(t, { enabled: false });
  for (const path of [base, '/admin/preflight/rehearsals']) {
    const reply = await http.request(path);
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(reply.body, {
      enabled: false,
      canLaunch: false,
      consoleUrl: environment.PREFLIGHT_CONSOLE_URL,
      run: null,
      runs: []
    });
    const post = await http.request(path, {
      method: 'POST',
      role: 'operator',
      headers: { origin },
      body: { requestId: id(1), scenario: 'standard' }
    });
    assert.equal(post.status, 409);
    assert.equal(post.body.code, 'PREFLIGHT_REHEARSAL_DISABLED');
  }
  assert.deepEqual(http.calls, []);
  assert.equal(http.state.bodyReads, 0);
});

test('missing, expired, revoked and forbidden sessions cannot read or submit rehearsal data', async (t) => {
  const http = await fixture(t);
  for (const role of [null, 'expired', 'revoked', 'forbidden']) {
    for (const method of ['GET', 'POST']) {
      const reply = await http.request(base, {
        role,
        method,
        headers: { origin },
        ...(method === 'POST'
          ? { body: { requestId: id(1), scenario: 'standard' } }
          : {})
      });
      assert.equal(reply.status, role === 'forbidden' ? 403 : 401);
      assert.match(reply.headers.get('cache-control'), /no-store/);
      assert.equal('run' in reply.body, false);
    }
  }
  assert.deepEqual(http.calls, []);
  assert.equal(http.state.bodyReads, 0);
});

test('all admin roles can observe but only operator/owner can submit or resume a rehearsal', async (t) => {
  const http = await fixture(t);
  for (const role of ['reader', 'operator', 'owner']) {
    const read = await http.request(base + '/' + id(1), { role });
    assert.equal(read.status, 200);
    assert.equal(read.body.canLaunch, role !== 'reader');
    assert.equal(read.body.run.id, id(1));
    const start = await http.request(base, {
      role,
      method: 'POST',
      headers: { origin },
      body: { requestId: id(1), scenario: 'standard' }
    });
    assert.equal(start.status, role === 'reader' ? 403 : 200);
    const resume = await http.request(base + '/' + id(1) + '/resume', {
      role,
      method: 'POST',
      headers: { origin },
      body: {}
    });
    assert.equal(resume.status, role === 'reader' ? 403 : 200);
  }
  assert.equal(http.calls.filter((call) => call.method === 'start').length, 2);
  assert.equal(http.calls.filter((call) => call.method === 'resume').length, 2);
  assert.ok(
    http.calls
      .filter((call) => ['start', 'observe', 'resume'].includes(call.method))
      .every((call) => call.actor === 'admin:local-verification')
  );
});

test('an exact configured Origin is required for POST before reading a body or calling the service', async (t) => {
  const http = await fixture(t);
  for (const requestedOrigin of [
    undefined,
    'null',
    'http://localhost',
    'https://localhost:8444',
    'https://other.example.test',
    'https://localhost/'
  ]) {
    const reply = await http.request(base, {
      role: 'owner',
      method: 'POST',
      headers: requestedOrigin ? { origin: requestedOrigin } : {},
      body: { requestId: id(1), scenario: 'standard' }
    });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.code, 'PREFLIGHT_REHEARSAL_FORBIDDEN');
    assert.equal(reply.headers.get('cache-control'), 'private, no-store');
  }
  assert.deepEqual(http.calls, []);
  assert.equal(http.state.bodyReads, 0);
});

test('GET selects the latest run or the explicit run through both aliases without start/resume side effects', async (t) => {
  const http = await fixture(t);
  for (const path of [base, '/admin/preflight/rehearsals']) {
    const latest = await http.request(path);
    assert.equal(latest.status, 200);
    assert.equal(latest.body.run.id, id(2));
    assert.deepEqual(
      latest.body.runs.map((item) => item.id),
      [id(2), id(1)]
    );
    assert.equal(latest.headers.get('cache-control'), 'private, no-store');
    const selected = await http.request(path + '/' + id(1));
    assert.equal(selected.status, 200);
    assert.equal(selected.body.run.id, id(1));
  }
  assert.equal(
    http.calls.filter((call) => call.method === 'observe').length,
    4
  );
  assert.equal(
    http.calls.filter(
      (call) => call.method === 'start' || call.method === 'resume'
    ).length,
    0
  );
  const empty = await fixture(t, { listed: [] });
  const reply = await empty.request();
  assert.equal(reply.status, 200);
  assert.equal(reply.body.run, null);
  assert.deepEqual(reply.body.runs, []);
  assert.equal(
    empty.calls.some((call) => call.method === 'observe'),
    false
  );
});

test('the rehearsal route rejects query parameters, forged scope and undeclared methods/routes', async (t) => {
  const http = await fixture(t);
  for (const query of [
    '?scenario=standard',
    '?requestId=' + id(1),
    '?tenantId=other',
    '?page=1&page=2'
  ]) {
    const reply = await http.request(base + query);
    assert.equal(reply.status, 400);
  }
  for (const scope of [
    'x-tenant-id',
    'x-preflight-tenant-id',
    'x-applications',
    'x-source-application',
    'x-roles'
  ]) {
    const reply = await http.request(base, { headers: { [scope]: 'forged' } });
    assert.equal(reply.status, 400);
  }
  for (const [path, method, allow] of [
    [base, 'PUT', 'GET, POST'],
    [base, 'DELETE', 'GET, POST'],
    [base + '/' + id(1), 'POST', 'GET'],
    [base + '/' + id(1) + '/resume', 'GET', 'POST']
  ]) {
    const reply = await http.request(path, { method, role: 'owner' });
    assert.equal(reply.status, 405);
    assert.equal(reply.headers.get('allow'), allow);
  }
  for (const path of [
    base + '/unknown',
    base + '/' + id(1) + '/unknown',
    base + '/'
  ]) {
    assert.equal((await http.request(path)).status, 404);
  }
  assert.equal((await http.request(base + '/' + '-'.repeat(36))).status, 400);
  assert.deepEqual(http.calls, []);
});

test('POST accepts only the bounded launch/resume JSON contracts and returns a consistent wrapper', async (t) => {
  const http = await fixture(t);
  const options = { method: 'POST', role: 'operator', headers: { origin } };
  const unsupported = await http.request(base, {
    ...options,
    headers: { origin, 'content-type': 'text/plain' },
    body: '{}'
  });
  assert.equal(unsupported.status, 415);
  for (const body of [
    '{',
    'null',
    '[]',
    '{}',
    { requestId: id(1) },
    { requestId: 'bad', scenario: 'standard' },
    { requestId: id(1), scenario: 'other' },
    { requestId: id(1), scenario: 'standard', tenantId: 'forged' },
    JSON.stringify({
      requestId: id(1),
      scenario: 'standard',
      text: 'x'.repeat(2200)
    })
  ]) {
    const reply = await http.request(base, { ...options, body });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.code, 'PREFLIGHT_REHEARSAL_INVALID_REQUEST');
  }
  assert.equal(
    (
      await http.request(base + '/' + id(1) + '/resume', {
        ...options,
        body: { requestId: id(2) }
      })
    ).status,
    400
  );
  assert.deepEqual(http.calls, []);
  for (const scenario of ['standard', 'missing_input']) {
    const reply = await http.request(base, {
      ...options,
      body: { requestId: id(1), scenario }
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.enabled, true);
    assert.equal(reply.body.canLaunch, true);
    assert.equal(reply.body.run.id, id(1));
    assert.equal(reply.body.run.scenario, scenario);
    assert.equal(reply.body.consoleUrl, environment.PREFLIGHT_CONSOLE_URL);
    assert.equal(reply.headers.get('cache-control'), 'private, no-store');
    assert.ok(Array.isArray(reply.body.runs));
  }
  const resumed = await http.request(base + '/' + id(1) + '/resume', {
    ...options,
    body: {}
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.run.id, id(1));
  assert.equal(http.calls.filter((call) => call.method === 'start').length, 2);
  assert.equal(http.calls.filter((call) => call.method === 'resume').length, 1);
});

test('real HTTP errors retain private no-store and expose safe codes without provider details', async (t) => {
  const http = await fixture(t);
  http.state.failure = new Error('excluded-private-provider-details');
  const unavailable = await http.request(base + '/' + id(1));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
  assert.equal(unavailable.body.code, 'PREFLIGHT_REHEARSAL_UNAVAILABLE');
  assert.equal(
    JSON.stringify(unavailable.body).includes(
      'excluded-private-provider-details'
    ),
    false
  );
  http.state.failure = new RehearsalError('PREFLIGHT_REHEARSAL_NOT_FOUND', 404);
  assert.equal((await http.request(base + '/' + id(1))).status, 404);
  http.state.failure = new RehearsalError(
    'PREFLIGHT_REHEARSAL_IDEMPOTENCY_CONFLICT',
    409
  );
  const conflict = await http.request(base, {
    method: 'POST',
    role: 'operator',
    headers: { origin },
    body: { requestId: id(1), scenario: 'missing_input' }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'PREFLIGHT_REHEARSAL_IDEMPOTENCY_CONFLICT');
});
