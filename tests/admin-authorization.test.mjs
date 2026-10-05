import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdminAuthorization,
  readAdminToken
} from '../dist/apps/funding-api/src/admin-authorization.js';
import { AdminIdentityService } from '../dist/apps/funding-api/src/admin-identity.js';
import { loadApiRuntimeConfig } from '../dist/apps/funding-api/src/api-runtime-config.js';
import { createAdminTokenSessionService } from '../dist/apps/funding-api/src/admin-token-session.js';

const rootToken = 'synthetic-root-token-32-characters';
const origin = 'https://funding.example.test';
const issuedAt = Date.parse('2026-10-03T12:00:00Z');
const request = (headers = {}, options = {}) => ({
  method: 'GET',
  url: '/api/admin/dashboard',
  headers,
  ...options
});
const fixture = ({
  adminTokenConfigured = true,
  isProduction = false,
  hasDatabase = true,
  adminIdentity = null,
  now = issuedAt
} = {}) => {
  const calls = [];
  const sessions = createAdminTokenSessionService({
    adminToken: adminTokenConfigured ? rootToken : '',
    sessionSecret: adminTokenConfigured
      ? 'synthetic-signing-secret-32-characters'
      : '',
    sessionTtlMinutes: 5,
    isProduction,
    projectId: 'synthetic-project'
  });
  const authorization = createAdminAuthorization({
    adminIdentity,
    adminTokenConfigured,
    isProduction,
    hasDatabase,
    verifyAdminSession: (candidate) => {
      calls.push(['session', candidate]);
      return sessions.verifyAdminSession(candidate, now);
    },
    adminTokenMatches: (candidate) => {
      calls.push(['root-token', candidate]);
      return sessions.adminTokenMatches(candidate);
    },
    writeJson: (_request, response, status, payload) => {
      calls.push(['json', status]);
      Object.assign(response, { status, payload });
    }
  });
  return {
    calls,
    sessions,
    ...authorization,
    guard(input, name = 'ensureAdminAuthorization') {
      const response = {};
      return {
        authorized: authorization[name](input, response),
        ...response
      };
    }
  };
};

const oidcFixture = async ({
  adminTokenConfigured = true,
  role = 'owner',
  resolved = true,
  cookie = true,
  method = 'GET',
  url = '/api/admin/dashboard',
  requestOrigin = origin
} = {}) => {
  const queries = [];
  const identity = new AdminIdentityService(
    {
      async query(...args) {
        queries.push(args);
        return {
          rows: resolved
            ? [
                {
                  id: 'synthetic-admin-id',
                  session_id: 'synthetic-session-id',
                  display_name: 'Synthetic administrator',
                  role,
                  expires_at: new Date(issuedAt + 60 * 60 * 1000)
                }
              ]
            : []
        };
      }
    },
    {
      NODE_ENV: 'production',
      FUNDING_PUBLIC_BASE_URL: origin,
      FUNDING_ADMIN_OIDC_ISSUER: 'https://identity.example.test',
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client-id',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret'
    }
  );
  const input = request(
    {
      authorization: `Bearer ${rootToken}`,
      'x-funding-admin-token': rootToken,
      ...(cookie ? { cookie: `__Host-og7-admin=${'s'.repeat(43)}` } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {})
    },
    { method, url }
  );
  await identity.resolve(input);
  return {
    ...fixture({ adminIdentity: identity, adminTokenConfigured }),
    input,
    queries
  };
};

test('admin token parsing preserves bearer priority and the custom header fallback', () => {
  for (const [headers, expected] of [
    [{ authorization: `Bearer ${rootToken}` }, rootToken],
    [{ authorization: `bEaReR\t${rootToken} ignored` }, rootToken],
    [
      {
        authorization: 'Basic synthetic-other-token',
        'x-funding-admin-token': rootToken
      },
      rootToken
    ],
    [
      { authorization: 'Bearer', 'x-funding-admin-token': rootToken },
      rootToken
    ],
    [
      {
        authorization: 'Bearer synthetic-other-token',
        'x-funding-admin-token': rootToken
      },
      'synthetic-other-token'
    ],
    [{ 'x-funding-admin-token': ` ${rootToken} ` }, ` ${rootToken} `],
    [
      { authorization: [rootToken], 'x-funding-admin-token': [rootToken] },
      null
    ],
    [{}, null]
  ]) {
    assert.equal(readAdminToken(request(headers)), expected);
  }
});

test('a valid signed session is authorized before comparing the root token and keeps its audit actor', () => {
  const f = fixture();
  const session = f.sessions.createAdminSession(issuedAt);
  const input = request({ authorization: `Bearer ${session.sessionToken}` });
  assert.deepEqual(f.resolveAdminAuthorization(input), {
    actor: 'funding-admin-session',
    source: 'session'
  });
  assert.equal(f.isAdminAuthorized(input), true);
  assert.deepEqual(f.guard(input, 'ensureAdminAccess'), { authorized: true });
  assert.equal(f.getAdminAuditActor(input), 'funding-admin-session');
  assert.ok(f.calls.every(([kind]) => kind === 'session'));
});

test('signed sessions expire at the exact server deadline and cannot become root token authorization', () => {
  const valid = fixture();
  const session = valid.sessions.createAdminSession(issuedAt);
  const expiresAt = Date.parse(session.expiresAt);
  const input = request({ 'x-funding-admin-token': session.sessionToken });
  assert.equal(fixture({ now: expiresAt - 1 }).isAdminAuthorized(input), true);
  for (const now of [expiresAt, expiresAt + 1]) {
    const f = fixture({ now });
    assert.deepEqual(f.guard(input), {
      authorized: false,
      status: 401,
      payload: { error: 'Admin authorization is required.' }
    });
    assert.deepEqual(f.calls, [
      ['session', session.sessionToken],
      ['json', 401]
    ]);
  }
});

test('missing, invalid and tampered sessions refuse before checking database access', () => {
  const session = fixture().sessions.createAdminSession(issuedAt);
  for (const token of [
    null,
    'synthetic-invalid-token',
    `${session.sessionToken}x`
  ]) {
    const f = fixture({ hasDatabase: false });
    const input = request(token ? { authorization: `Bearer ${token}` } : {});
    assert.deepEqual(f.guard(input, 'ensureAdminAccess'), {
      authorized: false,
      status: 401,
      payload: { error: 'Admin authorization is required.' }
    });
    assert.equal(f.resolveAdminAuthorization(input), null);
    assert.equal(f.getAdminAuditActor(input), 'unauthenticated');
  }
});

test('root credentials cannot authorize private routes through either supported header', () => {
  for (const headers of [
    { authorization: `Bearer ${rootToken}` },
    { 'x-funding-admin-token': rootToken }
  ]) {
    const f = fixture();
    const input = request(headers);
    assert.equal(f.resolveAdminAuthorization(input), null);
    assert.deepEqual(f.calls, [['session', rootToken]]);
    assert.equal(f.getAdminAuditActor(input), 'unauthenticated');
    assert.equal(f.guard(input, 'ensureAdminAccess').status, 401);
    assert.ok(f.calls.every(([kind]) => kind !== 'root-token'));
  }
});

test('an invalid bearer token cannot fall back to a valid custom header', () => {
  const f = fixture();
  assert.equal(
    f.isAdminAuthorized(
      request({
        authorization: 'Bearer synthetic-invalid-token',
        'x-funding-admin-token': rootToken
      })
    ),
    false
  );
  assert.deepEqual(f.calls, [['session', 'synthetic-invalid-token']]);
});

test('production without admin configuration stays unavailable without invoking token dependencies', () => {
  const f = fixture({
    adminTokenConfigured: false,
    hasDatabase: false,
    isProduction: true
  });
  const input = request({ authorization: `Bearer ${rootToken}` });
  assert.equal(f.resolveAdminAuthorization(input), null);
  assert.deepEqual(f.guard(input, 'ensureAdminAccess'), {
    authorized: false,
    status: 503,
    payload: { error: 'OIDC admin sign-in is required in production.' }
  });
  assert.deepEqual(f.calls, [['json', 503]]);
});

test('standalone NODE_ENV production cannot authorize an unconfigured administrator', () => {
  const config = loadApiRuntimeConfig({ NODE_ENV: 'production' });
  const f = fixture({
    isProduction: config.isProduction,
    adminTokenConfigured: false
  });
  assert.equal(f.resolveAdminAuthorization(request()), null);
  assert.equal(f.guard(request(), 'ensureAdminAccess').status, 503);
});

test('unconfigured local development denies anonymous administration and never verifies supplied credentials', () => {
  const f = fixture({ adminTokenConfigured: false, isProduction: false });
  const input = request({ authorization: 'Bearer synthetic-invalid-token' });
  assert.equal(f.resolveAdminAuthorization(input), null);
  assert.equal(f.guard(input, 'ensureAdminAccess').status, 503);
  assert.equal(f.getAdminAuditActor(input), 'unauthenticated');
  assert.deepEqual(f.calls, [['json', 503]]);
});

test('setup authorization remains usable without PostgreSQL while admin access requires it', () => {
  {
    const f = fixture({ hasDatabase: false });
    const session = f.sessions.createAdminSession(issuedAt);
    const input = request({ authorization: `Bearer ${session.sessionToken}` });
    assert.deepEqual(f.guard(input), { authorized: true });
    assert.deepEqual(f.guard(input, 'ensureAdminAccess'), {
      authorized: false,
      status: 503,
      payload: {
        error: 'Admin review requires DATABASE_URL and PostgreSQL migrations.'
      }
    });
  }
});

test('production guards refuse signed token sessions without consulting token dependencies', () => {
  const local = fixture();
  const session = local.sessions.createAdminSession(issuedAt);
  const f = fixture({ isProduction: true });
  const input = request({ authorization: `Bearer ${session.sessionToken}` });
  assert.equal(f.resolveAdminAuthorization(input), null);
  assert.equal(f.guard(input).status, 503);
  assert.deepEqual(f.calls, [['json', 503]]);
});

test('resolved OIDC identities keep their own actor without evaluating root tokens or signed sessions', async () => {
  for (const adminTokenConfigured of [false, true]) {
    const f = await oidcFixture({ adminTokenConfigured });
    assert.deepEqual(f.resolveAdminAuthorization(f.input), {
      actor: 'admin:synthetic-admin-id',
      source: 'oidc'
    });
    assert.deepEqual(f.guard(f.input, 'ensureAdminAccess'), {
      authorized: true
    });
    assert.equal(f.getAdminAuditActor(f.input), 'admin:synthetic-admin-id');
    assert.deepEqual(f.calls, []);
    assert.equal(f.queries.length, 1);
  }
});

test('OIDC absent or unresolved sessions refuse even when both root token headers are valid', async () => {
  for (const options of [{ cookie: false }, { resolved: false }]) {
    const f = await oidcFixture(options);
    assert.equal(f.resolveAdminAuthorization(f.input), null);
    assert.deepEqual(f.guard(f.input, 'ensureAdminAccess'), {
      authorized: false,
      status: 401,
      payload: { error: 'Admin authorization is required.' }
    });
    assert.deepEqual(f.calls, [['json', 401]]);
  }
});

test('OIDC guards delegate reader, operator and owner permissions to the existing identity policy', async () => {
  for (const [method, url, allowed] of [
    ['GET', '/api/admin/dashboard', ['reader', 'operator', 'owner']],
    ['POST', '/api/admin/sponsorships/review', ['operator', 'owner']],
    ['GET', '/api/admin/setup-status', ['owner']],
    ['POST', '/api/admin/sponsorships/refund', ['owner']],
    ['POST', '/api/admin/new-action', ['owner']]
  ]) {
    for (const role of ['reader', 'operator', 'owner']) {
      const f = await oidcFixture({ role, method, url });
      const result = f.guard(f.input);
      assert.equal(result.authorized, allowed.includes(role), `${role} ${url}`);
      if (!allowed.includes(role)) {
        assert.deepEqual(result, {
          authorized: false,
          status: 403,
          payload: {
            error: 'This action is not permitted for this account or origin.'
          }
        });
        assert.deepEqual(f.calls, [['json', 403]]);
      } else {
        assert.deepEqual(result, { authorized: true });
        assert.deepEqual(f.calls, []);
      }
    }
  }
});

test('OIDC mutations reject missing or foreign origins before evaluating token authorization', async () => {
  for (const requestOrigin of [null, 'https://foreign.example.test']) {
    const f = await oidcFixture({
      method: 'POST',
      url: '/api/admin/sponsorships/review',
      requestOrigin
    });
    assert.deepEqual(f.guard(f.input), {
      authorized: false,
      status: 403,
      payload: {
        error: 'This action is not permitted for this account or origin.'
      }
    });
    assert.deepEqual(f.calls, [['json', 403]]);
  }
});

test('OIDC identity errors propagate without root token fallback', () => {
  const failure = new Error('synthetic identity failure');
  const f = fixture({
    adminIdentity: {
      identity() {
        throw failure;
      },
      permits() {
        assert.fail('permissions must not be checked after an identity error');
      }
    }
  });
  const input = request({ authorization: `Bearer ${rootToken}` });
  assert.throws(() => f.resolveAdminAuthorization(input), failure);
  assert.throws(() => f.guard(input), failure);
  assert.deepEqual(f.calls, []);
});
