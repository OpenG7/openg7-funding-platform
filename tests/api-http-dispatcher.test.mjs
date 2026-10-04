import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createAdminAuthorization } from '../dist/apps/funding-api/src/admin-authorization.js';
import { AdminIdentityService } from '../dist/apps/funding-api/src/admin-identity.js';
import { createAdminSponsorshipRefundHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-refund.http.js';
import { createHttpDispatcher } from '../dist/apps/funding-api/src/http-composition/dispatcher.js';
import { createRouteMatcher } from '../dist/apps/funding-api/src/http-routing.js';

const origin = 'https://funding.example.test';
const handlerNames = [
  'handleAdminStripeBackfillRequest',
  'handleAdminPilotageRequest',
  'handleAdminContributionActivityRequest',
  'handleAdminPublicationAutomationRequest',
  'handleAdminSponsorshipMediaRequest',
  'handleSponsorshipFollowupMediaRequest',
  'handleReferenceLookupRequest',
  'handlePublicPaymentsRequest',
  'handleReferenceRecoveryRequest',
  'handleSponsorshipFollowupRequest',
  'handleAdminSponsorshipAccessRequest',
  'handleLegacySponsorshipDetailsRequest',
  'handleStripeWebhookRequest',
  'handleAdminSessionRequest',
  'handleAdminBackupsRequest',
  'handleAdminSetupRequest',
  'handleAdminEmailRequest',
  'handleAdminDocumentsRequest',
  'handlePublicSponsorMediaRequest',
  'handleAdminInsightsRequest',
  'handleAdminSponsorshipRecordsRequest',
  'handleAdminAssistantRequest',
  'handleAdminContributionsRequest',
  'handleAdminAccountingRequest',
  'handleAdminPublicationDraftsRequest',
  'handleAdminPublicationSlotsRequest',
  'handleAdminPublicationBatchesRequest',
  'handleAdminAuditRequest',
  'handleAdminSponsorshipDecisionsRequest',
  'handleAdminSponsorshipRefundRequest',
  'handlePublicFundingRequest'
];

const request = (url = '/missing', method = 'GET', headers = {}) => ({
  url,
  method,
  headers,
  [Symbol.asyncIterator]() {
    assert.fail('Dispatch must not consume the request body.');
  }
});

const fixture = (overrides = {}, handlerOverrides = {}) => {
  const calls = [];
  const writes = [];
  const transport = {
    writeOptions: (_request, response) => {
      writes.push({ kind: 'options', status: 204 });
      response.status = 204;
    },
    writeJson: (_request, response, status, payload) => {
      writes.push({ kind: 'json', status, payload });
      Object.assign(response, { status, payload });
    },
    writeText: (_request, response, status, payload) => {
      writes.push({ kind: 'text', status, payload });
      Object.assign(response, { status, payload });
    }
  };
  const context = {
    transport,
    enforceRequestRateLimit: () => {
      calls.push('quota');
      return true;
    },
    matcher: createRouteMatcher(origin),
    adminAuthMode: 'token',
    adminIdentity: null,
    handlers: {
      ...Object.fromEntries(
        handlerNames.map((name) => [
          name,
          async () => {
            calls.push(name);
            return false;
          }
        ])
      ),
      ...handlerOverrides
    },
    isProduction: false,
    readDevelopmentStatus: async () => {
      calls.push('development-status');
      return { environment: 'synthetic', databaseReachable: false };
    },
    ...overrides
  };
  return { context, calls, writes, dispatch: createHttpDispatcher(context) };
};

test('dispatcher and listener imports do not open connections, servers or workers', () => {
  const dispatcherUrl = new URL(
    '../dist/apps/funding-api/src/http-composition/dispatcher.js',
    import.meta.url
  ).href;
  const listenerUrl = new URL(
    '../dist/apps/funding-api/src/http-composition/request-listener.js',
    import.meta.url
  ).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import net from 'node:net';
       const forbid = () => { throw new Error('Unexpected resource during import'); };
       net.Server.prototype.listen = forbid;
       net.Socket.prototype.connect = forbid;
       globalThis.setInterval = forbid;
       await import(${JSON.stringify(dispatcherUrl)});
       await import(${JSON.stringify(listenerUrl)});
       console.log('imports completed');`
    ],
    { encoding: 'utf8', timeout: 5000, windowsHide: true }
  );
  assert.equal(output.trim(), 'imports completed');
});

test('OPTIONS precedes quota, JSON enforcement, identity and handlers', async () => {
  const f = fixture({
    enforceRequestRateLimit() {
      assert.fail('OPTIONS must bypass quota.');
    },
    adminIdentity: {
      resolve() {
        assert.fail('OPTIONS must bypass identity.');
      }
    }
  });
  const response = {};
  await f.dispatch(request('/api/admin/auth/config', 'OPTIONS'), response);
  assert.deepEqual(f.writes, [{ kind: 'options', status: 204 }]);
  assert.deepEqual(f.calls, []);
});

test('quota refusal precedes JSON and authentication discovery', async () => {
  for (const input of [
    request('/api/sponsorship-followup/details', 'POST'),
    request('/api/admin/auth/config')
  ]) {
    const f = fixture();
    f.context.enforceRequestRateLimit = (incoming, response) => {
      f.context.transport.writeJson(incoming, response, 429, {
        error: 'Synthetic quota refusal.'
      });
      return false;
    };
    const response = {};
    await createHttpDispatcher(f.context)(input, response);
    assert.deepEqual(response, {
      status: 429,
      payload: { error: 'Synthetic quota refusal.' }
    });
    assert.deepEqual(f.calls, []);
    assert.equal(f.writes.length, 1);
  }
});

test('only the four follow-up POST routes require JSON before dispatch or body consumption', async () => {
  for (const prefix of ['', '/api']) {
    for (const suffix of ['details', 'draft', 'recover', 'media/delete']) {
      const path = `${prefix}/sponsorship-followup/${suffix}`;
      for (const headers of [{}, { 'content-type': 'text/plain' }]) {
        const f = fixture();
        const response = {};
        await f.dispatch(request(path, 'POST', headers), response);
        assert.deepEqual(response, {
          status: 415,
          payload: {
            code: 'JSON_REQUIRED',
            error: 'Content-Type must be application/json.'
          }
        });
        assert.deepEqual(f.calls, ['quota']);
      }
      for (const [method, headers] of [
        ['GET', {}],
        ['POST', { 'content-type': ' Application/JSON ; charset=utf-8' }]
      ]) {
        const f = fixture();
        const response = {};
        await f.dispatch(request(path, method, headers), response);
        assert.equal(response.status, 404);
        assert.deepEqual(f.calls, ['quota', ...handlerNames]);
      }
    }
  }
});

test('auth mode discovery precedes identity resolution and remains GET-only', async () => {
  for (const prefix of ['', '/api']) {
    const f = fixture({
      adminAuthMode: 'oidc',
      adminIdentity: {
        async resolve() {
          throw new Error(
            'Synthetic identity outage with private diagnostics.'
          );
        },
        async handle() {
          assert.fail('Identity must not handle discovery.');
        }
      }
    });
    const discovery = {};
    await f.dispatch(
      request(`${prefix}/admin/auth/config?client=synthetic`),
      discovery
    );
    assert.deepEqual(discovery, { status: 200, payload: { mode: 'oidc' } });
    assert.deepEqual(f.calls, ['quota']);
    const post = {};
    await f.dispatch(request(`${prefix}/admin/auth/config`, 'POST'), post);
    assert.deepEqual(post, {
      status: 503,
      payload: { error: 'Identity service unavailable.' }
    });
  }
});

test('identity resolves before handling admin aliases and can finish the request', async () => {
  for (const prefix of ['', '/api']) {
    const events = [];
    const input = request(`${prefix}/admin/auth/current`);
    const response = {};
    const f = fixture({
      adminIdentity: {
        async resolve(incoming) {
          assert.equal(incoming, input);
          await Promise.resolve();
          events.push('resolved');
        },
        async handle(incoming, outgoing) {
          assert.equal(incoming, input);
          assert.equal(outgoing, response);
          assert.deepEqual(events, ['resolved']);
          outgoing.status = 401;
          outgoing.payload = { error: 'Sign-in required.' };
          return true;
        }
      }
    });
    await f.dispatch(input, response);
    assert.deepEqual(response, {
      status: 401,
      payload: { error: 'Sign-in required.' }
    });
    assert.deepEqual(f.calls, ['quota']);
    await f.dispatch(request('/public/fund-transparency'), {});
    assert.deepEqual(events, ['resolved']);
  }
});

test('identity resolution or handling failures return safe 503 before route handlers', async () => {
  for (const stage of ['resolve', 'handle']) {
    const f = fixture({
      adminIdentity: {
        async resolve() {
          if (stage === 'resolve')
            throw new Error('Synthetic private failure.');
        },
        async handle() {
          if (stage === 'handle') throw new Error('Synthetic private failure.');
          assert.fail('Handling must not follow a resolution failure.');
        }
      }
    });
    const response = {};
    await f.dispatch(request('/api/admin/dashboard'), response);
    assert.deepEqual(response, {
      status: 503,
      payload: { error: 'Identity service unavailable.' }
    });
    assert.deepEqual(f.calls, ['quota']);
  }
});

test('resolved OIDC role and origin refusals use existing guards before reading a refund body', async () => {
  for (const [role, requestOrigin] of [
    ['reader', origin],
    ['operator', origin],
    ['owner', 'https://foreign.example.test'],
    ['owner', undefined]
  ]) {
    let queries = 0;
    let bodyReads = 0;
    const adminIdentity = new AdminIdentityService(
      {
        async query() {
          queries += 1;
          return {
            rows: [
              {
                id: 'synthetic-admin',
                session_id: 'synthetic-session',
                display_name: 'Synthetic admin',
                role,
                expires_at: new Date('2027-01-01T00:00:00Z')
              }
            ]
          };
        }
      },
      {
        NODE_ENV: 'production',
        FUNDING_PUBLIC_BASE_URL: origin,
        FUNDING_ADMIN_OIDC_ISSUER: 'https://identity.example.test',
        FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
        FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret'
      }
    );
    const f = fixture({ adminIdentity, adminAuthMode: 'oidc' });
    const authorization = createAdminAuthorization({
      adminIdentity,
      adminTokenConfigured: true,
      isProduction: true,
      hasDatabase: true,
      verifyAdminSession() {
        assert.fail('OIDC must not fall back to a token session.');
      },
      adminTokenMatches() {
        assert.fail('OIDC must not fall back to the root token.');
      },
      writeJson: f.context.transport.writeJson
    });
    f.context.handlers.handleAdminSponsorshipRefundRequest =
      createAdminSponsorshipRefundHttpHandler({
        publicBaseOrigin: origin,
        isProduction: true,
        stripe: null,
        ensureAdminAccess: authorization.ensureAdminAccess,
        writeJson: f.context.transport.writeJson,
        async readBody() {
          bodyReads += 1;
          assert.fail('Refused refund requests must not read the body.');
        }
      });
    const response = {};
    await createHttpDispatcher(f.context)(
      request('/api/admin/sponsorships/refund', 'POST', {
        cookie: `__Host-og7-admin=${'s'.repeat(43)}`,
        authorization: 'Bearer synthetic-root-token',
        ...(requestOrigin ? { origin: requestOrigin } : {})
      }),
      response
    );
    assert.deepEqual(response, {
      status: 403,
      payload: {
        error: 'This action is not permitted for this account or origin.'
      }
    });
    assert.equal(queries, 1);
    assert.equal(bodyReads, 0);
    assert.equal(f.writes.length, 1);
  }
});

test('mixed public and admin dispatch preserves every precedence and stops after the handled route', async () => {
  for (const [index, selected] of handlerNames.entries()) {
    const f = fixture();
    const input = request('/health');
    const response = {};
    f.context.handlers[selected] = async (incoming, outgoing) => {
      assert.equal(incoming, input);
      assert.equal(outgoing, response);
      f.calls.push(selected);
      await Promise.resolve();
      f.context.transport.writeJson(incoming, outgoing, 202, {
        handledBy: selected
      });
      return true;
    };
    await createHttpDispatcher(f.context)(input, response);
    assert.deepEqual(response, {
      status: 202,
      payload: { handledBy: selected }
    });
    assert.deepEqual(f.calls, ['quota', ...handlerNames.slice(0, index + 1)]);
    assert.equal(f.writes.length, 1, selected);
  }
});

test('webhooks reach their handler with the original stream, raw bytes and signature', async () => {
  const raw = Buffer.from([123, 34, 255, 0, 34, 125, 10]);
  const signature = 'synthetic-stripe-signature';
  const input = request('/api/stripe/webhook', 'POST', {
    'stripe-signature': signature,
    'content-type': 'application/octet-stream'
  });
  let consumed = 0;
  input[Symbol.asyncIterator] = async function* () {
    consumed += 1;
    yield raw;
  };
  const f = fixture(
    {},
    {
      async handleStripeWebhookRequest(incoming, response) {
        assert.equal(incoming, input);
        assert.equal(consumed, 0);
        assert.equal(incoming.headers['stripe-signature'], signature);
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), raw);
        response.status = 204;
        return true;
      }
    }
  );
  const response = {};
  await f.dispatch(input, response);
  assert.deepEqual(response, { status: 204 });
  assert.equal(consumed, 1);
  assert.deepEqual(f.writes, []);
});

test('unhandled requests retain health, development-only status and method fallthrough', async () => {
  for (const [url, method, isProduction, expected] of [
    ['/health?probe=synthetic', 'GET', true, { status: 200, payload: 'ok' }],
    [
      '/api/health',
      'GET',
      false,
      { status: 404, payload: { error: 'Not found' } }
    ],
    [
      '/health',
      'POST',
      false,
      { status: 404, payload: { error: 'Not found' } }
    ],
    [
      '/missing',
      'GET',
      false,
      { status: 404, payload: { error: 'Not found' } }
    ],
    [
      '/dev/stripe-setup-status',
      'GET',
      true,
      { status: 404, payload: { error: 'Not found' } }
    ],
    [
      '/api/dev/stripe-setup-status',
      'POST',
      false,
      { status: 404, payload: { error: 'Not found' } }
    ]
  ]) {
    const f = fixture({ isProduction });
    const response = {};
    await f.dispatch(request(url, method), response);
    assert.deepEqual(response, expected);
    assert.deepEqual(f.calls, ['quota', ...handlerNames]);
  }
  for (const prefix of ['', '/api']) {
    const f = fixture();
    const response = {};
    await f.dispatch(request(`${prefix}/dev/stripe-setup-status`), response);
    assert.deepEqual(response, {
      status: 200,
      payload: { environment: 'synthetic', databaseReachable: false }
    });
    assert.deepEqual(f.calls, ['quota', ...handlerNames, 'development-status']);
  }
});

test('route and development status failures propagate to the listener without fallthrough', async () => {
  const failure = new Error('Synthetic request failure.');
  const routes = fixture(
    {},
    {
      async handlePublicPaymentsRequest() {
        throw failure;
      }
    }
  );
  await assert.rejects(
    routes.dispatch(request('/api/checkout-sessions', 'POST'), {}),
    (error) => error === failure
  );
  assert.deepEqual(routes.calls, ['quota', ...handlerNames.slice(0, 7)]);
  assert.deepEqual(routes.writes, []);
  const development = fixture({
    async readDevelopmentStatus() {
      throw failure;
    }
  });
  await assert.rejects(
    development.dispatch(request('/api/dev/stripe-setup-status'), {}),
    (error) => error === failure
  );
  assert.deepEqual(development.writes, []);
});
