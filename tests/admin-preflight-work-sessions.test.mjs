import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  parseWorkSessionStart,
  parseWorkSessionCommand,
  parseServicePreparationSaveDraft
} from '../dist/apps/funding-api/src/admin-preflight-work-sessions.commands.js';
import { createAdminPreflightWorkSessionsHttpHandler } from '../dist/apps/funding-api/src/admin-preflight-work-sessions.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { loadAdminCampaignDeskSnapshot } from '../dist/apps/funding-api/src/admin-campaigns.service.js';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const version = 'a'.repeat(64);
const start = { requestId: id, contributionId: id, obligationId: other };
const command = {
  requestId: id,
  expectedRevision: 1,
  action: 'checkpoint',
  checkpoint: {
    pendingDecision: 'correction_requested',
    reason: 'Private correction reason 🧭',
    decisionRequestId: other,
    expectedPreparationVersion: version
  }
};
const draft = {
  ...start,
  expectedVersion: version,
  title: 'Private title',
  body: 'Private business content',
  disclosureText: 'Paid sponsorship.'
};
const invalid = (operation) =>
  assert.throws(operation, {
    code: 'WORK_SESSION_INVALID_REQUEST',
    status: 400
  });

test('personal report source reads are bounded to manifest contributions in SQL', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    }
  };
  const result = await loadAdminCampaignDeskSnapshot(
    db,
    undefined,
    new Date(),
    undefined,
    [id, other]
  );
  assert.deepEqual(result.rows, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /c\.id=ANY\(\$6::uuid\[\]\)/);
  assert.deepEqual(calls[0].values[5], [id, other]);
});

test('work sessions preserve only exact references, navigation and bounded personal entries', () => {
  assert.deepEqual(
    parseWorkSessionStart({
      ...start,
      filters: { deskStatus: 'all', deskSearch: ' boreal ', deskPage: 2 }
    }),
    {
      ...start,
      filters: { deskStatus: 'all', deskSearch: 'boreal', deskPage: 2 }
    }
  );
  assert.deepEqual(parseWorkSessionCommand(command), command);
  for (const changes of [
    { actor: 'forged' },
    { sessionId: id },
    { title: 'business content' },
    { filters: { deskStatus: ['all'] } },
    { filters: { deskStatus: { toString: 'all' } } },
    { filters: { deskPage: '1' } },
    { filters: { deskSearch: 'x'.repeat(121) } }
  ])
    invalid(() => parseWorkSessionStart({ ...start, ...changes }));
  for (const changes of [
    { action: ['checkpoint'] },
    { action: {} },
    { expectedRevision: '1' },
    { expectedRevision: 0 },
    { checkpoint: { pendingDecision: ['approved'], reason: '' } },
    { checkpoint: { pendingDecision: { toString: 'approved' }, reason: '' } },
    {
      checkpoint: {
        pendingDecision: null,
        reason: '',
        body: 'not a session draft'
      }
    },
    {
      checkpoint: {
        pendingDecision: null,
        reason: '',
        decisionRequestId: other
      }
    },
    { checkpoint: { pendingDecision: null, reason: 'x'.repeat(2001) } },
    { checkpoint: { pendingDecision: null, reason: '\uD800' } }
  ])
    invalid(() => parseWorkSessionCommand({ ...command, ...changes }));
  invalid(() => parseWorkSessionCommand({ ...command, action: 'visit' }));
  invalid(() => parseWorkSessionCommand({ ...command, contributionId: id }));
  assert.equal(
    parseWorkSessionCommand({
      ...command,
      checkpoint: { pendingDecision: null, reason: '' }
    }).checkpoint.pendingDecision,
    null
  );
});

test('versioned draft saves permit only private text, an exact scope and paired session revision', () => {
  assert.deepEqual(
    parseServicePreparationSaveDraft({
      ...draft,
      workSessionId: other,
      expectedSessionRevision: 3
    }),
    { ...draft, workSessionId: other, expectedSessionRevision: 3 }
  );
  for (const changes of [
    { status: 'approved' },
    { scheduledAt: '2028-01-01T00:00:00Z' },
    { publicUrl: 'https://example.invalid' },
    { actor: 'forged' },
    { expectedVersion: 'stale' },
    { title: ' ' },
    { body: 'x'.repeat(2501) },
    { disclosureText: null },
    { workSessionId: other },
    { expectedSessionRevision: 1 },
    { title: ['forged'] },
    { body: '\0private' }
  ])
    invalid(() => parseServicePreparationSaveDraft({ ...draft, ...changes }));
});

function fixture({ denied = false, failure } = {}) {
  const calls = [];
  const port =
    (name) =>
    async (...args) => {
      calls.push({ name, args });
      if (failure) throw failure;
      return { name };
    };
  const handler = createAdminPreflightWorkSessionsHttpHandler({
    publicBaseOrigin: 'https://synthetic-admin.invalid',
    ensureAdminAccess(_request, response) {
      calls.push({ name: 'access' });
      if (denied) Object.assign(response, { status: 403 });
      return !denied;
    },
    getAdminAuditActor() {
      calls.push({ name: 'actor' });
      return 'admin:synthetic-person';
    },
    async readBody(request, limit) {
      calls.push({ name: 'body', limit });
      return readBody(request, limit);
    },
    writeJson(_request, response, status, payload) {
      Object.assign(response, { status, payload });
    },
    workSessions: {
      state: port('state'),
      start: port('start'),
      command: port('command'),
      saveDraft: port('saveDraft')
    }
  });
  return {
    calls,
    async run(
      path,
      { method = 'GET', body = '{}', contentType = 'application/json' } = {}
    ) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        url: path,
        method,
        headers: { 'content-type': contentType }
      });
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
test('every session and social-save route checks access before private parsing or dispatch', async () => {
  for (const prefix of ['/admin', '/api/admin'])
    for (const suffix of [
      '/preflight/work-sessions',
      `/preflight/work-sessions/${id}/commands`,
      '/sponsorships/preparation/service/save-draft'
    ]) {
      const f = fixture({ denied: true }),
        result = await f.run(prefix + suffix + '?unknown=private', {
          method: 'POST',
          body: 'malformed'
        });
      assert.equal(result.status, 403);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(
        f.calls.map((c) => c.name),
        ['access']
      );
    }
});
test('reconciliation reads stay scoped and save and control commands reach their distinct bounded owners', async () => {
  const f = fixture();
  assert.equal(
    (
      await f.run(
        `/api/admin/preflight/work-sessions?sessionId=${id}&requestId=${other}`
      )
    ).status,
    200
  );
  assert.deepEqual(f.calls.find((c) => c.name === 'state').args, [
    'admin:synthetic-person',
    id,
    other
  ]);
  const controls = fixture();
  await controls.run(`/api/admin/preflight/work-sessions/${id}/commands`, {
    method: 'POST',
    body: JSON.stringify(command)
  });
  assert.deepEqual(controls.calls.find((c) => c.name === 'command').args, [
    id,
    command,
    'admin:synthetic-person'
  ]);
  assert.equal(controls.calls.find((c) => c.name === 'body').limit, 16384);
  const saved = fixture();
  await saved.run('/api/admin/sponsorships/preparation/service/save-draft', {
    method: 'POST',
    body: JSON.stringify(draft)
  });
  assert.deepEqual(saved.calls.find((c) => c.name === 'saveDraft').args, [
    draft,
    'admin:synthetic-person'
  ]);
  for (const path of [
    '/api/admin/preflight/work-sessions?sessionId=bad',
    `/api/admin/preflight/work-sessions?sessionId=${id}&sessionId=${id}`,
    '/api/admin/preflight/work-sessions?actor=another'
  ])
    assert.equal((await fixture().run(path)).status, 400);
  assert.equal(
    (
      await fixture().run('/api/admin/preflight/work-sessions', {
        method: 'POST',
        body: '{bad'
      })
    ).status,
    400
  );
  assert.equal(
    (
      await fixture().run('/api/admin/preflight/work-sessions', {
        method: 'POST',
        contentType: 'text/plain'
      })
    ).status,
    415
  );
  assert.equal(
    (
      await fixture().run('/api/admin/preflight/work-sessions', {
        method: 'DELETE'
      })
    ).status,
    405
  );
});
test('new controls are explicit operator mutations and diagnostics never return private errors', async () => {
  for (const path of [
    '/admin/preflight/work-sessions',
    `/admin/preflight/work-sessions/${id}/commands`,
    '/admin/sponsorships/preparation/service/save-draft'
  ]) {
    assert.equal(adminRoleAllows('reader', 'POST', path), false);
    assert.equal(adminRoleAllows('operator', 'POST', path), true);
    assert.equal(adminRoleAllows('owner', 'POST', path), true);
  }
  const f = fixture({
    failure: new Error('synthetic-password private-business-content')
  });
  const result = await f.run('/api/admin/preflight/work-sessions');
  assert.equal(result.status, 503);
  assert.equal(result.payload.code, 'WORK_SESSION_UNAVAILABLE');
  assert.doesNotMatch(
    JSON.stringify(result.payload),
    /synthetic-password|private-business-content/
  );
});
