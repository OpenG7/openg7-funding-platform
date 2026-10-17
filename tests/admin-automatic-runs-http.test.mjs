import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminAutomaticRunsHttpHandler } from '../dist/apps/funding-api/src/admin-automatic-runs.http.js';
import {
  AdminAutomaticRunError,
  AdminAutomaticRunsService
} from '../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.invalid';
const id = '11111111-1111-4111-8111-111111111111';
const actor = 'synthetic-operator';
const state = { run: { id, version: 1 }, balance: null };

function fixture({ denied = false, unavailable = false, failure } = {}) {
  const calls = [];
  const port =
    (name, value) =>
    async (...args) => {
      calls.push({ name, args });
      if (failure) throw failure;
      return value;
    };
  const handler = createAdminAutomaticRunsHttpHandler({
    publicBaseOrigin: origin,
    ensureAdminAccess(_request, response) {
      calls.push({ name: 'access' });
      if (denied)
        Object.assign(response, {
          status: 403,
          payload: { code: 'FORBIDDEN' }
        });
      return !denied;
    },
    getAdminAuditActor() {
      calls.push({ name: 'actor' });
      return actor;
    },
    async readBody(request, limit) {
      calls.push({ name: 'body', args: [limit] });
      return readBody(request, limit);
    },
    writeJson(_request, response, status, payload) {
      Object.assign(response, { status, payload });
    },
    automaticRuns: unavailable
      ? null
      : {
          state: port('state', state),
          start: port('start', state),
          advance: port('advance', state),
          control: port('control', state),
          report: port('report', { entries: [], nextCursor: null }),
          preparation: port('preparation', { position: 3 }),
          approvePreparation: port('approvePreparation', { status: 'approved' })
        }
  });
  return {
    calls,
    async run(
      path,
      {
        method = 'GET',
        input = {},
        body,
        contentType = 'application/json'
      } = {}
    ) {
      const request = Object.assign(
        Readable.from([Buffer.from(body ?? JSON.stringify(input))]),
        { url: path, method, headers: { 'content-type': contentType } }
      );
      const response = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
}

test('automatic runs authorize every alias before body, actor, filters and service access', async () => {
  for (const prefix of ['/admin/automatic-runs', '/api/admin/automatic-runs'])
    for (const suffix of [
      '',
      '/advance',
      '/control',
      '/report',
      '/preparation',
      '/preparation/approve'
    ]) {
      const f = fixture({ denied: true });
      const result = await f.run(prefix + suffix + '?unknown=secret', {
        method: 'POST',
        body: '{invalid'
      });
      assert.equal(result.status, 403);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(
        f.calls.map((call) => call.name),
        ['access']
      );
    }
});

test('preparation navigation is a scoped read and approval has a separate bounded command', async () => {
  const f = fixture();
  const read = await f.run(
    '/api/admin/automatic-runs/preparation?runId=' + id + '&position=3'
  );
  assert.equal(read.status, 200);
  assert.deepEqual(f.calls.find((call) => call.name === 'preparation').args, [
    actor,
    id,
    3
  ]);
  assert.ok(
    !f.calls.some((call) =>
      ['advance', 'control', 'start', 'body'].includes(call.name)
    )
  );
  const input = {
    runId: id,
    contributionId: id,
    expectedVersion: 'a'.repeat(64),
    requestId: id,
    confirmed: true
  };
  const g = fixture();
  const result = await g.run('/api/admin/automatic-runs/preparation/approve', {
    method: 'POST',
    input
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    g.calls.find((call) => call.name === 'approvePreparation').args,
    [input, actor]
  );
  assert.equal(
    (
      await fixture().run('/api/admin/automatic-runs/preparation', {
        method: 'POST'
      })
    ).status,
    405
  );
  for (const suffix of [
    '?runId=' + id,
    '?runId=' + id + '&position=0',
    '?runId=' + id + '&position=1&position=2'
  ])
    assert.equal(
      (await fixture().run('/api/admin/automatic-runs/preparation' + suffix))
        .status,
      400
    );
});

test('automatic runs leave unrelated paths untouched', async () => {
  const f = fixture();
  assert.equal((await f.run('/api/admin/automatic-runs-other')).handled, false);
  assert.deepEqual(f.calls, []);
});

test('automatic run commands dispatch only exact bodies under a bounded JSON read', async () => {
  for (const [suffix, method, input] of [
    ['', 'start', { requestId: id }],
    ['/advance', 'advance', { runId: id, requestId: id, expectedVersion: 1 }],
    [
      '/control',
      'control',
      { runId: id, requestId: id, expectedVersion: 1, action: 'pause' }
    ]
  ]) {
    const f = fixture();
    const result = await f.run('/api/admin/automatic-runs' + suffix, {
      method: 'POST',
      input
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, state);
    assert.deepEqual(f.calls.find((call) => call.name === 'body').args, [4096]);
    assert.deepEqual(f.calls.find((call) => call.name === method).args, [
      input,
      actor
    ]);
  }
});

test('read state and report retain caller scope and stable numeric cursor', async () => {
  const f = fixture();
  assert.equal(
    (await f.run('/api/admin/automatic-runs?runId=' + id)).status,
    200
  );
  assert.deepEqual(f.calls.find((call) => call.name === 'state').args, [
    actor,
    id
  ]);
  const g = fixture();
  assert.equal(
    (
      await g.run(
        '/api/admin/automatic-runs/report?runId=' + id + '&after=12&limit=25'
      )
    ).status,
    200
  );
  assert.deepEqual(g.calls.find((call) => call.name === 'report').args, [
    actor,
    id,
    12,
    25
  ]);
});

test('invalid, duplicate, unknown and unsafe read filters never reach the service', async () => {
  for (const query of [
    '?unknown=x',
    '?runId=',
    '?runId=' + id + '&runId=' + id,
    '/report',
    '/report?runId=' + id + '&after=',
    '/report?runId=' + id + '&after=-1',
    '/report?runId=' + id + '&after=1.5',
    '/report?runId=' + id + '&after=1e3',
    '/report?runId=' + id + '&after=9007199254740992',
    '/report?runId=' + id + '&limit=101',
    '/report?runId=' + id + '&limit=0',
    '/report?runId=' + id + '&after=0&after=1'
  ]) {
    const f = fixture();
    assert.equal(
      (await f.run('/api/admin/automatic-runs' + query)).status,
      400,
      query
    );
    assert.deepEqual(
      f.calls.map((call) => call.name),
      ['access']
    );
  }
});

test('malformed JSON, absent storage, wrong methods and unexpected failures expose no internal detail', async () => {
  assert.equal(
    (
      await fixture().run('/api/admin/automatic-runs', {
        method: 'POST',
        body: '{'
      })
    ).status,
    400
  );
  assert.equal(
    (
      await fixture().run('/api/admin/automatic-runs', {
        method: 'POST',
        contentType: 'text/plain'
      })
    ).status,
    415
  );
  assert.equal(
    (await fixture({ unavailable: true }).run('/api/admin/automatic-runs'))
      .status,
    503
  );
  assert.equal(
    (await fixture().run('/api/admin/automatic-runs/advance')).status,
    405
  );
  const safe = await fixture({
    failure: new AdminAutomaticRunError('RUN_VERSION_CONFLICT')
  }).run('/api/admin/automatic-runs');
  assert.equal(safe.status, 409);
  assert.equal(safe.payload.code, 'RUN_VERSION_CONFLICT');
  const unexpected = await fixture({
    failure: new Error('postgres://secret@example.invalid/private')
  }).run('/api/admin/automatic-runs');
  assert.equal(unexpected.status, 503);
  assert.doesNotMatch(
    JSON.stringify(unexpected.payload),
    /postgres|secret|private/
  );
});

test('service rejects forged command shapes before borrowing a database connection', async () => {
  const service = new AdminAutomaticRunsService({
    connect() {
      assert.fail('invalid command reached persistence');
    }
  });
  for (const input of [
    null,
    [],
    {},
    { requestId: 'no' },
    { requestId: id, publish: true }
  ])
    await assert.rejects(service.start(input, actor), {
      code: 'RUN_INVALID_REQUEST',
      status: 400
    });
  for (const input of [
    { runId: id, requestId: id, expectedVersion: 0 },
    { runId: id, requestId: id, expectedVersion: 1, confirmation: true }
  ])
    await assert.rejects(service.advance(input, actor), {
      code: 'RUN_INVALID_REQUEST',
      status: 400
    });
  await assert.rejects(
    service.control(
      { runId: id, requestId: id, expectedVersion: 1, action: 'publish' },
      actor
    ),
    { code: 'RUN_INVALID_REQUEST', status: 400 }
  );
});
