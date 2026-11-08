import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAdminAuthorization } from '../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import { createHttpTransport } from '../dist/apps/funding-api/src/http-transport.js';
import { PreflightClient } from '../dist/apps/funding-api/src/preflight/client.js';
import { loadPreflightInboxConfig } from '../dist/apps/funding-api/src/preflight/inbox-config.js';
import { createPreflightInboxHttpHandler } from '../dist/apps/funding-api/src/preflight/inbox-routes.js';
import {
  createInboxFetch,
  createPreflightInboxReader
} from '../dist/apps/funding-api/src/preflight/inbox.js';

const id = (number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const env = {
  FUNDING_PLATFORM_ENV: 'test',
  PREFLIGHT_INBOX_ENABLED: 'true',
  PREFLIGHT_URL: 'https://preflight.example.test',
  PREFLIGHT_TENANT_ID: 'synthetic-tenant',
  PREFLIGHT_TOKEN_URL: 'https://identity.example.test/token',
  PREFLIGHT_CLIENT_ID: 'synthetic-inbox-client',
  PREFLIGHT_CLIENT_SECRET: 'synthetic-inbox-client-secret',
  PREFLIGHT_CONSOLE_URL: 'https://preflight.example.test/review',
  PREFLIGHT_REQUEST_TIMEOUT_MS: '100'
};
const proposal = () => ({
  id: id(1),
  missionId: id(2),
  tenantId: env.PREFLIGHT_TENANT_ID,
  source: {
    application: 'funding-platform',
    subjectType: 'administrative-review',
    subjectId: 'synthetic-reference',
    version: 3
  },
  status: 'prepared',
  type: 'review',
  risk: 'normal',
  version: 2,
  createdAt: '2026-11-03T12:00:00Z',
  sourceVersion: 3,
  explanations: ['Preparation ready for human review.'],
  limitations: ['Source facts need verification.'],
  blockingConditions: ['Funding retains business authority.'],
  anomalies: [],
  checks: [{ resultId: id(3), kind: 'output-check', passed: true }],
  provenance: {
    simulated: true,
    provider: 'synthetic',
    model: 'deterministic-fixture',
    internalInput: 'excluded-provenance-input'
  },
  authority: 'source_application',
  businessDecisionExecuted: false,
  input: { private: 'excluded-private-input' },
  body: 'excluded-draft-body'
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
const config = (patch) => loadPreflightInboxConfig({ ...env, ...patch });
function remote({
  item = proposal(),
  page = 1,
  pageSize = 20,
  status = 200
} = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        redirect: init.redirect,
        headers: init.headers,
        body: init.body
      });
      if (url === env.PREFLIGHT_TOKEN_URL)
        return response({
          access_token: 'synthetic-access-token',
          token_type: 'Bearer',
          expires_in: 300
        });
      return response(
        { items: item ? [item] : [], total: item ? 1 : 0, page, pageSize },
        status
      );
    }
  };
}
function http({
  configured = config(),
  read,
  role = 'reader',
  session = 'valid',
  allowed = true
} = {}) {
  let reads = 0;
  const writeJson = (_request, output, status, payload) =>
    Object.assign(output, { status, payload });
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity: () =>
        session === 'valid' ? { id: 'synthetic-admin', role } : null,
      permits: (request) =>
        allowed &&
        adminRoleAllows(
          role,
          request.method,
          new URL(request.url, env.PREFLIGHT_URL).pathname
        )
    },
    isProduction: true,
    hasDatabase: true,
    adminTokenConfigured: false,
    verifyAdminSession: () => null,
    adminTokenMatches: () => false,
    writeJson
  });
  const handler = createPreflightInboxHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    config: configured,
    ensureAdminAuthorization: authorization.ensureAdminAuthorization,
    writeJson,
    read: async (...args) => {
      reads++;
      return read
        ? read(...args)
        : { items: [], total: 0, page: args[0], pageSize: args[1] };
    }
  });
  return {
    reads: () => reads,
    invoke: async (
      url = '/api/admin/preflight/inbox',
      method = 'GET',
      headers = {}
    ) => {
      const output = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler({ url, method, headers }, output);
      return { handled, ...output };
    }
  };
}

test('inbox opt-in remains independent from durable connector activation and disabled config needs no secrets', () => {
  const disabled = loadPreflightInboxConfig({
    PREFLIGHT_ENABLED: 'true',
    PREFLIGHT_CLIENT_SECRET_FILE: '/nonexistent/synthetic-secret'
  });
  assert.deepEqual(disabled, {
    connection: { enabled: false },
    consoleUrl: null
  });
  assert.equal(config({ PREFLIGHT_ENABLED: 'false' }).connection.enabled, true);
  assert.equal(config({ PREFLIGHT_CONSOLE_URL: undefined }).consoleUrl, null);
  for (const patch of [
    { PREFLIGHT_INBOX_ENABLED: 'yes' },
    { PREFLIGHT_CONSOLE_URL: 'http://localhost:8444' },
    { PREFLIGHT_CONSOLE_URL: 'https://user:secret@example.test' },
    { PREFLIGHT_CONSOLE_URL: 'https://example.test?token=synthetic' },
    { PREFLIGHT_CONSOLE_URL: 'https://example.test#synthetic' },
    { PREFLIGHT_URL: 'http://public.example.test' },
    { PREFLIGHT_TENANT_ID: '' },
    { PREFLIGHT_REQUEST_TIMEOUT_MS: '0' },
    { NODE_ENV: 'production', PREFLIGHT_ALLOW_INSECURE_LOCAL: 'true' }
  ])
    assert.throws(() => config(patch));
});

test('backend secret files are bounded, private regular files with no ambiguous credential source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'funding-inbox-secret-'));
  const path = join(directory, 'client-secret');
  const patch = {
    PREFLIGHT_CLIENT_SECRET: undefined,
    PREFLIGHT_CLIENT_SECRET_FILE: path
  };
  try {
    writeFileSync(path, 'synthetic-file-secret\n', { mode: 0o600 });
    assert.equal(
      config(patch).connection.clientSecret,
      'synthetic-file-secret'
    );
    assert.throws(
      () => config({ PREFLIGHT_CLIENT_SECRET_FILE: path }),
      /preflight_client_secret_ambiguous/
    );
    for (const value of ['', 'a'.repeat(4097), 'synthetic\nsecond-line']) {
      writeFileSync(path, value);
      assert.throws(
        () => config(patch),
        /preflight_client_secret_file_invalid/
      );
    }
    assert.throws(
      () => config({ ...patch, PREFLIGHT_CLIENT_SECRET_FILE: directory }),
      /preflight_client_secret_file_invalid/
    );
    assert.throws(
      () =>
        config({
          ...patch,
          PREFLIGHT_CLIENT_SECRET_FILE: join(directory, 'absent')
        }),
      (error) =>
        error.message === 'preflight_client_secret_file_invalid' &&
        !error.message.includes(directory)
    );
    if (process.platform !== 'win32') {
      writeFileSync(path, 'synthetic-file-secret');
      chmodSync(path, 0o644);
      assert.throws(
        () => config(patch),
        /preflight_client_secret_file_invalid/
      );
      chmodSync(path, 0o600);
      const link = join(directory, 'link');
      symlinkSync(path, link);
      assert.throws(
        () => config({ ...patch, PREFLIGHT_CLIENT_SECRET_FILE: link }),
        /preflight_client_secret_file_invalid/
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a disabled inbox returns an explicit state without invoking the remote reader', async () => {
  const fixture = http({
    configured: loadPreflightInboxConfig({
      PREFLIGHT_CONSOLE_URL: env.PREFLIGHT_CONSOLE_URL
    })
  });
  const result = await fixture.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.payload.state, 'disabled');
  assert.equal(result.payload.consoleUrl, env.PREFLIGHT_CONSOLE_URL);
  assert.deepEqual(result.payload.items, []);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(fixture.reads(), 0);
});

test('real HTTP transport preserves the inbox private no-store policy for ready and unavailable responses', async (t) => {
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: []
  });
  let unavailable = false;
  const handler = createPreflightInboxHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    config: config(),
    ensureAdminAuthorization: () => true,
    writeJson: transport.writeJson,
    read: async (page, pageSize) => {
      if (unavailable) throw new Error('Synthetic remote outage');
      return { items: [], total: 0, page, pageSize };
    }
  });
  const server = createServer((request, output) => {
    void handler(request, output);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  for (const prefix of ['/api/admin', '/admin']) {
    for (const failed of [false, true]) {
      unavailable = failed;
      const reply = await fetch(
        `http://127.0.0.1:${port}${prefix}/preflight/inbox`
      );
      assert.equal(reply.status, failed ? 503 : 200);
      assert.equal(reply.headers.get('cache-control'), 'private, no-store');
      assert.equal(
        (await reply.json()).state,
        failed ? 'unavailable' : 'ready'
      );
    }
  }
});

test('all Funding read roles can inspect proposals; absent, expired, revoked and forbidden sessions are rejected before reading', async () => {
  for (const role of ['reader', 'operator', 'owner']) {
    const fixture = http({ role });
    assert.equal((await fixture.invoke()).status, 200);
    assert.equal(fixture.reads(), 1);
  }
  for (const session of ['absent', 'expired', 'revoked']) {
    const fixture = http({ session });
    assert.equal((await fixture.invoke()).status, 401);
    assert.equal(fixture.reads(), 0);
  }
  const forbidden = http({ allowed: false });
  assert.equal((await forbidden.invoke()).status, 403);
  assert.equal(forbidden.reads(), 0);
});

test('the inbox accepts bounded pagination only and refuses caller-supplied scope or write requests', async () => {
  const fixture = http();
  for (const query of [
    '?tenantId=other',
    '?application=openg7-social',
    '?status=obsolete',
    '?page=1&page=2',
    '?page=0',
    '?page=-1',
    '?page=100001',
    '?pageSize=101',
    '?pageSize=0',
    '?pageSize=1.5'
  ]) {
    assert.equal(
      (await fixture.invoke('/api/admin/preflight/inbox' + query)).status,
      400
    );
  }
  for (const header of [
    'x-tenant-id',
    'x-preflight-tenant-id',
    'x-applications',
    'x-source-application'
  ]) {
    assert.equal(
      (await fixture.invoke(undefined, 'GET', { [header]: 'other' })).status,
      400
    );
  }
  const owner = http({ role: 'owner' });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await fixture.invoke(undefined, method)).status, 403);
    assert.equal((await owner.invoke(undefined, method)).status, 405);
  }
  assert.equal(owner.reads(), 0);
  assert.equal(fixture.reads(), 0);
  assert.equal(
    (await fixture.invoke('/api/admin/preflight/inbox?page=2&pageSize=10'))
      .payload.page,
    2
  );
  assert.equal((await fixture.invoke('/api/admin/unknown')).handled, false);
});

test('remote inbox inspection handles generic source references and exposes allowlisted metadata without importing drafts', async () => {
  const provider = remote();
  const reader = createPreflightInboxReader(config(), provider.fetch);
  const result = await reader(1, 20);
  assert.equal(result.items[0].source.subjectId, 'synthetic-reference');
  assert.equal(result.items[0].provenance.simulated, true);
  assert.equal(result.items[0].businessDecisionExecuted, false);
  assert.equal(result.items[0].createdAt, '2026-11-03T12:00:00.000Z');
  for (const excluded of [
    'excluded-private-input',
    'excluded-draft-body',
    'excluded-provenance-input',
    'tenantId'
  ])
    assert.equal(JSON.stringify(result).includes(excluded), false);
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].body.get('grant_type'), 'client_credentials');
  assert.equal(provider.calls[1].method, 'GET');
  assert.equal(provider.calls[1].redirect, 'error');
  assert.equal(
    provider.calls[1].url,
    env.PREFLIGHT_URL +
      '/api/proposals?application=funding-platform&status=prepared&page=1&pageSize=20'
  );
  await reader(1, 20);
  assert.equal(
    provider.calls.filter((call) => call.method === 'POST').length,
    1
  );
  const durableClient = new PreflightClient(config().connection, {
    fetch: remote({ pageSize: 50 }).fetch
  });
  await assert.rejects(
    durableClient.listProposals(),
    /preflight_source_mismatch/
  );
});

test('wrong tenants/applications, forged authority, unsafe metadata and inconsistent pagination never become inbox proposals', async () => {
  const mutations = [
    (value) => {
      value.tenantId = 'other';
    },
    (value) => {
      value.source.application = 'openg7-social';
    },
    (value) => {
      value.authority = 'preflight';
    },
    (value) => {
      value.businessDecisionExecuted = true;
    },
    (value) => {
      value.sourceVersion = 4;
    },
    (value) => {
      value.status = 'obsolete';
    },
    (value) => {
      value.provenance.simulated = 'false';
    },
    (value) => {
      value.provenance.provider = '';
    },
    (value) => {
      value.createdAt = 'invalid-date';
    },
    (value) => {
      value.explanations = ['a'.repeat(2001)];
    },
    (value) => {
      value.limitations = Array(101).fill('synthetic');
    },
    (value) => {
      value.checks = [
        { resultId: id(3), kind: 'output-check', passed: 'true' }
      ];
    },
    (value) => {
      value.anomalies = [{ unsafe: 'unsupported-shape' }];
    }
  ];
  for (const mutate of mutations) {
    const item = proposal();
    mutate(item);
    const read = createPreflightInboxReader(config(), remote({ item }).fetch);
    const fixture = http({ read });
    const result = await fixture.invoke();
    assert.equal(result.status, 502);
    assert.equal(result.payload.state, 'unavailable');
    assert.equal(result.payload.code, 'PREFLIGHT_RESPONSE_INVALID');
    assert.equal('items' in result.payload, false);
  }
  await assert.rejects(
    createPreflightInboxReader(config(), remote({ page: 2 }).fetch)(1, 20),
    /preflight_response_invalid/
  );
});

test('provider failures remain explicit unavailable responses, while a successful empty remote inbox is ready', async () => {
  const read = createPreflightInboxReader(config(), async () => {
    throw new Error('excluded-provider-details');
  });
  const result = await http({ read }).invoke();
  assert.equal(result.status, 503);
  assert.equal(result.payload.state, 'unavailable');
  assert.equal(result.payload.code, 'PREFLIGHT_UNAVAILABLE');
  assert.equal('items' in result.payload, false);
  assert.equal(
    JSON.stringify(result.payload).includes('excluded-provider-details'),
    false
  );
  const empty = await http({
    read: createPreflightInboxReader(config(), remote({ item: null }).fetch)
  }).invoke();
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.state, 'ready');
  assert.deepEqual(empty.payload.items, []);
});

test('a stalled upstream request times out without turning unavailability into an empty inbox', async () => {
  const read = createPreflightInboxReader(
    config(),
    async () => new Promise(() => {})
  );
  const result = await http({ read }).invoke();
  assert.equal(result.status, 503);
  assert.equal(result.payload.state, 'unavailable');
  assert.equal('items' in result.payload, false);
});

test('inbox transport allows only proposal GET and the configured OAuth token POST', async () => {
  let calls = 0;
  const transport = createInboxFetch(config(), async () => {
    calls++;
    return response({});
  });
  for (const [url, method] of [
    [env.PREFLIGHT_URL + '/api/missions', 'POST'],
    [env.PREFLIGHT_URL + '/api/proposals', 'POST'],
    [
      env.PREFLIGHT_URL +
        '/api/proposals?application=openg7-social&status=prepared',
      'GET'
    ],
    [env.PREFLIGHT_URL + '/api/missions/' + id(1), 'GET'],
    [
      'https://other.example.test/api/proposals?application=funding-platform&status=prepared',
      'GET'
    ]
  ])
    await assert.rejects(
      transport(url, { method }),
      /preflight_inbox_write_forbidden/
    );
  await assert.rejects(
    transport(
      new Request(env.PREFLIGHT_URL + '/api/proposals', { method: 'POST' })
    ),
    /preflight_inbox_write_forbidden/
  );
  assert.equal(calls, 0);
  await transport(env.PREFLIGHT_TOKEN_URL, { method: 'POST' });
  assert.equal(calls, 1);
  const disabled = createInboxFetch(loadPreflightInboxConfig({}), async () => {
    throw new Error('must not be called');
  });
  await assert.rejects(
    disabled(env.PREFLIGHT_TOKEN_URL, { method: 'POST' }),
    /preflight_inbox_disabled/
  );
});
