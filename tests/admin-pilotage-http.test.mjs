import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminPilotageHttpHandler } from '../dist/apps/funding-api/src/admin-pilotage.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import {
  AdminPilotageService,
  PilotError
} from '../dist/apps/funding-api/src/admin-pilotage.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { PublicationAutomationError } from '../dist/apps/funding-api/src/publication-automation/policy.js';

const origin = 'https://funding.example.test';
const actor = 'synthetic-pilotage-operator';
const id = '11111111-1111-4111-8111-111111111111';
const command = {
  requestId: id,
  action: 'feed.pause',
  targetId: 'openg7:linkedin',
  version: '2026-10-03T12:34:56.123456Z',
  confirmation: 'openg7:linkedin'
};
const receipt = { requestId: id, status: 'completed', code: 'COMPLETED' };

const fixture = ({
  denied,
  role = 'operator',
  tokenMode = false,
  bypassRole = false,
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
  const handler = createAdminPilotageHttpHandler({
    publicBaseOrigin: origin,
    ensureAdminAccess: (request, response) => {
      calls.push({ name: 'access' });
      const rejected =
        denied ??
        (!bypassRole &&
        !tokenMode &&
        ((request.method !== 'GET' && request.headers.origin !== origin) ||
          !adminRoleAllows(
            role,
            request.method,
            new URL(request.url, origin).pathname
          ))
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
    adminIdentity: tokenMode ? null : { identity: () => ({ role }) },
    adminPilotage: unavailable
      ? null
      : {
          state: port('state', { decisions: [] }),
          command: port('command', receipt),
          readReceipt: port('readReceipt', receipt),
          acknowledgeReceipt: port('acknowledgeReceipt', receipt),
          editorial: {
            state: port('editorial.state', { programme: [] }),
            propose: port('editorial.propose', { proposal: [] }),
            variant: port('editorial.variant', { message: 'Synthetic variant' })
          }
        },
    PilotError,
    PublicationAutomationError
  });
  return {
    calls,
    names: () => calls.map((call) => call.name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((call) => call.value),
    async run(
      url,
      {
        method = 'GET',
        input,
        body,
        contentType = 'application/json',
        requestOrigin = origin
      } = {}
    ) {
      const request = Object.assign(
        Readable.from([Buffer.from(body ?? JSON.stringify(input ?? {}))]),
        {
          method,
          url,
          headers: {
            ...(contentType === undefined
              ? {}
              : { 'content-type': contentType }),
            ...(requestOrigin === undefined ? {} : { origin: requestOrigin })
          }
        }
      );
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

test('pilotage aliases reject absent access, forbidden origin and unavailable database before reading or service calls', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of ['/admin/pilotage', '/api/admin/pilotage']) {
      for (const suffix of [
        '',
        '/command',
        '/receipt',
        '/programme',
        '/variant'
      ]) {
        await t.test(`${denied} ${prefix}${suffix}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(prefix + suffix, {
            method: 'POST',
            body: '{invalid'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.equal(result.headers['Cache-Control'], 'private, no-store');
          assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
    }
  }
  const f = fixture();
  assert.equal(
    (
      await f.run('/api/admin/pilotage/command', {
        method: 'POST',
        input: command,
        requestOrigin: 'https://foreign.example.test'
      })
    ).status,
    403
  );
  assert.deepEqual(f.names(), ['access', 'json']);
});

test('pilotage roles retain writable and owner flags, with token administration retaining its existing rights', async () => {
  for (const [role, tokenMode, writable, owner] of [
    ['reader', false, false, false],
    ['operator', false, true, false],
    ['owner', false, true, true],
    ['reader', true, true, true]
  ]) {
    const f = fixture({ role, tokenMode });
    const result = await f.run(
      '/api/admin/pilotage?page=2&domain=publication&id=synthetic-target'
    );
    assert.equal(result.status, 200);
    assert.deepEqual(f.values('state'), [
      [
        { page: 2, domain: 'publication', id: 'synthetic-target' },
        writable,
        owner
      ]
    ]);
    const programme = fixture({ role, tokenMode });
    assert.equal(
      (await programme.run('/admin/pilotage/programme')).status,
      200
    );
    assert.deepEqual(programme.values('editorial.state'), [[writable]]);
  }
  for (const suffix of ['/command', '/receipt', '/programme', '/variant']) {
    const f = fixture({ role: 'reader' });
    assert.equal(
      (
        await f.run('/admin/pilotage' + suffix, {
          method: 'POST',
          input: command
        })
      ).status,
      403
    );
    assert.deepEqual(f.names(), ['access', 'json']);
  }
});

test('pilotage unavailable service and invalid queries do not access domain state', async () => {
  const missing = fixture({ unavailable: true });
  const missingResult = await missing.run('/admin/pilotage');
  assert.equal(missingResult.status, 503);
  assert.deepEqual(missingResult.payload, { code: 'PILOTAGE_UNAVAILABLE' });
  assert.deepEqual(missing.names(), ['access', 'json']);
  for (const page of [
    '',
    '0',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '9007199254740992'
  ]) {
    const f = fixture();
    const result = await f.run(`/admin/pilotage?page=${page}`);
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { code: 'INVALID_QUERY' });
    assert.equal(f.values('state').length, 0);
  }
  const f = fixture();
  assert.equal(
    (await f.run('/admin/pilotage?page=1e2&domain=&id=')).status,
    200
  );
  assert.deepEqual(f.values('state'), [
    [{ page: 100, domain: '', id: '' }, true, false]
  ]);
});

test('pilotage passes exact command identifiers, version, confirmation, actor and privileges to the service', async () => {
  for (const prefix of ['/admin/pilotage', '/api/admin/pilotage']) {
    for (const [role, owner] of [
      ['operator', false],
      ['owner', true]
    ]) {
      const f = fixture({ role });
      const result = await f.run(prefix + '/command', {
        method: 'POST',
        input: command,
        contentType: 'APPLICATION/JSON; charset=utf-8'
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, receipt);
      assert.deepEqual(f.values('command'), [[command, actor, true, owner]]);
      assert.deepEqual(f.values('body'), [16 * 1024]);
    }
  }
});

test('pilotage receipt reads remain scoped to the actor and return missing records explicitly', async () => {
  for (const [query, expectedId] of [
    ['', ''],
    ['?id=', ''],
    ['?id=synthetic%20receipt', 'synthetic receipt']
  ]) {
    const f = fixture();
    assert.equal(
      (await f.run('/api/admin/pilotage/receipt' + query)).status,
      200
    );
    assert.deepEqual(f.values('readReceipt'), [[expectedId, actor]]);
  }
  const f = fixture({ overrides: { readReceipt: () => null } });
  const result = await f.run('/admin/pilotage/receipt?id=' + id);
  assert.equal(result.status, 404);
  assert.deepEqual(result.payload, { code: 'RECEIPT_NOT_FOUND' });
  const input = {
    requestId: id,
    confirmation: id,
    reason: 'Synthetic incident examined.'
  };
  const ack = fixture();
  assert.equal(
    (await ack.run('/api/admin/pilotage/receipt', { method: 'POST', input }))
      .status,
    200
  );
  assert.deepEqual(ack.values('acknowledgeReceipt'), [[input, actor]]);
  assert.deepEqual(ack.values('body'), [4096]);
});

test('editorial preparation routes pass proposals to their own ports without creating a command receipt', async () => {
  for (const [suffix, port] of [
    ['programme', 'editorial.propose'],
    ['variant', 'editorial.variant']
  ]) {
    const input = {
      feedId: 'openg7:linkedin',
      version: 'synthetic-version',
      intent: 'neutral'
    };
    const f = fixture();
    assert.equal(
      (await f.run('/admin/pilotage/' + suffix, { method: 'POST', input }))
        .status,
      200
    );
    assert.deepEqual(f.values(port), [[input]]);
    assert.deepEqual(f.values('body'), [4096]);
    assert.equal(f.values('command').length, 0);
    assert.equal(f.values('acknowledgeReceipt').length, 0);
  }
});

test('pilotage content type, malformed JSON and body-size outcomes retain existing codes and limits', async () => {
  for (const [suffix, limit] of [
    ['command', 16 * 1024],
    ['receipt', 4096],
    ['programme', 4096],
    ['variant', 4096]
  ]) {
    const unsupported = fixture();
    const wrong = await unsupported.run('/admin/pilotage/' + suffix, {
      method: 'POST',
      input: command,
      contentType: 'text/plain'
    });
    assert.equal(wrong.status, 415);
    assert.deepEqual(wrong.payload, { code: 'INVALID_COMMAND' });
    assert.equal(unsupported.values('body').length, 0);
    for (const [body, status] of [
      ['{invalid', 400],
      [' '.repeat(limit + 1), 503]
    ]) {
      const f = fixture();
      const result = await f.run('/api/admin/pilotage/' + suffix, {
        method: 'POST',
        body
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, { code: 'PILOTAGE_UNAVAILABLE' });
      assert.deepEqual(f.values('body'), [limit]);
      assert.equal(
        f
          .names()
          .some((name) =>
            [
              'command',
              'acknowledgeReceipt',
              'editorial.propose',
              'editorial.variant'
            ].includes(name)
          ),
        false
      );
    }
  }
});

test('pilotage preserves domain errors while withholding private diagnostics from unknown failures', async () => {
  for (const error of [
    new PilotError('READ_ONLY', 403),
    new PilotError('REQUEST_CONFLICT', 409),
    new PublicationAutomationError('VERSION_CONFLICT', 409),
    new Error('Synthetic private provider diagnostic')
  ]) {
    const f = fixture({
      overrides: {
        command: () => {
          throw error;
        }
      }
    });
    const result = await f.run('/admin/pilotage/command', {
      method: 'POST',
      input: command
    });
    assert.equal(result.status, error.status ?? 503);
    assert.deepEqual(result.payload, {
      code: error.code ?? 'PILOTAGE_UNAVAILABLE'
    });
    assert.equal(
      JSON.stringify(result.payload).includes('private provider'),
      false
    );
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
  }
});

test('real pilotage service rejects missing confirmation, invalid versions, read-only commands and nonowner projects before persistence', async () => {
  const dbCalls = [];
  const pool = {
    query: async () => {
      dbCalls.push('query');
      throw new Error('Unexpected database access');
    },
    connect: async () => {
      dbCalls.push('connect');
      throw new Error('Unexpected database access');
    }
  };
  const service = new AdminPilotageService(pool, {});
  for (const input of [
    { ...command, confirmation: 'wrong-target' },
    { ...command, version: '' },
    { ...command, requestId: 'invalid' }
  ]) {
    const f = fixture({
      overrides: { command: (...args) => service.command(...args) }
    });
    const result = await f.run('/api/admin/pilotage/command', {
      method: 'POST',
      input
    });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { code: 'INVALID_COMMAND' });
  }
  const project = {
    ...command,
    action: 'project.publish',
    targetId: '42',
    confirmation: '42'
  };
  const operator = fixture({
    overrides: { command: (...args) => service.command(...args) }
  });
  assert.equal(
    (
      await operator.run('/admin/pilotage/command', {
        method: 'POST',
        input: project
      })
    ).status,
    403
  );
  const reader = fixture({
    role: 'reader',
    bypassRole: true,
    overrides: { command: (...args) => service.command(...args) }
  });
  assert.equal(
    (
      await reader.run('/admin/pilotage/command', {
        method: 'POST',
        input: command
      })
    ).status,
    403
  );
  const ack = fixture({
    overrides: {
      acknowledgeReceipt: (...args) => service.acknowledgeReceipt(...args)
    }
  });
  assert.equal(
    (
      await ack.run('/admin/pilotage/receipt', {
        method: 'POST',
        input: {
          requestId: id,
          confirmation: 'wrong',
          reason: 'Synthetic incident examined.'
        }
      })
    ).status,
    400
  );
  assert.deepEqual(dbCalls, []);
});

test('editorial preparation and receipt acknowledgment retain their additional read-only checks', async () => {
  for (const suffix of ['programme', 'variant', 'receipt']) {
    const f = fixture({ role: 'reader', bypassRole: true });
    const result = await f.run('/admin/pilotage/' + suffix, {
      method: 'POST',
      body: '{invalid'
    });
    assert.equal(result.status, 403);
    assert.deepEqual(result.payload, { code: 'READ_ONLY' });
    assert.deepEqual(f.names(), ['access', 'actor', 'json']);
  }
});

test('pilotage owns method rejection only for its exact paths and leaves adjacent routes untouched', async () => {
  for (const [suffix, method] of [
    ['', 'POST'],
    ['/command', 'GET'],
    ['/variant', 'GET'],
    ['/receipt', 'DELETE'],
    ['/programme', 'DELETE']
  ]) {
    const f = fixture({ tokenMode: true });
    const result = await f.run('/api/admin/pilotage' + suffix, { method });
    assert.equal(result.handled, true);
    assert.equal(result.status, 405);
    assert.deepEqual(result.payload, { code: 'METHOD_NOT_ALLOWED' });
  }
  for (const url of [
    '/admin/pilotage/command/other',
    '/admin/pilotage/other',
    '/api/admin/publication-automation',
    '/health'
  ]) {
    const f = fixture();
    const result = await f.run(url);
    assert.equal(result.handled, false);
    assert.deepEqual(result.headers, {});
    assert.deepEqual(f.calls, []);
  }
});
