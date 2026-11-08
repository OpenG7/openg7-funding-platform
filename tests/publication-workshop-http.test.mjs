import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createAdminAuthorization } from '../dist/apps/funding-api/src/admin-authorization.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import {
  createHttpTransport,
  readBody
} from '../dist/apps/funding-api/src/http-transport.js';
import { createPublicationWorkshopHttpHandler } from '../dist/apps/funding-api/src/preflight/workshop-routes.js';
import { PublicationWorkshopError } from '../dist/apps/funding-api/src/preflight/workshop.js';

const origin = 'https://localhost';
const base = '/api/admin/sponsorships/publication-workshop';
const id = (value) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const command = () => ({
  contributionId: id(1),
  requestId: id(2),
  expectedSourceVersion: 1
});
const stateFor = (contributionId) => ({
  contributionId,
  enabled: true,
  sourceVersion: 1,
  sourceSnapshotDigest: 'a'.repeat(64),
  mission: null,
  proposal: null,
  history: [],
  canPrepare: true,
  canAdopt: true
});

async function fixture(t, { disabled = false } = {}) {
  const calls = [],
    state = { bodyReads: 0, failure: null };
  const transport = createHttpTransport({
    isProduction: true,
    allowedOrigins: [origin]
  });
  const identity = (request) => {
    const role = request.headers.cookie?.match(
      /synthetic-session=(reader|operator|owner)/
    )?.[1];
    return role ? { id: id(9), role } : null;
  };
  const authorization = createAdminAuthorization({
    adminIdentity: {
      identity,
      permits: (request) => {
        const account = identity(request);
        return (
          !!account &&
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
  const service = Object.fromEntries(
    ['read', 'prepare', 'adopt'].map((method) => [
      method,
      async (input, actor) => {
        calls.push({ method, input, actor });
        if (state.failure) throw state.failure;
        return stateFor(
          typeof input === 'string' ? input : input.contributionId
        );
      }
    ])
  );
  const handler = createPublicationWorkshopHttpHandler({
    publicBaseOrigin: origin,
    ensureAdminAuthorization: authorization.ensureAdminAuthorization,
    canManage: (request) =>
      ['operator', 'owner'].includes(identity(request)?.role),
    getAdminAuditActor: authorization.getAdminAuditActor,
    readBody: (request, maxBytes) => {
      state.bodyReads++;
      assert.equal(maxBytes, 4096);
      return readBody(request, maxBytes);
    },
    writeJson: transport.writeJson,
    service: disabled ? null : service
  });
  const server = createServer((request, response) => {
    void handler(request, response)
      .then((handled) => {
        if (!handled)
          transport.writeJson(request, response, 404, { code: 'NOT_FOUND' });
      })
      .catch(() =>
        transport.writeJson(request, response, 500, {
          code: 'TEST_HANDLER_FAILURE'
        })
      );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return {
    calls,
    state,
    async request(
      path = base + '?contributionId=' + id(1),
      { method = 'GET', role = 'reader', headers = {}, body } = {}
    ) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}` + path,
        {
          method,
          headers: {
            ...(role ? { cookie: 'synthetic-session=' + role } : {}),
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
            ...headers
          },
          ...(body === undefined
            ? {}
            : { body: typeof body === 'string' ? body : JSON.stringify(body) })
        }
      );
      return {
        status: response.status,
        headers: response.headers,
        body: await response.json()
      };
    }
  };
}

test('workshop requires a current admin session before reading or parsing private data', async (t) => {
  const app = await fixture(t);
  for (const role of [null, 'expired']) {
    const response = await app.request(undefined, { role });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  const denied = await app.request(base + '/adopt', {
    method: 'POST',
    role: 'reader',
    headers: { origin },
    body: { ...command(), proposalId: id(3) }
  });
  assert.equal(denied.status, 403);
  assert.equal(app.state.bodyReads, 0);
  assert.equal(app.calls.length, 0);
});

test('reader sees private preparation without mutation rights and GET only reads', async (t) => {
  const app = await fixture(t);
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.canPrepare, false);
  assert.equal(response.body.canAdopt, false);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(app.calls, [
    { method: 'read', input: id(1), actor: undefined }
  ]);
});

test('workshop rejects caller scope, ambiguous identifiers and unsupported methods', async (t) => {
  const app = await fixture(t);
  for (const path of [
    base,
    base + '?contributionId=invalid',
    base + '?contributionId=' + id(1) + '&tenant=foreign',
    base + '?contributionId=' + id(1) + '&contributionId=' + id(2)
  ])
    assert.equal((await app.request(path)).status, 400);
  for (const header of ['x-tenant-id', 'x-applications', 'x-source-role'])
    assert.equal(
      (await app.request(undefined, { headers: { [header]: 'foreign' } }))
        .status,
      400
    );
  const wrong = await app.request(base + '/prepare', {
    method: 'GET',
    role: 'operator'
  });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
  assert.equal(app.calls.length, 0);
});

test('preparation and adoption need exact origin, role, bounded JSON and versioned input', async (t) => {
  const app = await fixture(t);
  for (const untrustedOrigin of [
    undefined,
    'https://elsewhere.example.invalid'
  ]) {
    const response = await app.request(base + '/prepare', {
      method: 'POST',
      role: 'operator',
      headers: untrustedOrigin ? { origin: untrustedOrigin } : {},
      body: command()
    });
    assert.equal(response.status, 403);
  }
  assert.equal(app.state.bodyReads, 0);
  const send = (body, extra = {}) =>
    app.request(base + '/prepare', {
      method: 'POST',
      role: 'operator',
      headers: { origin },
      body,
      ...extra
    });
  for (const body of [
    '{',
    [],
    { ...command(), tenantId: 'foreign' },
    { ...command(), expectedSourceVersion: '1' },
    { ...command(), expectedSourceVersion: 0 },
    { ...command(), requestId: 'invalid' },
    ' '.repeat(4097)
  ])
    assert.equal((await send(body)).status, 400);
  assert.equal(
    (
      await send(command(), {
        headers: { origin, 'content-type': 'text/plain' }
      })
    ).status,
    415
  );
  assert.equal(app.calls.length, 0);
  const prepared = await send(command());
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.canPrepare, true);
  assert.equal(app.calls[0].method, 'prepare');
  assert.equal(app.calls[0].actor, 'admin:' + id(9));
  const adopted = await app.request(base + '/adopt', {
    method: 'POST',
    role: 'owner',
    headers: { origin },
    body: { ...command(), proposalId: id(3) }
  });
  assert.equal(adopted.status, 200);
  assert.equal(app.calls[1].method, 'adopt');
});

test('disabled preparation has an explicit read state and never accepts a command', async (t) => {
  const app = await fixture(t, { disabled: true });
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.mission, null);
  assert.equal(response.body.canPrepare, false);
  assert.equal(
    (
      await app.request(base + '/prepare', {
        method: 'POST',
        role: 'operator',
        headers: { origin },
        body: command()
      })
    ).status,
    409
  );
  assert.equal(app.calls.length, 0);
});

test('workshop keeps conflicts distinct from unavailable services without leaking diagnostics', async (t) => {
  const app = await fixture(t);
  app.state.failure = new PublicationWorkshopError(
    'PUBLICATION_WORKSHOP_VERSION_CONFLICT'
  );
  const conflict = await app.request();
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'PUBLICATION_WORKSHOP_VERSION_CONFLICT');
  app.state.failure = new Error('Synthetic private diagnostic');
  const failure = await app.request();
  assert.equal(failure.status, 503);
  assert.equal(failure.body.code, 'PUBLICATION_WORKSHOP_UNAVAILABLE');
  assert.equal(
    JSON.stringify(failure.body).includes('private diagnostic'),
    false
  );
});
