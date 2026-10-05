import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminSessionHttpHandler } from '../dist/apps/funding-api/src/admin-session.http.js';
import { createAdminTokenSessionService } from '../dist/apps/funding-api/src/admin-token-session.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const token = 'synthetic-root-token-32-characters';
const fixture = ({
  adminTokenConfigured = true,
  isProduction = false,
  signingUnavailable = false
} = {}) => {
  const calls = [];
  const service = createAdminTokenSessionService({
    adminToken: adminTokenConfigured ? token : '',
    sessionSecret: adminTokenConfigured
      ? 'synthetic-signing-secret-32-characters'
      : '',
    sessionTtlMinutes: 5,
    isProduction,
    projectId: 'synthetic-project'
  });
  const handler = createAdminSessionHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    adminTokenConfigured,
    isProduction,
    adminTokenMatches: (candidate) => {
      calls.push(['token', candidate]);
      return service.adminTokenMatches(candidate);
    },
    createAdminSession: () => {
      calls.push(['sign']);
      return signingUnavailable ? null : service.createAdminSession();
    },
    readBody: (request, limit) => {
      calls.push(['body', limit]);
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, payload) => {
      calls.push(['json', status]);
      Object.assign(response, { status, payload });
    }
  });
  return {
    calls,
    service,
    async request(
      url = '/admin/session',
      {
        method = 'POST',
        body = JSON.stringify({ token }),
        contentType = 'application/json',
        origin
      } = {}
    ) {
      const request = Object.assign(Readable.from([body]), {
        method,
        url,
        headers: {
          ...(contentType ? { 'content-type': contentType } : {}),
          ...(origin ? { origin } : {})
        }
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('session aliases compare the trimmed token and return a valid limited signed session', async () => {
  for (const url of ['/admin/session', '/api/admin/session?unused=true']) {
    const f = fixture();
    const result = await f.request(url, {
      body: JSON.stringify({ token: ` ${token} ` })
    });
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.equal(result.payload.actor, 'funding-admin-session');
    assert.equal(result.payload.ttlSeconds, 300);
    assert.equal(JSON.stringify(result.payload).includes(token), false);
    assert.ok(f.service.verifyAdminSession(result.payload.sessionToken));
    assert.equal(
      f.service.verifyAdminSession(
        result.payload.sessionToken,
        Date.parse(result.payload.expiresAt)
      ),
      null
    );
    assert.deepEqual(f.calls, [
      ['body', 16384],
      ['token', token],
      ['sign'],
      ['json', 200]
    ]);
  }
});

test('production refuses token exchange even with a configured root token before parsing', async () => {
  for (const adminTokenConfigured of [false, true]) {
    const f = fixture({ adminTokenConfigured, isProduction: true });
    const result = await f.request(undefined, { body: '{' });
    assert.equal(result.status, 403);
    assert.deepEqual(result.payload, {
      error: 'OIDC admin sign-in is required in production.'
    });
    assert.deepEqual(f.calls, [['json', 403]]);
  }
});

test('local development without a configured root token refuses unauthenticated sessions', async () => {
  const f = fixture({ adminTokenConfigured: false });
  const result = await f.request(undefined, { body: '{}' });
  assert.equal(result.status, 503);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ['json']
  );
});

test('session exchange rejects non-JSON and foreign origins before parsing credentials', async () => {
  for (const [options, status] of [
    [{ contentType: null }, 415],
    [{ contentType: 'text/plain' }, 415],
    [{ origin: 'https://foreign.example.test' }, 403]
  ]) {
    const f = fixture();
    const result = await f.request(undefined, options);
    assert.equal(result.status, status);
    assert.deepEqual(f.calls, [['json', status]]);
  }
  assert.equal(
    (
      await fixture().request(undefined, {
        origin: 'https://funding.example.test'
      })
    ).status,
    200
  );
});

test('session malformed and oversized bodies do not compare tokens or sign', async () => {
  for (const body of [
    '{',
    ' '.repeat(16385),
    'null',
    '[]',
    'true',
    '42',
    '"synthetic-root-token"'
  ]) {
    const f = fixture();
    const result = await f.request(undefined, { body });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, {
      error: 'Invalid admin session request body.'
    });
    assert.deepEqual(f.calls, [
      ['body', 16384],
      ['json', 400]
    ]);
  }
});

test('invalid or missing session tokens refuse signing and signing absence stays unavailable', async () => {
  for (const input of [{ token: 'wrong' }, { token: 7 }, {}]) {
    const f = fixture();
    const result = await f.request(undefined, { body: JSON.stringify(input) });
    assert.equal(result.status, 401);
    assert.deepEqual(result.payload, {
      error: 'Admin authorization is required.'
    });
    assert.equal(
      f.calls.some(([name]) => name === 'sign'),
      false
    );
  }
  const result = await fixture({ signingUnavailable: true }).request();
  assert.equal(result.status, 503);
  assert.deepEqual(result.payload, {
    error: 'Admin session signing is not configured.'
  });
});

test('session unsupported methods and routes fall through without effects', async () => {
  const f = fixture();
  for (const [url, method] of [
    ['/admin/session', 'GET'],
    ['/api/admin/session', 'DELETE'],
    ['/admin/session/extra', 'POST']
  ]) {
    assert.equal((await f.request(url, { method })).handled, false);
  }
  assert.deepEqual(f.calls, []);
});
