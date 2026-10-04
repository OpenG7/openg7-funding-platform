import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminPublicationAutomationHttpHandler } from '../dist/apps/funding-api/src/admin-publication-automation.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { PublicationAutomationError } from '../dist/apps/funding-api/src/publication-automation/policy.js';
import { PublicationAutomationService } from '../dist/apps/funding-api/src/publication-automation/service.js';

const origin = 'https://funding.example.test';
const actor = 'synthetic-automation-owner';
const id = '11111111-1111-4111-8111-111111111111';
const command = {
  action: 'worker',
  enabled: true,
  version: 5,
  confirmation: 'enable-worker'
};

const fixture = ({
  denied,
  role = 'owner',
  unavailable = false,
  overrides = {}
} = {}) => {
  const calls = [];
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
  };
  const port =
    (name, result) =>
    async (...args) => {
      calls.push({ name, value: args });
      return name in overrides ? overrides[name](...args) : result;
    };
  const handler = createAdminPublicationAutomationHttpHandler({
    publicBaseOrigin: origin,
    ensureAdminAccess: (request, response) => {
      calls.push({ name: 'access' });
      const rejected =
        denied ??
        ((request.method !== 'GET' && request.headers.origin !== origin) ||
        !adminRoleAllows(
          role,
          request.method,
          new URL(request.url, origin).pathname
        )
          ? 403
          : undefined);
      if (!rejected) return true;
      writeJson(request, response, rejected, { code: 'ACCESS_REJECTED' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push({ name: 'actor' });
      return actor;
    },
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    writeJson,
    publicationAutomation: unavailable
      ? null
      : {
          state: port('state', { deliveries: [] }),
          mediaOptions: port('mediaOptions', { media: [] }),
          command: port('command', { id })
        },
    PublicationAutomationError
  });
  return {
    calls,
    names: () => calls.map((call) => call.name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((call) => call.value),
    async run(
      url,
      { method = 'GET', input, body, requestOrigin = origin, contentType } = {}
    ) {
      const request = Object.assign(
        Readable.from([Buffer.from(body ?? JSON.stringify(input ?? {}))]),
        {
          method,
          url,
          headers: {
            origin: requestOrigin,
            ...(contentType ? { 'content-type': contentType } : {})
          }
        }
      );
      const response = {};
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('automation aliases reject absent, forbidden and unavailable access before bodies, actors or service calls', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of [
      '/admin/publication-automation',
      '/api/admin/publication-automation'
    ]) {
      for (const suffix of ['', '/media']) {
        for (const method of ['GET', 'POST']) {
          await t.test(`${denied} ${method} ${prefix}${suffix}`, async () => {
            const f = fixture({ denied });
            const result = await f.run(prefix + suffix, {
              method,
              body: '{invalid'
            });
            assert.equal(result.handled, true);
            assert.equal(result.status, denied);
            assert.deepEqual(f.names(), ['access', 'json']);
          });
        }
      }
    }
  }
});

test('automation retains role and origin decisions from the injected admin guard', async () => {
  for (const role of ['reader', 'operator']) {
    const f = fixture({ role });
    assert.equal(
      (
        await f.run('/api/admin/publication-automation', {
          method: 'POST',
          input: command
        })
      ).status,
      403
    );
    assert.deepEqual(f.names(), ['access', 'json']);
    for (const suffix of ['', '/media']) {
      assert.equal(
        (await fixture({ role }).run('/admin/publication-automation' + suffix))
          .status,
        200
      );
    }
  }
  const f = fixture();
  assert.equal(
    (
      await f.run('/admin/publication-automation', {
        method: 'POST',
        input: command,
        requestOrigin: 'https://foreign.example.test'
      })
    ).status,
    403
  );
  assert.deepEqual(f.names(), ['access', 'json']);
});

test('automation state passes exact intersecting dossier filters and media reads use the separate service port', async () => {
  for (const prefix of [
    '/admin/publication-automation',
    '/api/admin/publication-automation'
  ]) {
    for (const [query, filters] of [
      ['', { sponsorshipId: undefined, deliveryId: undefined }],
      ['?sponsorshipId=&deliveryId=', { sponsorshipId: '', deliveryId: '' }],
      [
        `?sponsorshipId=${id}&deliveryId=synthetic%20delivery`,
        { sponsorshipId: id, deliveryId: 'synthetic delivery' }
      ]
    ]) {
      const f = fixture();
      const result = await f.run(prefix + query);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, { deliveries: [] });
      assert.deepEqual(f.values('state'), [[undefined, filters]]);
      assert.deepEqual(f.names(), ['access', 'state', 'json']);
    }
    const f = fixture();
    assert.equal(
      (await f.run(prefix + '/media?sponsorshipId=ignored')).status,
      200
    );
    assert.deepEqual(f.values('mediaOptions'), [[]]);
    assert.deepEqual(f.names(), ['access', 'mediaOptions', 'json']);
  }
});

test('automation delegates exact command version and confirmation with the resolved audit actor', async () => {
  for (const prefix of [
    '/admin/publication-automation',
    '/api/admin/publication-automation'
  ]) {
    const f = fixture();
    const result = await f.run(prefix, { method: 'POST', input: command });
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, { id });
    assert.deepEqual(f.values('command'), [[command, actor]]);
    assert.deepEqual(f.values('body'), [undefined]);
    assert.deepEqual(f.names(), ['access', 'body', 'actor', 'command', 'json']);
  }
});

test('automation keeps malformed JSON and default body-size failure behavior without invoking its command', async () => {
  for (const [body, status] of [
    ['{invalid', 400],
    [' '.repeat(256 * 1024 + 1), 503]
  ]) {
    const f = fixture();
    const result = await f.run('/admin/publication-automation', {
      method: 'POST',
      body
    });
    assert.equal(result.status, status);
    assert.deepEqual(result.payload, { code: 'AUTOMATION_UNAVAILABLE' });
    assert.deepEqual(f.names(), ['access', 'body', 'json']);
  }
});

test('automation preserves service validation and conflict codes while hiding unknown private diagnostics', async () => {
  const routes = [
    ['state', '/admin/publication-automation', 'GET'],
    ['mediaOptions', '/admin/publication-automation/media', 'GET'],
    ['command', '/admin/publication-automation', 'POST']
  ];
  for (const [port, path, method] of routes) {
    for (const error of [
      new PublicationAutomationError('INVALID_FILTER', 400),
      new PublicationAutomationError('VERSION_CONFLICT', 409),
      new PublicationAutomationError('CONFIRMATION_REQUIRED', 400),
      new Error('Synthetic private provider diagnostic')
    ]) {
      const f = fixture({
        overrides: {
          [port]: () => {
            throw error;
          }
        }
      });
      const result = await f.run(path, { method, input: command });
      assert.equal(result.status, error.status ?? 503);
      assert.deepEqual(result.payload, {
        code: error.code ?? 'AUTOMATION_UNAVAILABLE'
      });
      assert.equal(
        JSON.stringify(result.payload).includes('private provider'),
        false
      );
    }
  }
});

test('real automation service requires a valid worker version and confirmation before persistence', async () => {
  const dbCalls = [];
  const pool = {
    connect: async () => {
      dbCalls.push('connect');
      throw new Error('Unexpected database access');
    }
  };
  const service = new PublicationAutomationService(pool, {}, {});
  for (const [input, code] of [
    [{ ...command, version: 0 }, 'INVALID_COMMAND'],
    [{ ...command, version: 1.5 }, 'INVALID_COMMAND'],
    [{ ...command, confirmation: 'wrong' }, 'CONFIRMATION_REQUIRED']
  ]) {
    const f = fixture({
      overrides: { command: (...args) => service.command(...args) }
    });
    const result = await f.run('/api/admin/publication-automation', {
      method: 'POST',
      input
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { code });
  }
  assert.deepEqual(dbCalls, []);
});

test('a stale real worker version returns conflict without updating settings or audit', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return {
        rows: sql.startsWith('SELECT enabled,version')
          ? [{ enabled: false, version: 10 }]
          : []
      };
    },
    release() {
      queries.push('release');
    }
  };
  const service = new PublicationAutomationService(
    { connect: async () => client },
    {},
    {}
  );
  const f = fixture({
    overrides: { command: (...args) => service.command(...args) }
  });
  const result = await f.run('/admin/publication-automation', {
    method: 'POST',
    input: command
  });
  assert.equal(result.status, 409);
  assert.deepEqual(result.payload, { code: 'WORKER_VERSION_CONFLICT' });
  assert.ok(queries.includes('ROLLBACK'));
  assert.equal(
    queries.some((sql) => sql.startsWith('UPDATE') || sql.startsWith('INSERT')),
    false
  );
});

test('the automation facade keeps a supplied command client and its caller-owned transaction', async () => {
  const queries = [];
  const client = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return {
        rows: sql.startsWith('SELECT enabled,version')
          ? [{ enabled: false, version: command.version }]
          : []
      };
    },
    release() {
      assert.fail('Only the caller may release the supplied client');
    }
  };
  const pool = {
    async connect() {
      assert.fail('The supplied client must not open another transaction');
    }
  };
  const service = new PublicationAutomationService(pool, {}, {});
  assert.deepEqual(await service.command(command, actor, false, client), {});
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /FOR UPDATE$/);
  assert.match(queries[1].sql, /^UPDATE publication_worker_settings/);
  assert.deepEqual(queries[1].parameters, [true]);
  assert.match(queries[2].sql, /^INSERT INTO admin_audit_log/);
  assert.equal(queries[2].parameters[0], actor);
  assert.equal(
    queries[2].parameters[1],
    'publication_automation.worker_settings'
  );
  assert.deepEqual(JSON.parse(queries[2].parameters[3]), {
    previousEnabled: false,
    enabled: true,
    previousVersion: command.version,
    version: command.version + 1
  });
});

test('automation retains handled service absence and method rejection without body access', async () => {
  const missing = fixture({ unavailable: true });
  const result = await missing.run('/admin/publication-automation');
  assert.equal(result.handled, true);
  assert.equal(result.status, undefined);
  assert.deepEqual(missing.names(), ['access']);
  for (const [suffix, method] of [
    ['/media', 'POST'],
    ['', 'DELETE']
  ]) {
    const f = fixture();
    const rejected = await f.run('/api/admin/publication-automation' + suffix, {
      method
    });
    assert.equal(rejected.handled, true);
    assert.equal(rejected.status, 405);
    assert.deepEqual(rejected.payload, { code: 'METHOD_NOT_ALLOWED' });
    assert.deepEqual(f.names(), ['access', 'json']);
  }
});

test('automation leaves adjacent paths and other route families untouched', async () => {
  for (const path of [
    '/admin/publication-automation/other',
    '/api/admin/publication-automation/media/other',
    '/admin/pilotage',
    '/health'
  ]) {
    const f = fixture();
    assert.equal((await f.run(path)).handled, false);
    assert.deepEqual(f.calls, []);
  }
});
